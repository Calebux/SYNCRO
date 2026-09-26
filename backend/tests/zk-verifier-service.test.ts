import { ZkVerifierService } from '../src/services/zk-verifier-service';
import { supabase } from '../src/config/database';

jest.mock('../src/config/database', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// Real crypto — we want actual Pedersen verification in the pipeline.
// The shared module has no side-effecting imports, so no mock needed.

const GOOD_HEX = 'a'.repeat(64);
const GOOD_NULLIFIER = 'b'.repeat(64);

function makeProof(commitment = GOOD_HEX, nullifier = GOOD_NULLIFIER): string {
  const payload = JSON.stringify({
    commitment,
    nullifier,
    blindingFactor: 'c'.repeat(64),
    metadata: 'd'.repeat(64),
  });
  return btoa(payload);
}

function makeInput(overrides: Partial<Parameters<ZkVerifierService['validateFormat']>[0]> = {}) {
  return {
    proof: makeProof(),
    nullifier: GOOD_NULLIFIER,
    commitment: GOOD_HEX,
    ...overrides,
  };
}

// ─── helpers to wire up supabase chain mocks ────────────────────────────────

function mockNullifierLookup(found: boolean) {
  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    if (table === 'zk_nullifiers') {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gt: jest.fn().mockReturnThis(),
        lt: jest.fn().mockReturnThis(),
        delete: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: found ? { nullifier: GOOD_NULLIFIER } : null,
          error: null,
        }),
        insert: jest.fn().mockResolvedValue({ error: null }),
      };
      return chain;
    }
    return { select: jest.fn().mockReturnThis() };
  });
}

function mockNullifierDbError() {
  (supabase.from as jest.Mock).mockImplementation(() => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    gt: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: null, error: new Error('db down') }),
  }));
}

function mockInsert(error: Error | null = null) {
  (supabase.from as jest.Mock).mockImplementation(() => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    gt: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    insert: jest.fn().mockResolvedValue({ error }),
  }));
}

