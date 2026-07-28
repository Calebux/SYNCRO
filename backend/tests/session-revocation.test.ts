import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { authenticate } from '../src/middleware/auth';
import { sessionService } from '../src/services/session-service';
import { supabase } from '../src/config/database';

jest.mock('../src/config/logger');
jest.mock('../src/services/audit-service', () => ({
  emitSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/services/email-service', () => ({
  emailService: {
    sendSimpleEmail: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../src/services/role-service', () => ({
  roleService: {
    getUserRole: jest.fn().mockResolvedValue('member'),
  },
}));
jest.mock('../src/middleware/requestContext', () => ({
  setRequestUserId: jest.fn(),
  setRequestPrivacyMode: jest.fn(),
  setRequestPrivacyPreferences: jest.fn(),
  getRequestId: jest.fn(() => 'test-request-id'),
}));

// In-memory mock database store for user sessions
const mockSessions: Record<string, any> = {};

// Mock the database client
jest.mock('../src/config/database', () => {
  return {
    supabase: {
      from: jest.fn((table: string) => {
        if (table === 'user_sessions') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn((field: string, val: any) => {
                if (field === 'user_id') {
                  return {
                    is: jest.fn((isField: string, isVal: any) => {
                      const filtered = Object.values(mockSessions).filter(
                        (s) => s.user_id === val && (isVal === null ? s.revoked_at === null : s.revoked_at !== null)
                      );
                      const result: any = {
                        order: jest.fn(() => result),
                        then: (resolve: any) => resolve({ data: filtered, count: filtered.length, error: null }),
                      };
                      return result;
                    }),
                  };
                }
                if (field === 'id') {
                  const session = mockSessions[val] || null;
                  return {
                    maybeSingle: jest.fn().mockResolvedValue({ data: session, error: null }),
                    single: jest.fn().mockResolvedValue({ data: session, error: null }),
                  };
                }
                return {
                  maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
                };
              }),
            })),
            insert: jest.fn((data: any) => {
              const records = Array.isArray(data) ? data : [data];
              for (const record of records) {
                mockSessions[record.id] = {
                  ...record,
                  revoked_at: null,
                };
              }
              return Promise.resolve({ error: null });
            }),
            update: jest.fn((updateData: any) => {
              return {
                eq: jest.fn((field: string, val: any) => {
                  return {
                    is: jest.fn((isField: string, isVal: any) => {
                      if (field === 'user_id') {
                        for (const key of Object.keys(mockSessions)) {
                          if (
                            mockSessions[key].user_id === val &&
                            (isVal === null ? mockSessions[key].revoked_at === null : mockSessions[key].revoked_at !== null)
                          ) {
                            mockSessions[key] = { ...mockSessions[key], ...updateData };
                          }
                        }
                      }
                      return Promise.resolve({ error: null });
                    }),
                    eq: jest.fn(() => {
                      if (field === 'id' && mockSessions[val]) {
                        mockSessions[val] = { ...mockSessions[val], ...updateData };
                      }
                      return {
                        is: jest.fn().mockResolvedValue({ error: null }),
                      };
                    }),
                  };
                }),
              };
            }),
          };
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          single: jest.fn().mockResolvedValue({ data: null, error: null }),
          insert: jest.fn().mockResolvedValue({ error: null }),
          update: jest.fn().mockReturnThis(),
        };
      }),
      auth: {
        getUser: jest.fn((token: string) => {
          try {
            const decoded = jwt.decode(token);
            if (decoded && typeof decoded === 'object' && decoded.sub) {
              return Promise.resolve({
                data: { user: { id: decoded.sub, email: 'test@example.com' } },
                error: null,
              });
            }
          } catch (e) {}
          return Promise.resolve({ data: { user: null }, error: new Error('Invalid token') });
        }),
        admin: {
          updateUserById: jest.fn().mockResolvedValue({ data: {}, error: null }),
          getUserById: jest.fn((userId: string) =>
            Promise.resolve({
              data: { user: { id: userId, email: 'test@example.com' } },
              error: null,
            })
          ),
        },
      },
    },
  };
});

function buildApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());

  app.get('/api/protected', authenticate, (req, res) => {
    res.json({ ok: true, user: (req as any).user });
  });

  return app;
}

describe('Global Session Revocation & Manual Session Invalidation', () => {
  const app = buildApp();
  const userId = 'user-123';
  const tokenSecret = 'test-secret';

  // Generate tokens for two distinct devices/sessions
  const tokenDevice1 = jwt.sign({ sub: userId, session_id: 'session-device-1' }, tokenSecret);
  const tokenDevice2 = jwt.sign({ sub: userId, session_id: 'session-device-2' }, tokenSecret);

  beforeEach(() => {
    // Clear mock sessions
    for (const key of Object.keys(mockSessions)) {
      delete mockSessions[key];
    }
    jest.clearAllMocks();
  });

  it('allows access with active device tokens and tracks them in user_sessions', async () => {
    // 1. Initially, no sessions tracked
    expect(Object.keys(mockSessions).length).toBe(0);

    // 2. Request with device 1 token
    const res1 = await request(app)
      .get('/api/protected')
      .set('Authorization', `Bearer ${tokenDevice1}`);
    
    expect(res1.status).toBe(200);
    expect(res1.body.ok).toBe(true);
    expect(mockSessions['session-device-1']).toBeDefined();
    expect(mockSessions['session-device-1'].revoked_at).toBeNull();

    // 3. Request with device 2 token
    const res2 = await request(app)
      .get('/api/protected')
      .set('Authorization', `Bearer ${tokenDevice2}`);
    
    expect(res2.status).toBe(200);
    expect(res2.body.ok).toBe(true);
    expect(mockSessions['session-device-2']).toBeDefined();
    expect(mockSessions['session-device-2'].revoked_at).toBeNull();
  });

  it('rejects secondary device token immediately after global sign-out', async () => {
    // 1. Register both device sessions by making requests
    await request(app)
      .get('/api/protected')
      .set('Authorization', `Bearer ${tokenDevice1}`);
    
    await request(app)
      .get('/api/protected')
      .set('Authorization', `Bearer ${tokenDevice2}`);

    // Verify list active sessions returns both
    const activeSessionsBefore = await sessionService.listActiveSessions(userId);
    expect(activeSessionsBefore.length).toBe(2);

    // 2. Perform global invalidation (e.g. from password change or security settings)
    const result = await sessionService.invalidateAllSessions(userId, 'password_change');
    expect(result.count).toBe(2);

    // Verify all sessions are now marked as revoked in database mock
    expect(mockSessions['session-device-1'].revoked_at).not.toBeNull();
    expect(mockSessions['session-device-2'].revoked_at).not.toBeNull();

    // 3. Subsequent request from first device token must be rejected
    const res1 = await request(app)
      .get('/api/protected')
      .set('Authorization', `Bearer ${tokenDevice1}`);

    expect(res1.status).toBe(401);
    expect(res1.body.error).toBe('Unauthorized');
    expect(res1.body.message).toBe('Session has been revoked');

    // 4. Subsequent request from second device token must also be rejected
    const res2 = await request(app)
      .get('/api/protected')
      .set('Authorization', `Bearer ${tokenDevice2}`);

    expect(res2.status).toBe(401);
    expect(res2.body.error).toBe('Unauthorized');
    expect(res2.body.message).toBe('Session has been revoked');

    // 5. Verify the ban/unban cycle was triggered on Supabase auth.admin
    expect(supabase.auth.admin.updateUserById).toHaveBeenCalledWith(userId, { ban_duration: '1h' });
    expect(supabase.auth.admin.updateUserById).toHaveBeenCalledWith(userId, { ban_duration: 'none' });
  });
});
