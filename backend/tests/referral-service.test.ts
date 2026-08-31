jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  __esModule: true,
}));
jest.mock('../src/config/database', () => ({ supabase: { from: jest.fn() } }));

import { ReferralService } from '../src/services/referral-service';
import { supabase } from '../src/config/database';

const mockFrom = supabase.from as jest.Mock;

function chainMock(overrides: Record<string, any> = {}) {
  const chain: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
    insert: jest.fn().mockResolvedValue({ error: null }),
    upsert: jest.fn().mockResolvedValue({ error: null }),
    gt: jest.fn().mockReturnThis(),
    ...overrides,
  };
  return chain;
}

describe('ReferralService', () => {
  let service: ReferralService;

  beforeEach(() => {
    service = new ReferralService();
    jest.clearAllMocks();
  });

  describe('getOrCreateCode', () => {
    it('returns existing code if already set', async () => {
      const chain = chainMock();
      chain.single.mockResolvedValue({ data: { referral_code: 'abc123' }, error: null });
      mockFrom.mockReturnValue(chain);

      const code = await service.getOrCreateCode('user-1');
      expect(code).toBe('abc123');
    });

    it('generates and saves a new code when none exists', async () => {
      const chain = chainMock();
      chain.single.mockResolvedValueOnce({ data: { referral_code: null }, error: null });
      chain.maybeSingle.mockResolvedValue({ data: null, error: null });
      chain.update = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      });
      mockFrom.mockReturnValue(chain);

      const code = await service.getOrCreateCode('user-1');
      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(0);
    });
  });

  describe('validateAndRecord', () => {
    it('does nothing for an invalid referral code', async () => {
      const chain = chainMock();
      chain.maybeSingle.mockResolvedValue({ data: null, error: null });
      mockFrom.mockReturnValue(chain);

      await expect(
        service.validateAndRecord('bad-code', 'user-2'),
      ).resolves.toBeUndefined();
    });

    it('does nothing on self-referral', async () => {
      const chain = chainMock();
      chain.maybeSingle.mockResolvedValue({ data: { id: 'user-1' }, error: null });
      mockFrom.mockReturnValue(chain);

      await expect(
        service.validateAndRecord('abc123', 'user-1'),
      ).resolves.toBeUndefined();
    });

    it('records a valid referral', async () => {
      const updateChain = { eq: jest.fn().mockResolvedValue({ error: null }) };
      const insertChain = { mockResolvedValue: jest.fn() };
      const chain = chainMock();
      chain.maybeSingle.mockResolvedValue({ data: { id: 'referrer-1' }, error: null });
      chain.update = jest.fn().mockReturnValue(updateChain);
      chain.insert = jest.fn().mockResolvedValue({ error: null });
      mockFrom.mockReturnValue(chain);

      await expect(
        service.validateAndRecord('abc123', 'user-2'),
      ).resolves.toBeUndefined();
    });
  });

  describe('markConverted', () => {
    it('does nothing when no signed_up referral exists', async () => {
      const chain = chainMock();
      chain.maybeSingle.mockResolvedValue({ data: null, error: null });
      mockFrom.mockReturnValue(chain);

      await expect(service.markConverted('user-2')).resolves.toBeUndefined();
    });

    it('does nothing when reward already granted', async () => {
      const chain = chainMock();
      chain.maybeSingle.mockResolvedValue({
        data: { id: 'ref-1', referrer_user_id: 'user-1', reward_granted: true },
        error: null,
      });
      mockFrom.mockReturnValue(chain);

      await expect(service.markConverted('user-2')).resolves.toBeUndefined();
    });

    it('marks referral converted and grants reward', async () => {
      const updateChain = { eq: jest.fn().mockResolvedValue({ error: null }) };
      const chain = chainMock();
      chain.maybeSingle.mockResolvedValue({
        data: { id: 'ref-1', referrer_user_id: 'user-1', reward_granted: false },
        error: null,
      });
      chain.update = jest.fn().mockReturnValue(updateChain);
      mockFrom.mockReturnValue(chain);

      await expect(service.markConverted('user-2')).resolves.toBeUndefined();
      expect(chain.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'converted', reward_granted: true }),
      );
    });
  });
});
