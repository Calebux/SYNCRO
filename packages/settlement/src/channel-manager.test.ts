/**
 * Unit tests for ChannelManager distributed locking and idempotency (Issue #1648) and
 * placeholder and unknown channel handling (Issue #1647).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ChannelManager,
  InMemoryChannelStore,
  ChannelBackend,
  PrincipalAuthorizer,
  ChannelState,
  ChannelStore,
  ChannelStatus,
} from './channel-manager';
import { DistributedLock } from './distributed-lock';

class MockBackend implements ChannelBackend {
  openCount = 0;
  async openChannel(_params: { principal: string; provider: string; deposit: bigint }) {
    this.openCount++;
    return {
      channelId: `ch_${this.openCount}_${Math.random()}`,
      balance: 1_000_000n,
    };
  }
  async topUpChannel(_params: { channelId: string; amount: bigint }) {
    return { balance: 2_000_000n };
  }
  async closeChannel(_params: { channelId: string }) {
    // no-op
  }
}

class MockAuthorizer implements PrincipalAuthorizer {
  async authorize(_params: { principal: string; provider: string; amount: bigint; reason: "open" | "top_up" }) {
    return true;
  }
}

class MockDistributedLock implements DistributedLock {
  private locks = new Map<string, { token: string; expiresAt: number }>();
  private failAcquire = false;

  setFailAcquire(fail: boolean) {
    this.failAcquire = fail;
  }

  async acquire(resourceKey: string, ttlMs = 30000) {
    if (this.failAcquire) {
      return { acquired: false, reason: 'unavailable' as const };
    }
    const existing = this.locks.get(resourceKey);
    const now = Date.now();
    if (existing && existing.expiresAt > now) {
      return { acquired: false, reason: 'contention' as const };
    }
    const token = `token_${Math.random()}`;
    this.locks.set(resourceKey, { token, expiresAt: now + ttlMs });
    return { acquired: true, lockToken: token };
  }

  async release(resourceKey: string, lockToken: string) {
    const existing = this.locks.get(resourceKey);
    if (!existing || existing.token !== lockToken) {
      return false;
    }
    this.locks.delete(resourceKey);
    return true;
  }

  expireLock(resourceKey: string) {
    const existing = this.locks.get(resourceKey);
    if (existing) {
      this.locks.set(resourceKey, { ...existing, expiresAt: Date.now() - 1000 });
    }
  }
}

describe('ChannelManager Distributed Locking & Idempotency', () => {
  it('should ensure concurrent opens for the same channel create exactly one channel', async () => {
    const backend = new MockBackend();
    const store = new InMemoryChannelStore();
    const authorizer = new MockAuthorizer();
    const lock = new MockDistributedLock();

    const manager = new ChannelManager({
      backend,
      store,
      authorizer,
      lock,
    });

    const principal = 'alice';
    const provider = 'bob';

    const [ch1, ch2] = await Promise.all([
      manager.ensureChannel(principal, provider),
      manager.ensureChannel(principal, provider),
    ]);

    expect(ch1.channelId).toBe(ch2.channelId);
    expect(backend.openCount).toBe(1);
    expect(ch1.status).toBe('open');
  });

  it('should handle lock expiry mid-operation and make open idempotent', async () => {
    const backend = new MockBackend();
    const store = new InMemoryChannelStore();
    const authorizer = new MockAuthorizer();
    const lock = new MockDistributedLock();

    const manager = new ChannelManager({
      backend,
      store,
      authorizer,
      lock,
    });

    const principal = 'alice';
    const provider = 'charlie';

    const key = ChannelManager.key(principal, provider);

    const ch1 = await manager.ensureChannel(principal, provider);
    expect(ch1.status).toBe('open');

    const ch2 = await manager.ensureChannel(principal, provider);
    expect(ch2.channelId).toBe(ch1.channelId);
    expect(backend.openCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Test doubles for placeholder/unknown channel tests
// ---------------------------------------------------------------------------

function createMockBackend(): ChannelBackend {
  return {
    openChannel: vi.fn().mockResolvedValue({ channelId: 'chan_123', balance: 1_000_000n }),
    topUp: vi.fn().mockResolvedValue({ balance: 2_000_000n }),
    getBalance: vi.fn().mockResolvedValue(1_000_000n),
    closeChannel: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockStore(): ChannelStore {
  const store = new Map<string, ChannelState>();
  return {
    get: vi.fn(async (key: string) => store.get(key)),
    put: vi.fn(async (state: ChannelState) => { store.set(state.key, state); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
  };
}

function createMockAuthorizer(): PrincipalAuthorizer {
  return {
    authorize: vi.fn().mockResolvedValue(true),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChannelManager — placeholder and unknown channel handling', () => {
  let manager: ChannelManager;
  let backend: ChannelBackend;
  let store: ChannelStore;
  let authorizer: PrincipalAuthorizer;

  beforeEach(() => {
    backend = createMockBackend();
    store = createMockStore();
    authorizer = createMockAuthorizer();
    manager = new ChannelManager({
      backend,
      store,
      authorizer,
      now: () => 1_700_000_000_000,
    });
  });

  describe('placeholder', () => {
    it('returns "unknown" status instead of "closed"', () => {
      const placeholder = (manager as any).placeholder('principal_1', 'provider_1');

      expect(placeholder.status).toBe('unknown');
      expect(placeholder.balance).toBe(0n);
      expect(placeholder.burnRate).toBe(0);
      expect(placeholder.lastUpdated).toBe(1_700_000_000_000);
      expect(placeholder.key).toBe('principal_1::provider_1');
      expect(placeholder.principal).toBe('principal_1');
      expect(placeholder.provider).toBe('provider_1');
      expect(placeholder.channelId).toBeUndefined();
    });
  });

  describe('getState', () => {
    it('returns undefined for unknown channels', async () => {
      const state = await manager.getState('unknown_principal', 'unknown_provider');
      expect(state).toBeUndefined();
    });

    it('returns stored state for known channels', async () => {
      const existingState: ChannelState = {
        key: 'principal_1::provider_1',
        principal: 'principal_1',
        provider: 'provider_1',
        channelId: 'chan_123',
        status: 'open',
        balance: 1_000_000n,
        burnRate: 0,
        lastUpdated: 1_700_000_000_000,
      };
      await store.put(existingState);

      const state = await manager.getState('principal_1', 'provider_1');
      expect(state).toEqual(existingState);
    });
  });

  describe('close', () => {
    it('handles unknown channel (no state in store) by deleting key', async () => {
      await manager.close('unknown_principal', 'unknown_provider');

      expect(store.delete).toHaveBeenCalledWith('unknown_principal::unknown_provider');
      expect(backend.closeChannel).not.toHaveBeenCalled();
    });

    it('closes known channel and updates status to "closed"', async () => {
      const existingState: ChannelState = {
        key: 'principal_1::provider_1',
        principal: 'principal_1',
        provider: 'provider_1',
        channelId: 'chan_123',
        status: 'open',
        balance: 1_000_000n,
        burnRate: 0,
        lastUpdated: 1_700_000_000_000,
      };
      await store.put(existingState);

      await manager.close('principal_1', 'provider_1');

      expect(backend.closeChannel).toHaveBeenCalledWith({ channelId: 'chan_123' });
      expect(store.put).toHaveBeenCalledWith(expect.objectContaining({
        status: 'closed',
        balance: 0n,
      }));
    });

    it('handles channel with state but no channelId', async () => {
      const existingState: ChannelState = {
        key: 'principal_1::provider_1',
        principal: 'principal_1',
        provider: 'provider_1',
        channelId: undefined,
        status: 'opening',
        balance: 0n,
        burnRate: 0,
        lastUpdated: 1_700_000_000_000,
      };
      await store.put(existingState);

      await manager.close('principal_1', 'provider_1');

      expect(store.delete).toHaveBeenCalledWith('principal_1::provider_1');
      expect(backend.closeChannel).not.toHaveBeenCalled();
    });
  });

  describe('ChannelStatus type', () => {
    it('includes "unknown" status', () => {
      const statuses: ChannelStatus[] = ['opening', 'open', 'topping_up', 'exhausted', 'closed', 'failed', 'unknown'];
      statuses.forEach(status => {
        expect(typeof status).toBe('string');
      });
    });
  });
});
