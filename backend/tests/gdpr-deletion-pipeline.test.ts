import { executeGdprDeletionPipeline } from '../src/services/gdpr-deletion-pipeline';

jest.mock('../src/config/database', () => ({
  supabase: {
    from: jest.fn(),
    auth: { admin: { deleteUser: jest.fn() } },
  },
}));

jest.mock('../src/config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock('../src/services/sentry-user-deletion', () => ({
  removeUserFromSentry: jest.fn().mockResolvedValue({ removed: true, method: 'local_scope_scrub' }),
}));

import { supabase } from '../src/config/database';
import { removeUserFromSentry } from '../src/services/sentry-user-deletion';

describe('GdprDeletionPipeline', () => {
  const userId = 'user-abc';
  const deletionId = 'del-123';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockSupabaseForPipeline() {
    const auditInserts: unknown[] = [];

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'deletion_audit_trail') {
        return {
          insert: jest.fn((row) => {
            auditInserts.push(row);
            return Promise.resolve({ data: row, error: null });
          }),
        };
      }
      if (table === 'subscriptions') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          not: jest.fn().mockReturnThis(),
          update: jest.fn().mockReturnThis(),
          then: (resolve: (v: unknown) => void) =>
            resolve({ data: [{ blockchain_sub_id: 42 }], error: null }),
        };
      }
      if (table === 'contract_events') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({
            data: [{ id: 1, event_data: { user_reference: 'secret' } }],
            error: null,
          }),
          update: jest.fn().mockReturnThis(),
        };
      }
      if (table === 'renewal_approvals') {
        return {
          update: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({ data: {}, error: null }),
        };
      }
      if (table === 'audit_logs') {
        return {
          update: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({ data: {}, error: null }),
        };
      }
      if (table === 'profiles') {
        return {
          update: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({ data: {}, error: null }),
        };
      }
      // Default: user data table delete
      return {
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ data: {}, error: null }),
        update: jest.fn().mockReturnThis(),
      };
    });

    return auditInserts;
  }

  it('should execute all pipeline steps and record audit trail', async () => {
    const auditInserts = mockSupabaseForPipeline();

    const result = await executeGdprDeletionPipeline(userId, deletionId);

    expect(result.success).toBe(true);
    expect(result.stepsCompleted).toEqual(
      expect.arrayContaining([
        'cascade_delete',
        'blockchain_anonymize',
        'audit_log_anonymize',
        'sentry_removal',
        'logging_scrub',
      ]),
    );
    expect(removeUserFromSentry).toHaveBeenCalledWith(userId);
    expect(auditInserts.length).toBeGreaterThan(0);
  });

  it('should return failure when cascade delete throws', async () => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'deletion_audit_trail') {
        return {
          insert: jest.fn().mockResolvedValue({ data: {}, error: null }),
        };
      }
      return {
        delete: jest.fn().mockImplementation(() => {
          throw new Error('database unavailable');
        }),
        eq: jest.fn(),
        update: jest.fn().mockReturnThis(),
      };
    });

    const result = await executeGdprDeletionPipeline(userId, deletionId);
    expect(result.success).toBe(false);
    expect(result.error).toBe('database unavailable');
  });
});

describe('removeUserFromSentry (integration)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.SENTRY_ORG;
    delete process.env.SENTRY_PROJECT;
    delete process.env.SENTRY_AUTH_TOKEN;
    jest.resetModules();
  });

  it('should call Sentry API when credentials are configured', async () => {
    jest.unmock('../src/services/sentry-user-deletion');
    const { removeUserFromSentry: realRemove } = await import('../src/services/sentry-user-deletion');

    process.env.SENTRY_ORG = 'test-org';
    process.env.SENTRY_PROJECT = 'test-project';
    process.env.SENTRY_AUTH_TOKEN = 'test-token';

    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

    const result = await realRemove('user-123');
    expect(result.removed).toBe(true);
    expect(result.method).toBe('sentry_api');
  });
});
