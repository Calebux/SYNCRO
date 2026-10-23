/**
 * Redis / shared counter-store adapter tests (Issue #1442).
 *
 * - Contract suite: same reserve/commit/release/idempotency/cap behaviour as
 *   the in-memory meter path, run against both InMemoryCounterStore and
 *   RedisCounterStore (via FakeRedisClient).
 * - Concurrency: 1,000 parallel reserves against a balance of 100 admit
 *   exactly 100.
 * - Redis-down: adapter throws CounterStoreUnavailableError (degraded mode
 *   is Issue #1444).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CounterStoreUnavailableError, type CounterStore } from './counter-store';
import { InMemoryCounterStore } from './memory-counter-store';
import { RedisCounterStore } from './redis-counter-store';
import { FakeRedisClient } from './fake-redis';
import { RedisMeter } from './redis-meter';
import { StaticDegradedModeEvaluator } from './degraded';
import { OverageError } from './errors';

function makeClock(startMs = 1_700_000_000_000): {
  clock: () => number;
  advance: (ms: number) => void;
} {
  let now = startMs;
  return {
    clock: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

type StoreFactory = {
  name: string;
  create: (opts?: { clock?: () => number; reservationTimeoutMs?: number }) => Promise<{
    store: CounterStore;
    reset?: () => void;
  }>;
};

const factories: StoreFactory[] = [
  {
    name: 'InMemoryCounterStore',
    create: async (opts) => ({
      store: new InMemoryCounterStore(opts),
    }),
  },
  {
    name: 'RedisCounterStore',
    create: async (opts) => {
      const redis = new FakeRedisClient();
      if (opts?.clock) redis.setClock(opts.clock);
      return {
        store: new RedisCounterStore({ redis, ...opts }),
        reset: () => redis.flushAll(),
      };
    },
  },
];

for (const factory of factories) {
  describe(`${factory.name} — counter-store contract`, () => {
    let store: CounterStore;

    beforeEach(async () => {
      const ctx = await factory.create();
      store = ctx.store;
      await store.setLimit('agent-1', 100);
    });

    it('reserve returns a held reservation', async () => {
      const rsv = await store.reserve('agent-1', 'llm:call', 10);
      expect(rsv.id).toMatch(/^rsv_/);
      expect(rsv.principal).toBe('agent-1');
      expect(rsv.route).toBe('llm:call');
      expect(rsv.upperBound).toBe(10);
    });

    it('commit charges actual and releases the difference', async () => {
      const rsv = await store.reserve('agent-1', 'llm:call', 10);
      const result = await store.commit(rsv.id, 7);
      expect(result).toMatchObject({ charged: 7, released: 3 });
      expect(result.replayed).toBeFalsy();
      const reading = await store.read('agent-1');
      expect(reading.used).toBe(7);
      expect(reading.remaining).toBe(93);
    });

    it('release returns the full hold without charging', async () => {
      const rsv = await store.reserve('agent-1', 'llm:call', 10);
      await store.release(rsv.id);
      const rsv2 = await store.reserve('agent-1', 'llm:call', 10);
      expect(rsv2.id).not.toBe(rsv.id);
      const reading = await store.read('agent-1');
      expect(reading.used).toBe(0);
    });

    it('throws when upper-bound exceeds available quota', async () => {
      await expect(store.reserve('agent-1', 'llm:call', 101)).rejects.toThrow(
        /Insufficient allowance|available/i,
      );
    });

    it('respects outstanding holds when computing available', async () => {
      await store.reserve('agent-1', 'llm:call', 80);
      await expect(store.reserve('agent-1', 'llm:call', 30)).rejects.toThrow(
        OverageError,
      );
    });

    it('second commit without idempotency key throws and does not double-charge', async () => {
      const rsv = await store.reserve('agent-1', 'llm:call', 10);
      await store.commit(rsv.id, 7);
      await expect(store.commit(rsv.id, 7)).rejects.toThrow(/not held/i);
      const reading = await store.read('agent-1');
      expect(reading.used).toBe(7);
    });

    it('explicit idempotency key makes a retried commit a no-op replay', async () => {
      const rsv = await store.reserve('agent-1', 'llm:call', 10);
      const first = await store.commit(rsv.id, 7, 'idem-1');
      expect(first.replayed).toBeFalsy();
      const second = await store.commit(rsv.id, 7, 'idem-1');
      expect(second).toMatchObject({ charged: 7, released: 3, replayed: true });
      const reading = await store.read('agent-1');
      expect(reading.used).toBe(7);
    });

    it('rejects commit above the hold', async () => {
      const rsv = await store.reserve('agent-1', 'llm:call', 10);
      await expect(store.commit(rsv.id, 11)).rejects.toThrow(RangeError);
    });

    it('unlimited principal never throws on reserve', async () => {
      const ctx = await factory.create();
      await expect(
        ctx.store.reserve('unlimited', 'llm:call', 9999),
      ).resolves.toMatchObject({ upperBound: 9999 });
    });
  });

  describe(`${factory.name} — expiry sweep`, () => {
    it('expired holds are released on the next reserve', async () => {
      const { clock, advance } = makeClock();
      const ctx = await factory.create({
        clock,
        reservationTimeoutMs: 1_000,
      });
      const store = ctx.store;
      await store.setLimit('agent-1', 10);
      await store.reserve('agent-1', 'llm:call', 10);
      advance(2_000);
      await expect(
        store.reserve('agent-1', 'llm:call', 10),
      ).resolves.toMatchObject({ upperBound: 10 });
    });
  });

  describe(`${factory.name} — concurrency`, () => {
    it('1,000 parallel reserves against a balance of 100 admit exactly 100', async () => {
      const ctx = await factory.create();
      const store = ctx.store;
      await store.setLimit('agent-1', 100);

      const results = await Promise.allSettled(
        Array.from({ length: 1000 }, () =>
          store.reserve('agent-1', 'llm:call', 1),
        ),
      );

      const admitted = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(admitted).toHaveLength(100);
      expect(rejected).toHaveLength(900);

      const reading = await store.read('agent-1');
      expect(reading.held).toBe(100);
      expect(reading.remaining).toBe(0);
    });
  });
}

describe('RedisMeter — same suite as InMemoryMeter (async)', () => {
  let meter: RedisMeter;

  beforeEach(async () => {
    const redis = new FakeRedisClient();
    const store = new RedisCounterStore({ redis });
    meter = new RedisMeter({ store, limits: { 'agent-1': 100 } });
    await meter.ready();
  });

  it('reserve / commit / release / read happy path', async () => {
    const rsv = await meter.reserve('agent-1', 'llm:call', 10);
    expect(rsv.degraded).toBe(false);
    const result = await meter.commit(rsv.id, 7);
    expect(result.charged).toBe(7);
    expect(result.released).toBe(3);
    const reading = await meter.read('agent-1');
    expect(reading.used).toBe(7);
    expect(reading.remaining).toBe(93);
  });

  it('cap enforcement', async () => {
    await expect(meter.reserve('agent-1', 'llm:call', 101)).rejects.toThrow(
      /Insufficient allowance|available/i,
    );
  });

  it('idempotent commit via explicit key does not double-charge', async () => {
    const rsv = await meter.reserve('agent-1', 'llm:call', 10);
    await meter.commit(rsv.id, 7, 'call-1');
    await meter.commit(rsv.id, 7, 'call-1');
    const reading = await meter.read('agent-1');
    expect(reading.used).toBe(7);
  });

  it('overage warnings on commit', async () => {
    const rsv = await meter.reserve('agent-1', 'llm:call', 80);
    const { warnings } = await meter.commit(rsv.id, 80);
    expect(warnings.some((w) => /80|approaching/i.test(w))).toBe(true);
  });

  it('degraded mode: reserve succeeds when quota exhausted', async () => {
    const evaluator = new StaticDegradedModeEvaluator({
      degraded: true,
      servicesToLimit: ['openai'],
    });
    const redis = new FakeRedisClient();
    const store = new RedisCounterStore({ redis });
    const degraded = new RedisMeter({
      store,
      limits: { 'agent-1': 10 },
      degradedEvaluator: evaluator,
    });
    await degraded.ready();
    const rsv1 = await degraded.reserve('agent-1', 'llm:call', 10);
    await degraded.commit(rsv1.id, 10);
    const rsv2 = await degraded.reserve('agent-1', 'llm:call', 5);
    expect(rsv2.degraded).toBe(true);
    expect(rsv2.id).toMatch(/rsv_deg_/);
  });

  it('setLimit raises the cap', async () => {
    await expect(meter.reserve('agent-1', 'llm:call', 101)).rejects.toThrow();
    await meter.setLimit('agent-1', 200);
    await expect(
      meter.reserve('agent-1', 'llm:call', 101),
    ).resolves.toMatchObject({ upperBound: 101 });
  });
});

describe('RedisCounterStore — unavailable Redis', () => {
  it('reserve throws CounterStoreUnavailableError when EVAL fails', async () => {
    const redis: ConstructorParameters<typeof RedisCounterStore>[0]['redis'] = {
      eval: async () => {
        throw new Error('ECONNREFUSED');
      },
      hGet: async () => null,
      hGetAll: async () => ({}),
      hSet: async () => 0,
      ping: async () => {
        throw new Error('ECONNREFUSED');
      },
    };
    const store = new RedisCounterStore({ redis });
    await expect(store.reserve('a', 'r', 1)).rejects.toBeInstanceOf(
      CounterStoreUnavailableError,
    );
  });

  it('ping returns false when Redis is down', async () => {
    const redis: ConstructorParameters<typeof RedisCounterStore>[0]['redis'] = {
      eval: async () => [],
      hGet: async () => null,
      hGetAll: async () => ({}),
      hSet: async () => 0,
      ping: async () => {
        throw new Error('down');
      },
    };
    const store = new RedisCounterStore({ redis });
    expect(await store.ping()).toBe(false);
  });
});
