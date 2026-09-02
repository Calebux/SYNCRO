jest.mock('../src/config/database', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  __esModule: true,
}));

jest.mock('../src/services/payment-channel-service', () => ({
  paymentChannelService: {
    listChannels: jest.fn(),
    applyOffChainRenewal: jest.fn(),
    initiateClose: jest.fn(),
    finalizeClose: jest.fn(),
    getChannel: jest.fn(),
  },
}));

import { ChannelStateService } from '../src/services/channel-state';
import { supabase } from '../src/config/database';
import { paymentChannelService } from '../src/services/payment-channel-service';

describe('ChannelStateService', () => {
  let service: ChannelStateService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ChannelStateService();
  });

  describe('assessChannel', () => {
    it('flags low balance when fewer than 2 renewals remain', () => {
      const health = service.assessChannel(
        {
          id: 'ch-1',
          userId: 'u-1',
          counterparty: 'SYNCRO',
          balance: '15',
          state: 'active',
          lastUpdated: new Date().toISOString(),
          channelState: {
            sequenceNumber: 1,
            userBalance: 15,
            executorBalance: 0,
            totalDeposited: 15,
          },
        },
        10,
      );
      expect(health.renewalsRemaining).toBe(1.5);
      expect(service.isLowBalance(health.renewalsRemaining)).toBe(true);
    });

    it('detects expiry threshold alerts', () => {
      const inThreeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      const health = service.assessChannel(
        {
          id: 'ch-1',
          userId: 'u-1',
          counterparty: 'SYNCRO',
          balance: '100',
          state: 'active',
          lastUpdated: new Date().toISOString(),
          expiry: inThreeDays,
        },
        10,
      );
      expect(service.getExpiryAlertThreshold(health.expiryDaysRemaining)).toBe(3);
    });
  });

  describe('findPayableChannel', () => {
    it('returns active channel with sufficient balance', async () => {
      (paymentChannelService.listChannels as jest.Mock).mockResolvedValue([
        {
          id: 'ch-1',
          state: 'active',
          balance: '50',
          channelState: { userBalance: 50, executorBalance: 0, sequenceNumber: 0, totalDeposited: 50 },
        },
        {
          id: 'ch-2',
          state: 'active',
          balance: '5',
          channelState: { userBalance: 5, executorBalance: 0, sequenceNumber: 0, totalDeposited: 5 },
        },
      ]);

      const channel = await service.findPayableChannel('user-1', 10);
      expect(channel?.id).toBe('ch-1');
    });

    it('returns null when no channel has enough balance', async () => {
      (paymentChannelService.listChannels as jest.Mock).mockResolvedValue([
        {
          id: 'ch-1',
          state: 'active',
          balance: '5',
          channelState: { userBalance: 5, executorBalance: 0, sequenceNumber: 0, totalDeposited: 5 },
        },
      ]);

      const channel = await service.findPayableChannel('user-1', 10);
      expect(channel).toBeNull();
    });
  });

  describe('applyRenewalPayment', () => {
    it('updates channel state and logs payment locally', async () => {
      const updatedChannel = {
        id: 'ch-1',
        state: 'active',
        balance: '40',
        channelState: { userBalance: 40, executorBalance: 10, sequenceNumber: 1, totalDeposited: 50 },
      };

      (paymentChannelService.applyOffChainRenewal as jest.Mock).mockResolvedValue(updatedChannel);
      (supabase.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockResolvedValue({ error: null }),
      });

      const result = await service.applyRenewalPayment('ch-1', 'user-1', 'sub-1', 10);

      expect(paymentChannelService.applyOffChainRenewal).toHaveBeenCalledWith('ch-1', 'user-1', 10);
      expect(supabase.from).toHaveBeenCalledWith('channel_payments');
      expect(result.channelState?.sequenceNumber).toBe(1);
    });
  });

  describe('getSettlementSchedule', () => {
    it('defaults to monthly', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null }),
      });

      const schedule = await service.getSettlementSchedule('user-1');
      expect(schedule).toBe('monthly');
    });

    it('returns quarterly when configured', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { channel_settlement_schedule: 'quarterly' },
        }),
      });

      const schedule = await service.getSettlementSchedule('user-1');
      expect(schedule).toBe('quarterly');
    });
  });

  describe('watchtowers', () => {
    const openChannel = {
      id: 'ch-1',
      userId: 'user-1',
      counterparty: 'SYNCRO',
      balance: '100',
      state: 'active' as const,
      lastUpdated: new Date().toISOString(),
      channelState: {
        sequenceNumber: 1,
        userBalance: 100,
        executorBalance: 0,
        totalDeposited: 100,
      },
    };

    it('registers and lists watchtowers', async () => {
      (paymentChannelService.getChannel as jest.Mock).mockResolvedValue(openChannel);
      (supabase.from as jest.Mock).mockReturnValue({
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
      });
      Object.defineProperty(
        (supabase.from as jest.Mock).mock.results[0] || {},
        'eq',
        { value: jest.fn().mockReturnThis() },
      );

      const chain = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
      };
      chain.eq.mockReturnValue(chain);
      (supabase.from as jest.Mock).mockReturnValue(chain);

      const towers = await service.registerWatchtower('user-1', 'ch-1', 'GWTCHTOWER', 10);
      expect(towers).toHaveLength(1);
      expect(towers[0].address).toBe('GWTCHTOWER');
      expect(towers[0].bounty).toBe(10);
    });

    it('rejects bounty above the cap', async () => {
      (paymentChannelService.getChannel as jest.Mock).mockResolvedValue(openChannel);
      await expect(
        service.registerWatchtower('user-1', 'ch-1', 'GWTCHTOWER', 10_001),
      ).rejects.toMatchObject({ code: 'BOUNTY_EXCEEDS_CAP' });
    });

    it('rejects a channel party as watchtower', async () => {
      (paymentChannelService.getChannel as jest.Mock).mockResolvedValue(openChannel);
      await expect(
        service.registerWatchtower('user-1', 'ch-1', 'user-1', 0),
      ).rejects.toMatchObject({ code: 'WATCHTOWER_IS_PARTY' });
    });

    it('rejects stale watchtower submit', async () => {
      (paymentChannelService.getChannel as jest.Mock).mockResolvedValue({
        ...openChannel,
        state: 'closing',
        channelState: {
          ...openChannel.channelState,
          watchtowers: [{ address: 'GWTCHTOWER', bounty: 10, registeredAt: new Date().toISOString() }],
        },
      });
      await expect(
        service.submitWatchtowerState({
          channelId: 'ch-1',
          userId: 'user-1',
          watchtower: 'GWTCHTOWER',
          balanceA: 80,
          balanceB: 20,
          sequenceNumber: 1,
        }),
      ).rejects.toMatchObject({ code: 'STALE_STATE' });
    });

    it('rejects an unregistered watchtower', async () => {
      (paymentChannelService.getChannel as jest.Mock).mockResolvedValue({
        ...openChannel,
        state: 'closing',
      });
      await expect(
        service.submitWatchtowerState({
          channelId: 'ch-1',
          userId: 'user-1',
          watchtower: 'GSTRANGER',
          balanceA: 80,
          balanceB: 20,
          sequenceNumber: 2,
        }),
      ).rejects.toMatchObject({ code: 'NOT_WATCHTOWER' });
    });
  });
});
