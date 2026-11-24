/**
 * In-process Redis stand-in that executes the counter-store Lua scripts via
 * JS mirrors. Used so the Redis adapter suite (including the 1,000-way
 * concurrency test) can run without a live Redis. Production always goes
 * through real EVAL.
 *
 * Command execution is serialised on a promise chain to match Redis's
 * single-threaded semantics.
 */

import {
  COMMIT_LUA,
  RELEASE_LUA,
  RESERVE_LUA,
  SUM_HELD_LUA,
  type CounterStoreRedisClient,
} from './redis-counter-store';

type Hash = Map<string, string>;

export class FakeRedisClient implements CounterStoreRedisClient {
  private readonly hashes = new Map<string, Hash>();
  private readonly sets = new Map<string, Set<string>>();
  private readonly ttls = new Map<string, number>();
  private chain: Promise<unknown> = Promise.resolve();
  private nowMs = () => Date.now();

  /** Override wall clock used for PEXPIRE checks (test helper). */
  setClock(clock: () => number): void {
    this.nowMs = clock;
  }

  private async serial<T>(fn: () => T): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private hash(key: string): Hash {
    let h = this.hashes.get(key);
    if (!h) {
      h = new Map();
      this.hashes.set(key, h);
    }
    return h;
  }

  private set(key: string): Set<string> {
    let s = this.sets.get(key);
    if (!s) {
      s = new Set();
      this.sets.set(key, s);
    }
    return s;
  }

  private expired(key: string): boolean {
    const exp = this.ttls.get(key);
    return exp !== undefined && exp <= this.nowMs();
  }

  private ensureAlive(key: string): void {
    if (this.expired(key)) {
      this.hashes.delete(key);
      this.sets.delete(key);
      this.ttls.delete(key);
    }
  }

  async ping(): Promise<string> {
    return 'PONG';
  }

  async hGet(key: string, field: string): Promise<string | null> {
    return this.serial(() => {
      this.ensureAlive(key);
      return this.hashes.get(key)?.get(field) ?? null;
    });
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    return this.serial(() => {
      this.ensureAlive(key);
      const h = this.hashes.get(key);
      if (!h) return {};
      return Object.fromEntries(h.entries());
    });
  }

  async hSet(
    key: string,
    field: string | Record<string, string>,
    value?: string,
  ): Promise<number> {
    return this.serial(() => {
      this.ensureAlive(key);
      const h = this.hash(key);
      let added = 0;
      if (typeof field === 'string') {
        if (!h.has(field)) added = 1;
        h.set(field, value ?? '');
      } else {
        for (const [k, v] of Object.entries(field)) {
          if (!h.has(k)) added += 1;
          h.set(k, v);
        }
      }
      return added;
    });
  }

  async eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown> {
    return this.serial(() => this.runScript(script, options.keys, options.arguments));
  }

  private runScript(script: string, keys: string[], args: string[]): unknown {
    // Drop expired keys before script body.
    for (const k of [...this.hashes.keys(), ...this.sets.keys()]) {
      this.ensureAlive(k);
    }

    if (script === RESERVE_LUA) return this.reserve(keys, args);
    if (script === COMMIT_LUA) return this.commit(keys, args);
    if (script === RELEASE_LUA) return this.release(keys, args);
    if (script === SUM_HELD_LUA) return this.sumHeld(keys, args);
    throw new Error('FakeRedisClient: unknown script');
  }

