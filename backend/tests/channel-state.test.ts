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
import {
  ChannelState,
  SignedChannelState,
  MeterWindow,
  InMemoryStateStore,
  HmacChannelStateSigner,
  constructChannelState,
  encodeChannelState,
  signChannelState,
  verifyChannelState,
  channelStateDigest,
  produceAndPersistState,
  StateStore,
  ChannelStateSigner,
} from '@syncro/settlement';

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

describe('@syncro/settlement package - channel state API', () => {
  const signer = new HmacChannelStateSigner('test-key');
  let store: StateStore;

  const window: MeterWindow = {
    channelId: 'ch_test',
    contractAddress: '0xabc',
    startNonce: 1,
    endNonce: 10,
    startTime: 1000,
    endTime: 2000,
    payerBalance: 100n,
    payeeBalance: 50n,
  };

  beforeEach(() => {
    store = new InMemoryStateStore();
  });

  it('constructChannelState creates a valid ChannelState from a MeterWindow', () => {
    const state = constructChannelState(window, 'v1');
    expect(state.channelId).toBe('ch_test');
    expect(state.contractAddress).toBe('0xabc');
    expect(state.contractVersion).toBe('v1');
    expect(state.nonce).toBe(10); // first state uses endNonce
    expect(state.payerBalance).toBe(100n);
    expect(state.payeeBalance).toBe(50n);
  });

  it('constructChannelState rejects an unclosed window', () => {
    const openWindow: MeterWindow = {
      ...window,
      endTime: 0,
      startTime: 100,
    };
    expect(() => constructChannelState(openWindow, 'v1')).toThrow('meter window is not closed');
  });

  it('constructChannelState rejects a window with invalid nonce range', () => {
    const badWindow: MeterWindow = {
      ...window,
      startNonce: 10,
      endNonce: 5,
    };
    expect(() => constructChannelState(badWindow, 'v1')).toThrow('meter window nonce range is invalid');
  });

  it('constructChannelState rejects negative balances', () => {
    const badWindow: MeterWindow = {
      ...window,
      payerBalance: -1n,
    };
    expect(() => constructChannelState(badWindow, 'v1')).toThrow('balances must be non-negative');
  });

  it('constructChannelState throws on non-decreasing payee balance', () => {
    const state = constructChannelState(window, 'v1');
    const signed: SignedChannelState = { state, signature: 'dummy' };
    const lowerPayeeWindow: MeterWindow = {
      ...window,
      startNonce: 10,
      endNonce: 20,
      startTime: 2000,
      endTime: 3000,
      payerBalance: 200n,
      payeeBalance: 25n, // lower than previous
    };
    expect(() => constructChannelState(lowerPayeeWindow, 'v1', signed)).toThrow(
      'refusing to reduce payee balance below previously signed state',
    );
  });

  it('constructChannelState uses next nonce when previous exists', () => {
    const state = constructChannelState(window, 'v1');
    const signed: SignedChannelState = { state, signature: 'dummy' };
    const nextWindow: MeterWindow = {
      ...window,
      startNonce: 10,
      endNonce: 20,
      startTime: 2000,
      endTime: 3000,
      payerBalance: 200n,
      payeeBalance: 75n,
    };
    const next = constructChannelState(nextWindow, 'v1', signed);
    expect(next.nonce).toBe(11); // previous nonce + 1
  });

  it('encodeChannelState produces deterministic canonical encoding', () => {
    const state = constructChannelState(window, 'v1');
    const encoded = encodeChannelState(state);
    expect(typeof encoded).toBe('string');
    expect(encoded).toContain('v3-channel-state');
    expect(encoded).toContain('ch_test');
    expect(encoded).toContain('0xabc');

    // Must be deterministic
    const encoded2 = encodeChannelState(state);
    expect(encoded).toBe(encoded2);
  });

  it('channelStateDigest produces a consistent hash', () => {
    const state = constructChannelState(window, 'v1');
    const digest = channelStateDigest(state);
    expect(typeof digest).toBe('string');
    expect(digest).toMatch(/^[a-f0-9]{64}$/); // sha256 hex

    // Same state => same digest
    expect(channelStateDigest(state)).toBe(digest);
  });

  it('signChannelState produces and attaches a signature', () => {
    const state = constructChannelState(window, 'v1');
    const signed = signChannelState(state, signer);
    expect(signed.state).toBe(state);
    expect(typeof signed.signature).toBe('string');
    expect(signed.signature.length).toBeGreaterThan(0);
  });

  it('verifyChannelState validates correct signatures', () => {
    const state = constructChannelState(window, 'v1');
    const signed = signChannelState(state, signer);
    expect(verifyChannelState(signed, signer)).toBe(true);
  });

  it('verifyChannelState rejects tampered state', () => {
    const state = constructChannelState(window, 'v1');
    const signed = signChannelState(state, signer);
    const tampered: SignedChannelState = {
      state: { ...state, payerBalance: state.payerBalance + 1n },
      signature: signed.signature,
    };
    expect(verifyChannelState(tampered, signer)).toBe(false);
  });

  it('verifyChannelState rejects wrong key', () => {
    const state = constructChannelState(window, 'v1');
    const signed = signChannelState(state, signer);
    const wrongSigner = new HmacChannelStateSigner('different-key');
    expect(verifyChannelState(signed, wrongSigner)).toBe(false);
  });

  it('InMemoryStateStore persists and retrieves latest state', async () => {
    const state = constructChannelState(window, 'v1');
    const signed = signChannelState(state, signer);
    await store.persist(signed);

    const retrieved = await store.latest('ch_test');
    expect(retrieved).toBeDefined();
    expect(retrieved!.state.nonce).toBe(10);
  });

  it('InMemoryStateStore rejects stale state', async () => {
    const state = constructChannelState(window, 'v1');
    const signed = signChannelState(state, signer);
    await store.persist(signed);

    const staleWindow: MeterWindow = {
      ...window,
      startNonce: 1,
      endNonce: 5,
      startTime: 500,
      endTime: 1000,
      payerBalance: 50n,
      payeeBalance: 25n,
    };
    const staleState = constructChannelState(staleWindow, 'v1', signed);
    const staleSigned = signChannelState(staleState, signer);
    await expect(store.persist(staleSigned)).rejects.toThrow(
      'refusing to persist stale state',
    );
  });

  it('InMemoryStateStore returns undefined for unknown channel', async () => {
    const result = await store.latest('unknown_ch');
    expect(result).toBeUndefined();
  });

  it('produceAndPersistState constructs, signs and persists in one call', async () => {
    const signed = await produceAndPersistState(window, 'v1', signer, store);
    expect(signed.state.nonce).toBe(10);
    expect(typeof signed.signature).toBe('string');

    // Next call uses the persisted state to derive nonce
    const nextWindow: MeterWindow = {
      ...window,
      startNonce: 10,
      endNonce: 20,
      startTime: 2000,
      endTime: 3000,
      payerBalance: 200n,
      payeeBalance: 75n,
    };
    const signed2 = await produceAndPersistState(nextWindow, 'v1', signer, store);
    expect(signed2.state.nonce).toBe(11); // previous nonce + 1
  });
});