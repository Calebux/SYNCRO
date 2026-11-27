import { subscriptionService } from '../src/services/subscription-service';
import { supabase } from '../src/config/database';

jest.mock('../src/config/database', () => ({
  supabase: {
    from: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    lt: jest.fn().mockResolvedValue({ data: [], error: null, count: 5 }),
  }
}));

jest.mock('../src/services/blockchain-service', () => ({
  blockchainService: {
    syncSubscription: jest.fn().mockResolvedValue({ success: true })
  }
}));

describe('Subscription Retention & Soft Delete', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('purgeDeletedSubscriptions', () => {
    it('should delete subscriptions older than 30 days', async () => {
      const result = await subscriptionService.purgeDeletedSubscriptions(30);

      expect(supabase.from).toHaveBeenCalledWith('subscriptions');
      expect(supabase.delete).toHaveBeenCalledWith({ count: 'exact' });
      expect(supabase.eq).toHaveBeenCalledWith('status', 'deleted');
      expect(supabase.lt).toHaveBeenCalled();

      expect(result.deletedCount).toBe(5);
    });
  });

  describe('restoreSubscription', () => {
    // Tests for restoreSubscription could be added here
    // checking that status is set to active and deleted_at is nulled
    it('is a placeholder for restore tests', () => {
      expect(true).toBe(true);
    });
  });
});