  private reserve(keys: string[], args: string[]): unknown {
    const [acctKey, rsvKey, holdsKey] = keys;
    const upper = Number(args[0]);
    const principal = args[1]!;
    const route = args[2]!;
    const expiresAt = args[3]!;
    const rsvId = args[4]!;
    const now = Number(args[5]);
    const rsvPrefix = args[6]!;

    const holds = this.set(holdsKey!);
    let held = 0;
    for (const id of [...holds]) {
      const hkey = rsvPrefix + id;
      this.ensureAlive(hkey);
      const h = this.hashes.get(hkey);
      const state = h?.get('state');
      const exp = Number(h?.get('expiresAt') ?? 0);
      const ub = Number(h?.get('upperBound') ?? 0);
      if (state === 'held' && exp <= now) {
        h!.set('state', 'expired');
        holds.delete(id);
      } else if (state === 'held') {
        held += ub;
      } else {
        holds.delete(id);
      }
    }

    const acct = this.hash(acctKey!);
    const limitRaw = acct.get('limit');
    const used = Number(acct.get('used') ?? 0);
    const unlimited =
      limitRaw === undefined || limitRaw === '' || limitRaw === 'inf';
    const limit = unlimited ? -1 : Number(limitRaw);
    if (!unlimited) {
      let available = limit - used - held;
      if (available < 0) available = 0;
      if (upper > available) return [0, available, limit];
    }

    const rsv = this.hash(rsvKey!);
    rsv.set('principal', principal);
    rsv.set('route', route);
    rsv.set('upperBound', String(upper));
    rsv.set('expiresAt', expiresAt);
    rsv.set('state', 'held');
    holds.add(rsvId);
    return [1, rsvId, expiresAt];
  }

  private commit(keys: string[], args: string[]): unknown {
    const [acctKey, rsvKey, holdsKey, appliedKey, idempKey] = keys;
    const actual = Number(args[0]);
    const rsvId = args[1]!;
    const now = Number(args[2]);
    const ttl = Number(args[3]);
    const hasIdemp = args[4] === '1';

    if (hasIdemp) {
      this.ensureAlive(idempKey!);
      const idemp = this.hashes.get(idempKey!);
      if (idemp) {
        return [
          2,
          Number(idemp.get('charged')),
          Number(idemp.get('released')),
        ];
      }
    }

    this.ensureAlive(rsvKey!);
    const rsv = this.hashes.get(rsvKey!);
    const state = rsv?.get('state');
    if (state !== 'held') return [0, state ?? 'unknown'];

    const exp = Number(rsv!.get('expiresAt') ?? 0);
    if (exp <= now) {
      rsv!.set('state', 'expired');
      this.set(holdsKey!).delete(rsvId);
      return [0, 'expired'];
    }

    const upper = Number(rsv!.get('upperBound') ?? 0);
    if (actual < 0 || actual > upper) return [-1, upper];

    const charged = actual;
    const released = upper - actual;

    this.ensureAlive(appliedKey!);
    if (!this.hashes.has(appliedKey!)) {
      const acct = this.hash(acctKey!);
      acct.set('used', String(Number(acct.get('used') ?? 0) + actual));
      const applied = this.hash(appliedKey!);
      applied.set('charged', String(charged));
      applied.set('released', String(released));
      this.ttls.set(appliedKey!, now + ttl);
    }

    rsv!.set('state', 'committed');
    this.set(holdsKey!).delete(rsvId);

    if (hasIdemp) {
      const idemp = this.hash(idempKey!);
      idemp.set('charged', String(charged));
      idemp.set('released', String(released));
      this.ttls.set(idempKey!, now + ttl);
    }

    return [1, charged, released];
  }

  private release(keys: string[], args: string[]): unknown {
    const [rsvKey, holdsKey] = keys;
    const rsvId = args[0]!;
    const now = Number(args[1]);

    this.ensureAlive(rsvKey!);
    const rsv = this.hashes.get(rsvKey!);
    const state = rsv?.get('state');
    if (state !== 'held') return [0, state ?? 'unknown'];

    const exp = Number(rsv!.get('expiresAt') ?? 0);
    if (exp <= now) {
      rsv!.set('state', 'expired');
      this.set(holdsKey!).delete(rsvId);
      return [0, 'expired'];
    }

    rsv!.set('state', 'released');
    this.set(holdsKey!).delete(rsvId);
    return [1];
  }

  private sumHeld(keys: string[], args: string[]): unknown {
    const holdsKey = keys[0]!;
    const rsvPrefix = args[0]!;
    const now = Number(args[1]);
    let held = 0;
    for (const id of this.set(holdsKey)) {
      const hkey = rsvPrefix + id;
      this.ensureAlive(hkey);
      const h = this.hashes.get(hkey);
      if (h?.get('state') === 'held' && Number(h.get('expiresAt') ?? 0) > now) {
        held += Number(h.get('upperBound') ?? 0);
      }
    }
    return held;
  }

  /** Test helper: wipe all keys. */
  flushAll(): void {
    this.hashes.clear();
    this.sets.clear();
    this.ttls.clear();
  }
}