function mockArchive(deleted: Array<{ nullifier: string }>) {
  (supabase.from as jest.Mock).mockImplementation(() => ({
    delete: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    select: jest.fn().mockResolvedValue({ data: deleted, error: null }),
  }));
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ZkVerifierService', () => {
  let svc: ZkVerifierService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new ZkVerifierService();
  });

  // ── validateFormat ──────────────────────────────────────────────────────

  describe('validateFormat', () => {
    it('accepts a well-formed input', () => {
      expect(svc.validateFormat(makeInput())).toBeNull();
    });

    it('rejects proof shorter than minimum', () => {
      const err = svc.validateFormat(makeInput({ proof: 'x'.repeat(10) }));
      expect(err).toMatch(/proof length out of range/);
    });

    it('rejects proof longer than maximum', () => {
      const err = svc.validateFormat(makeInput({ proof: 'x'.repeat(9000) }));
      expect(err).toMatch(/proof length out of range/);
    });

    it('rejects nullifier shorter than 64 chars', () => {
      const err = svc.validateFormat(makeInput({ nullifier: 'abc' }));
      expect(err).toMatch(/nullifier must be 64 hex/);
    });

    it('rejects nullifier with non-hex chars', () => {
      const err = svc.validateFormat(makeInput({ nullifier: 'z'.repeat(64) }));
      expect(err).toMatch(/nullifier must be 64 hex/);
    });

    it('rejects nullifier that is 65 chars (off-by-one)', () => {
      const err = svc.validateFormat(makeInput({ nullifier: 'a'.repeat(65) }));
      expect(err).toMatch(/nullifier must be 64 hex/);
    });

    it('rejects commitment shorter than 64 chars', () => {
      const err = svc.validateFormat(makeInput({ commitment: 'a'.repeat(32) }));
      expect(err).toMatch(/commitment must be 64 hex/);
    });

    it('rejects commitment with uppercase hex (malleability — canonical form is lowercase)', () => {
      const err = svc.validateFormat(makeInput({ commitment: 'A'.repeat(64) }));
      expect(err).toMatch(/commitment must be 64 hex/);
    });
  });

  // ── isNullifierSpent ────────────────────────────────────────────────────

  describe('isNullifierSpent', () => {
    it('returns false when nullifier is not in DB', async () => {
      mockNullifierLookup(false);
      await expect(svc.isNullifierSpent(GOOD_NULLIFIER)).resolves.toBe(false);
    });

    it('returns true when nullifier is already in DB', async () => {
      mockNullifierLookup(true);
      await expect(svc.isNullifierSpent(GOOD_NULLIFIER)).resolves.toBe(true);
    });

    it('fails closed on DB error (returns true to block double-spend)', async () => {
      mockNullifierDbError();
      await expect(svc.isNullifierSpent(GOOD_NULLIFIER)).resolves.toBe(true);
    });
  });

  // ── verifyAndStore — double-spend ───────────────────────────────────────

  describe('verifyAndStore — double-spend prevention', () => {
    it('rejects a proof whose nullifier is already spent', async () => {
      mockNullifierLookup(true);
      const result = await svc.verifyAndStore({
        proof: makeProof(),
        nullifier: GOOD_NULLIFIER,
        commitment: GOOD_HEX,
        amount: 1599n,
        userId: 'user-1',
        serviceId: 'svc-1',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('nullifier already spent');
    });
  });

  // ── verifyAndStore — malleability ───────────────────────────────────────

  describe('verifyAndStore — malleability', () => {
    it('rejects when commitment in proof body differs from public input', async () => {
      mockNullifierLookup(false);
      // proof encodes GOOD_HEX but we declare a different commitment in public inputs
      const tamperedCommitment = 'f'.repeat(64);
      const result = await svc.verifyAndStore({
        proof: makeProof(GOOD_HEX, GOOD_NULLIFIER),
        nullifier: GOOD_NULLIFIER,
        commitment: tamperedCommitment, // mismatch
        amount: 1599n,
        userId: 'user-1',
        serviceId: 'svc-1',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('invalid proof');
    });

    it('rejects when nullifier in proof body differs from public input', async () => {
      mockNullifierLookup(false);
      const tamperedNullifier = 'e'.repeat(64);
      const result = await svc.verifyAndStore({
        proof: makeProof(GOOD_HEX, GOOD_NULLIFIER),
        nullifier: tamperedNullifier, // mismatch
        commitment: GOOD_HEX,
        amount: 1599n,
        userId: 'user-1',
        serviceId: 'svc-1',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('invalid proof');
    });

    it('rejects a proof that is not valid base64', async () => {
      mockNullifierLookup(false);
      const badProof = '!'.repeat(100); // not base64
      // format check passes length, but atob will throw inside verifyProofCrypto
      const result = await svc.verifyAndStore({
        proof: badProof,
        nullifier: GOOD_NULLIFIER,
        commitment: GOOD_HEX,
        amount: 1599n,
        userId: 'user-1',
        serviceId: 'svc-1',
      });
      expect(result.ok).toBe(false);
    });

    it('rejects a proof whose JSON is missing fields', async () => {
      mockNullifierLookup(false);
      const incomplete = btoa(JSON.stringify({ commitment: GOOD_HEX }));
      const result = await svc.verifyAndStore({
        proof: incomplete,
        nullifier: GOOD_NULLIFIER,
        commitment: GOOD_HEX,
        amount: 1599n,
        userId: 'user-1',
        serviceId: 'svc-1',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('invalid proof');
    });
  });

  // ── archiveExpired ──────────────────────────────────────────────────────

  describe('archiveExpired', () => {
    it('returns the count of pruned rows', async () => {
      mockArchive([{ nullifier: GOOD_NULLIFIER }, { nullifier: 'c'.repeat(64) }]);
      await expect(svc.archiveExpired()).resolves.toBe(2);
    });

    it('returns 0 on DB error without throwing', async () => {
      (supabase.from as jest.Mock).mockImplementation(() => ({
        delete: jest.fn().mockReturnThis(),
        lt: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue({ data: null, error: new Error('db down') }),
      }));
      await expect(svc.archiveExpired()).resolves.toBe(0);
    });

    it('returns 0 when there is nothing to prune', async () => {
      mockArchive([]);
      await expect(svc.archiveExpired()).resolves.toBe(0);
    });
  });
});
