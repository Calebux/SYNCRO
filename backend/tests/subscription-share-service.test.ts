jest.mock('../src/config/database', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  __esModule: true,
}));

import { SubscriptionShareService } from '../src/services/subscription-share-service';
import { supabase } from '../src/config/database';

describe('SubscriptionShareService', () => {
  let service: SubscriptionShareService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SubscriptionShareService();
  });

  function mockSubscriptionLookup() {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'subscriptions') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { id: 'sub-1', name: 'Netflix', user_id: 'user-1' },
            error: null,
          }),
        };
      }
      if (table === 'subscription_share_invites') {
        return {
          insert: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: {
              id: 'invite-1',
              subscription_id: 'sub-1',
              created_by: 'user-1',
              permission_level: 'view-only',
              max_uses: 1,
              use_count: 0,
              expires_at: new Date(Date.now() + 86400000).toISOString(),
            },
            error: null,
          }),
        };
      }
      if (table === 'subscription_share_audit_log') {
        return { insert: jest.fn().mockResolvedValue({ error: null }) };
      }
      return { select: jest.fn(), eq: jest.fn(), single: jest.fn() };
    });
  }

  it('creates a share invite with secure token', async () => {
    mockSubscriptionLookup();

    const result = await service.createInvite('user-1', 'sub-1', {
      expiry: '24h',
      maxUses: 1,
      permissionLevel: 'view-only',
    });

    expect(result.token).toBeTruthy();
    expect(result.token.length).toBeGreaterThan(20);
    expect(result.shareUrl).toContain('/share/');
    expect(result.invite.permission_level).toBe('view-only');
  });

  it('rejects accept when invite is expired', async () => {
    (supabase.from as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          id: 'invite-1',
          subscription_id: 'sub-1',
          created_by: 'user-2',
          permission_level: 'view-only',
          max_uses: 1,
          use_count: 0,
          expires_at: new Date(Date.now() - 1000).toISOString(),
        },
        error: null,
      }),
    });

    await expect(service.acceptInvite('some-token', 'user-1')).rejects.toThrow('expired');
  });
});
