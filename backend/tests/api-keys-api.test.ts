// ─── Mocks (must be before imports) ──────────────────────────────────────────

const insertMock = jest.fn();
const selectMock = jest.fn();
const updateMock = jest.fn();

/** Chainable Supabase query builder stub */
function makeQueryBuilder() {
  const query: any = {
    eq: () => query,
    order: () => query,
    single: () => query,
    maybeSingle: () => query,
    then: (resolve: any, reject: any) =>
      Promise.resolve(selectMock()).then(resolve, reject),
  };
  return query;
}

const fromImplementation = (tableName: string) => {
  if (tableName === 'audit_logs') {
    return { insert: jest.fn().mockResolvedValue({ error: null }) };
  }
  if (tableName !== 'api_keys') return undefined;

  return {
    select: () => makeQueryBuilder(),
    update: (...args: any[]) => {
      const q: any = {
        eq: () => q,
        then: (resolve: any, reject: any) =>
          Promise.resolve(updateMock(...args)).then(resolve, reject),
      };
      return q;
    },
    insert: (...args: any[]) => insertMock(...args),
  };
};

const fromMock = jest.fn(fromImplementation);

jest.mock('../src/config/database', () => ({
  supabase: {
    from: fromMock,
    auth: { getUser: jest.fn() },
    // Expose mocks for assertions
    __mocks: { insertMock, selectMock, updateMock, fromMock },
  },
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  requireScope: () => (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../src/middleware/rbac', () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../src/services/audit-service', () => ({
  auditApiKeyEvent: jest.fn().mockResolvedValue(undefined),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import express from 'express';
import request from 'supertest';
import apiKeysRoutes from '../src/routes/api-keys';
import { supabase } from '../src/config/database';
import { auditApiKeyEvent } from '../src/services/audit-service';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const userId = 'user-123';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = {
      id: userId,
      authMethod: 'jwt',
      scopes: ['subscriptions:read', 'subscriptions:write'],
    };
    next();
  });
  app.use('/api/keys', apiKeysRoutes);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('/api/keys routes', () => {
  let app: express.Application;

  beforeEach(() => {
    jest.clearAllMocks();
    fromMock.mockImplementation(fromImplementation);
    app = buildApp();

    insertMock.mockResolvedValue({ data: [{ id: 'key-id' }], error: null });
    selectMock.mockResolvedValue({ data: null, error: null });
    updateMock.mockResolvedValue({ data: null, error: null });
  });

  // ── POST / ────────────────────────────────────────────────────────────────

  describe('POST /api/keys — create', () => {
    it('returns 201 with a raw key matching sk_<64 hex chars>', async () => {
      const res = await request(app)
        .post('/api/keys')
        .send({ name: 'my-service', scopes: ['subscriptions:read'] });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.key).toMatch(/^sk_[0-9a-f]{64}$/);
      expect(res.body.scopes).toEqual(['subscriptions:read']);
    });

    it('never stores the raw key — only the hash reaches the DB', async () => {
      const res = await request(app)
        .post('/api/keys')
        .send({ name: 'svc', scopes: ['subscriptions:read'] });

      expect(res.status).toBe(201);
      const rawKey: string = res.body.key;

      // The raw key must not appear in any insert call
      const insertPayload = JSON.stringify(insertMock.mock.calls);
      expect(insertPayload).not.toContain(rawKey);

      // The insert must have a key_hash field and it must not equal the raw key
      const inserted = insertMock.mock.calls[0][0][0];
      expect(inserted).toHaveProperty('key_hash');
      expect(inserted.key_hash).not.toBe(rawKey);
      expect(inserted.key_hash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
    });

    it('persists the requested scopes', async () => {
      await request(app)
        .post('/api/keys')
        .send({ name: 'svc', scopes: ['subscriptions:read', 'analytics:read'] });

      const inserted = insertMock.mock.calls[0][0][0];
      expect(inserted.scopes).toEqual(['subscriptions:read', 'analytics:read']);
    });

    it('rejects unknown scopes with 400', async () => {
      const res = await request(app)
        .post('/api/keys')
        .send({ name: 'svc', scopes: ['admin:everything'] });

      expect(res.status).toBe(400);
    });

    it('rejects a request with no scopes with 400', async () => {
      const res = await request(app)
        .post('/api/keys')
        .send({ name: 'svc', scopes: [] });

      expect(res.status).toBe(400);
    });

    it('emits api_key.created audit event', async () => {
      await request(app)
        .post('/api/keys')
        .send({ name: 'audited-svc', scopes: ['subscriptions:write'] });

      expect(auditApiKeyEvent).toHaveBeenCalledWith(
        'api_key.created',
        userId,
        expect.objectContaining({ keyName: 'audited-svc', scopes: ['subscriptions:write'] }),
      );
    });

    it('returns 500 without leaking error details when insert fails', async () => {
      insertMock.mockResolvedValue({ error: { message: 'DB exploded' } });

      const res = await request(app)
        .post('/api/keys')
        .send({ name: 'svc', scopes: ['subscriptions:read'] });

      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain('DB exploded');
    });
  });

  // ── GET / ─────────────────────────────────────────────────────────────────

  describe('GET /api/keys — list', () => {
    it('returns key list without key_hash or raw key material', async () => {
      const entries = [
        { id: 'k1', service_name: 'svc', scopes: ['subscriptions:read'], revoked: false },
      ];
      selectMock.mockResolvedValue({ data: entries, error: null });

      const res = await request(app).get('/api/keys');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(entries);
      // key_hash must never appear in a list response
      expect(JSON.stringify(res.body)).not.toContain('key_hash');
    });
  });

  // ── DELETE /:id ───────────────────────────────────────────────────────────

  describe('DELETE /api/keys/:id — revoke', () => {
    it('marks key revoked and emits audit event', async () => {
      selectMock.mockResolvedValue({ data: { id: 'key-id' }, error: null });
      updateMock.mockResolvedValue({ data: { id: 'key-id', revoked: true }, error: null });

      const res = await request(app).delete('/api/keys/key-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(updateMock).toHaveBeenCalled();
      expect(auditApiKeyEvent).toHaveBeenCalledWith(
        'api_key.revoked',
        userId,
        expect.objectContaining({ keyId: 'key-id' }),
      );
    });

    it('returns 404 when key does not belong to user', async () => {
      selectMock.mockResolvedValue({ data: null, error: null });

      const res = await request(app).delete('/api/keys/nonexistent');

      expect(res.status).toBe(404);
    });
  });

  // ── GET /:id/usage ────────────────────────────────────────────────────────

  describe('GET /api/keys/:id/usage', () => {
    it('returns usage stats for a key', async () => {
      const record = {
        id: 'key-id',
        service_name: 'svc',
        scopes: ['subscriptions:read'],
        request_count: 42,
        last_used_at: '2026-07-01T00:00:00Z',
      };
      selectMock.mockResolvedValue({ data: record, error: null });

      const res = await request(app).get('/api/keys/key-id/usage');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(record);
    });

    it('returns 404 for unknown key', async () => {
      selectMock.mockResolvedValue({ data: null, error: null });

      const res = await request(app).get('/api/keys/ghost/usage');

      expect(res.status).toBe(404);
    });
  });

  // ── POST /:id/rotate ──────────────────────────────────────────────────────

  describe('POST /api/keys/:id/rotate — rotation', () => {
    const existingKey = {
      id: 'old-key-id',
      service_name: 'my-svc',
      scopes: ['subscriptions:read', 'analytics:read'],
      revoked: false,
    };

    it('returns 201 with a fresh sk_ key preserving name and scopes', async () => {
      selectMock.mockResolvedValue({ data: existingKey, error: null });
      updateMock.mockResolvedValue({ error: null });
      insertMock.mockResolvedValue({ error: null });

      const res = await request(app).post('/api/keys/old-key-id/rotate');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.key).toMatch(/^sk_[0-9a-f]{64}$/);
      expect(res.body.scopes).toEqual(existingKey.scopes);
    });

    it('new key is different from any previously issued key', async () => {
      selectMock.mockResolvedValue({ data: existingKey, error: null });
      updateMock.mockResolvedValue({ error: null });
      insertMock.mockResolvedValue({ error: null });

      const [r1, r2] = await Promise.all([
        request(app).post('/api/keys/old-key-id/rotate'),
        request(app).post('/api/keys/old-key-id/rotate'),
      ]);

      expect(r1.body.key).not.toBe(r2.body.key);
    });

    it('revokes the old key before inserting the new one', async () => {
      selectMock.mockResolvedValue({ data: existingKey, error: null });
      updateMock.mockResolvedValue({ error: null });
      insertMock.mockResolvedValue({ error: null });

      await request(app).post('/api/keys/old-key-id/rotate');

      // update (revoke) must be called
      expect(updateMock).toHaveBeenCalled();
      const revokeArg = updateMock.mock.calls[0][0];
      expect(revokeArg).toMatchObject({ revoked: true });

      // insert must be called with the new hash
      expect(insertMock).toHaveBeenCalled();
      const inserted = insertMock.mock.calls[0][0][0];
      expect(inserted.service_name).toBe(existingKey.service_name);
      expect(inserted.scopes).toEqual(existingKey.scopes);
      expect(inserted.revoked).toBe(false);
      expect(inserted.key_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('new raw key is never stored — only hash in insert payload', async () => {
      selectMock.mockResolvedValue({ data: existingKey, error: null });
      updateMock.mockResolvedValue({ error: null });
      insertMock.mockResolvedValue({ error: null });

      const res = await request(app).post('/api/keys/old-key-id/rotate');
      const newRawKey: string = res.body.key;

      const insertPayload = JSON.stringify(insertMock.mock.calls);
      expect(insertPayload).not.toContain(newRawKey);
    });

    it('emits api_key.rotated audit event', async () => {
      selectMock.mockResolvedValue({ data: existingKey, error: null });
      updateMock.mockResolvedValue({ error: null });
      insertMock.mockResolvedValue({ error: null });

      await request(app).post('/api/keys/old-key-id/rotate');

      expect(auditApiKeyEvent).toHaveBeenCalledWith(
        'api_key.rotated',
        userId,
        expect.objectContaining({
          oldKeyId: 'old-key-id',
          keyName: existingKey.service_name,
          scopes: existingKey.scopes,
        }),
      );
    });

    it('returns 404 when key does not belong to user', async () => {
      selectMock.mockResolvedValue({ data: null, error: null });

      const res = await request(app).post('/api/keys/ghost/rotate');

      expect(res.status).toBe(404);
    });

    it('returns 400 when attempting to rotate an already-revoked key', async () => {
      selectMock.mockResolvedValue({
        data: { ...existingKey, revoked: true },
        error: null,
      });

      const res = await request(app).post('/api/keys/old-key-id/rotate');

      expect(res.status).toBe(400);
    });

    it('rolls back revoke if new-key insert fails', async () => {
      selectMock.mockResolvedValue({ data: existingKey, error: null });
      updateMock.mockResolvedValue({ error: null });
      insertMock.mockResolvedValue({ error: { message: 'unique violation' } });

      const res = await request(app).post('/api/keys/old-key-id/rotate');

      expect(res.status).toBe(500);
      // Two update calls: revoke + rollback un-revoke
      expect(updateMock).toHaveBeenCalledTimes(2);
      const rollbackArg = updateMock.mock.calls[1][0];
      expect(rollbackArg).toMatchObject({ revoked: false });
    });
  });
});
