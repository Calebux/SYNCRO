/**
 * Redis CounterStore adapter using Lua for atomic reserve / commit / release
 * (Issue #1442).
 *
 * All balance mutations run inside Redis EVAL so concurrent gateway instances
 * cannot over-admit. Idempotency keys (with TTL) ensure a retried commit does
 * not double-count. When Redis is unreachable the adapter throws
 * `CounterStoreUnavailableError`; degraded-mode behaviour is Issue #1444.
 */

import {
  assertActualInHold,
  assertPositiveUpperBound,
  CounterStoreUnavailableError,
  insufficientAllowance,
  nextReservationId,
  notHeldError,
  resolveCounterStoreOptions,
  UNLIMITED_LIMIT,
  type CounterStore,
  type CounterStoreCommitResult,
  type CounterStoreOptions,
  type CounterStoreReading,
  type CounterStoreReservation,
} from './counter-store';

/**
 * Minimal Redis surface used by this adapter. Compatible with `node-redis` v4+
 * (`RedisClientType.eval` / `.hGet` / `.hGetAll` / `.hSet` / `.ping`).
 */
export interface CounterStoreRedisClient {
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
  hGet(key: string, field: string): Promise<string | null | undefined>;
  hGetAll(key: string): Promise<Record<string, string>>;
  hSet(
    key: string,
    field: string | Record<string, string>,
    value?: string,
  ): Promise<number>;
  ping(): Promise<string>;
}

export interface RedisCounterStoreOptions extends CounterStoreOptions {
  /** Key prefix so multiple environments can share one Redis. */
  keyPrefix?: string;
  redis: CounterStoreRedisClient;
}

/**
 * RESERVE — expire stale holds, check available, place hold atomically.
 *
 * KEYS[1] account hash {limit, used}
 * KEYS[2] reservation hash for the new id
 * KEYS[3] principal holds set
 * ARGV[1] upperBound
 * ARGV[2] principal
 * ARGV[3] route
 * ARGV[4] expiresAt ms
 * ARGV[5] reservation id
 * ARGV[6] now ms
 * ARGV[7] reservation key prefix (e.g. meter:v1:rsv:)
 *
 * Returns {ok, id, expiresAt} or {0, available, limit}.
 */
export const RESERVE_LUA = `
local acct, rsv, holds = KEYS[1], KEYS[2], KEYS[3]
local upper = tonumber(ARGV[1])
local principal, route = ARGV[2], ARGV[3]
local expires_at, rsv_id = ARGV[4], ARGV[5]
local now = tonumber(ARGV[6])
local rsv_prefix = ARGV[7]

local members = redis.call('SMEMBERS', holds)
local held = 0
for _, id in ipairs(members) do
  local hkey = rsv_prefix .. id
  local state = redis.call('HGET', hkey, 'state')
  local exp = tonumber(redis.call('HGET', hkey, 'expiresAt') or '0')
  local ub = tonumber(redis.call('HGET', hkey, 'upperBound') or '0')
  if state == 'held' and exp <= now then
    redis.call('HSET', hkey, 'state', 'expired')
    redis.call('SREM', holds, id)
  elseif state == 'held' then
    held = held + ub
  else
    redis.call('SREM', holds, id)
  end
end

local limit_raw = redis.call('HGET', acct, 'limit')
local used = tonumber(redis.call('HGET', acct, 'used') or '0')
local unlimited = (limit_raw == false or limit_raw == nil or limit_raw == '' or limit_raw == 'inf')
local limit = unlimited and -1 or tonumber(limit_raw)
local available = -1
if not unlimited then
  available = limit - used - held
  if available < 0 then available = 0 end
  if upper > available then
    return {0, available, limit}
  end
end

redis.call('HSET', rsv,
  'principal', principal,
  'route', route,
  'upperBound', tostring(upper),
  'expiresAt', expires_at,
  'state', 'held')
redis.call('SADD', holds, rsv_id)
return {1, rsv_id, expires_at}
`;

/**
 * COMMIT — settle hold; explicit idempotency key returns prior result.
 *
 * KEYS[1] account
 * KEYS[2] reservation
 * KEYS[3] holds set
 * KEYS[4] applied key for this reservation (always)
 * KEYS[5] optional explicit idempotency key ("" key means unused — pass a
 *         dummy and ARGV flag)
 * ARGV[1] actual
 * ARGV[2] reservation id
 * ARGV[3] now
 * ARGV[4] ttl ms
 * ARGV[5] "1" if explicit idempotency key is present in KEYS[5], else "0"
 *
 * Returns:
 *   {1, charged, released} fresh commit
 *   {2, charged, released} idempotent replay (explicit key only)
 *   {0, state} not held
 *   {-1, upper} bad actual
 */
export const COMMIT_LUA = `
local acct, rsv, holds = KEYS[1], KEYS[2], KEYS[3]
local applied, idemp = KEYS[4], KEYS[5]
local actual = tonumber(ARGV[1])
local rsv_id = ARGV[2]
local now = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local has_idemp = ARGV[5] == '1'

if has_idemp and redis.call('EXISTS', idemp) == 1 then
  return {
    2,
    tonumber(redis.call('HGET', idemp, 'charged')),
    tonumber(redis.call('HGET', idemp, 'released'))
  }
end

local state = redis.call('HGET', rsv, 'state')
if state ~= 'held' then
  return {0, state or 'unknown'}
end

local exp = tonumber(redis.call('HGET', rsv, 'expiresAt') or '0')
if exp <= now then
  redis.call('HSET', rsv, 'state', 'expired')
  redis.call('SREM', holds, rsv_id)
  return {0, 'expired'}
end

local upper = tonumber(redis.call('HGET', rsv, 'upperBound') or '0')
if actual < 0 or actual > upper then
  return {-1, upper}
end

local charged = actual
local released = upper - actual

if redis.call('EXISTS', applied) == 0 then
  redis.call('HINCRBYFLOAT', acct, 'used', actual)
  redis.call('HSET', applied, 'charged', tostring(charged), 'released', tostring(released))
  redis.call('PEXPIRE', applied, ttl)
end

redis.call('HSET', rsv, 'state', 'committed')
redis.call('SREM', holds, rsv_id)

if has_idemp then
  redis.call('HSET', idemp, 'charged', tostring(charged), 'released', tostring(released))
  redis.call('PEXPIRE', idemp, ttl)
end

return {1, charged, released}
`;

/**
 * RELEASE — drop the hold with no charge.
 *
 * KEYS[1] reservation
 * KEYS[2] holds set
 * ARGV[1] reservation id
 * ARGV[2] now
 */
export const RELEASE_LUA = `
local rsv, holds = KEYS[1], KEYS[2]
local rsv_id = ARGV[1]
local now = tonumber(ARGV[2])

local state = redis.call('HGET', rsv, 'state')
if state ~= 'held' then
  return {0, state or 'unknown'}
end

local exp = tonumber(redis.call('HGET', rsv, 'expiresAt') or '0')
if exp <= now then
  redis.call('HSET', rsv, 'state', 'expired')
  redis.call('SREM', holds, rsv_id)
  return {0, 'expired'}
end

redis.call('HSET', rsv, 'state', 'released')
redis.call('SREM', holds, rsv_id)
return {1}
`;

export const SUM_HELD_LUA = `
local holds = KEYS[1]
local rsv_prefix = ARGV[1]
local now = tonumber(ARGV[2])
local members = redis.call('SMEMBERS', holds)
local held = 0
for _, id in ipairs(members) do
  local hkey = rsv_prefix .. id
  local state = redis.call('HGET', hkey, 'state')
  local exp = tonumber(redis.call('HGET', hkey, 'expiresAt') or '0')
  if state == 'held' and exp > now then
    held = held + tonumber(redis.call('HGET', hkey, 'upperBound') or '0')
  end
end
return held
`;

function coerceArray(result: unknown): unknown[] {
  if (!Array.isArray(result)) {
    throw new CounterStoreUnavailableError(
      `unexpected Redis script result: ${String(result)}`,
    );
  }
  return result;
}

export class RedisCounterStore implements CounterStore {
  private readonly redis: CounterStoreRedisClient;
  private readonly prefix: string;
  private readonly reservationTimeoutMs: number;
  private readonly clock: () => number;
  private readonly idempotencyTtlMs: number;

  constructor(options: RedisCounterStoreOptions) {
    this.redis = options.redis;
    this.prefix = options.keyPrefix ?? 'meter:v1';
    const resolved = resolveCounterStoreOptions(options);
    this.reservationTimeoutMs = resolved.reservationTimeoutMs;
    this.clock = resolved.clock;
    this.idempotencyTtlMs = resolved.idempotency.ttlMs;
  }

  private acctKey(principal: string): string {
    return `${this.prefix}:acct:${principal}`;
  }

  private rsvKey(id: string): string {
    return `${this.prefix}:rsv:${id}`;
  }

  private rsvPrefix(): string {
    return `${this.prefix}:rsv:`;
  }

  private holdsKey(principal: string): string {
    return `${this.prefix}:holds:${principal}`;
  }

  private appliedKey(reservationId: string): string {
    return `${this.prefix}:applied:${reservationId}`;
  }

  private idempKey(key: string): string {
    return `${this.prefix}:idemp:${key}`;
  }

  private async eval(
    script: string,
    keys: string[],
    args: string[],
  ): Promise<unknown> {
    try {
      return await this.redis.eval(script, { keys, arguments: args });
    } catch (err) {
      throw new CounterStoreUnavailableError(
        err instanceof Error ? err.message : 'Redis EVAL failed',
        err,
      );
    }
  }

  async setLimit(principal: string, limit: number): Promise<void> {
    if (!Number.isFinite(limit) || limit < 0) {
      throw new RangeError(
        `limit must be a non-negative finite number, got ${limit}`,
      );
    }
    try {
      await this.redis.hSet(this.acctKey(principal), 'limit', String(limit));
    } catch (err) {
      throw new CounterStoreUnavailableError(
        err instanceof Error ? err.message : 'Redis HSET failed',
        err,
      );
    }
  }

  async reserve(
    principal: string,
    route: string,
    upperBound: number,
  ): Promise<CounterStoreReservation> {
    assertPositiveUpperBound(upperBound);
    const id = nextReservationId();
    const now = this.clock();
    const expiresAt = now + this.reservationTimeoutMs;

    const raw = coerceArray(
      await this.eval(
        RESERVE_LUA,
        [this.acctKey(principal), this.rsvKey(id), this.holdsKey(principal)],
        [
          String(upperBound),
          principal,
          route,
          String(expiresAt),
          id,
          String(now),
          this.rsvPrefix(),
        ],
      ),
    );

    const status = Number(raw[0]);
    if (status === 0) {
      throw insufficientAllowance(Number(raw[1]), upperBound, Number(raw[2]));
    }

    return {
      id: String(raw[1] ?? id),
      principal,
      route,
      upperBound,
      expiresAt: Number(raw[2] ?? expiresAt),
    };
  }

  async commit(
    reservationId: string,
    actual: number,
    idempotencyKey?: string,
  ): Promise<CounterStoreCommitResult> {
    let principal = '';
    let upperBound = actual;
    try {
      const rsv = await this.redis.hGetAll(this.rsvKey(reservationId));
      principal = rsv.principal ?? '';
      if (rsv.upperBound != null && rsv.upperBound !== '') {
        upperBound = Number(rsv.upperBound);
      }
    } catch (err) {
      throw new CounterStoreUnavailableError(
        err instanceof Error ? err.message : 'Redis HGETALL failed',
        err,
      );
    }
    assertActualInHold(actual, Number.isFinite(upperBound) ? upperBound : actual);

    const hasIdemp = Boolean(idempotencyKey);
    const raw = coerceArray(
      await this.eval(
        COMMIT_LUA,
        [
          this.acctKey(principal),
          this.rsvKey(reservationId),
          this.holdsKey(principal),
          this.appliedKey(reservationId),
          hasIdemp ? this.idempKey(idempotencyKey!) : this.idempKey('_unused'),
        ],
        [
          String(actual),
          reservationId,
          String(this.clock()),
          String(this.idempotencyTtlMs),
          hasIdemp ? '1' : '0',
        ],
      ),
    );

    const status = Number(raw[0]);
    if (status === 0) {
      throw notHeldError(reservationId, String(raw[1] ?? 'unknown'));
    }
    if (status === -1) {
      throw new RangeError(
        `actual must be within [0, ${raw[1]}], got ${actual}`,
      );
    }
    const result: CounterStoreCommitResult = {
      charged: Number(raw[1]),
      released: Number(raw[2]),
    };
    if (status === 2) result.replayed = true;
    return result;
  }

  async release(reservationId: string): Promise<void> {
    let principal = '';
    try {
      principal =
        (await this.redis.hGet(this.rsvKey(reservationId), 'principal')) ?? '';
    } catch (err) {
      throw new CounterStoreUnavailableError(
        err instanceof Error ? err.message : 'Redis HGET failed',
        err,
      );
    }

    const raw = coerceArray(
      await this.eval(
        RELEASE_LUA,
        [this.rsvKey(reservationId), this.holdsKey(principal)],
        [reservationId, String(this.clock())],
      ),
    );
    if (Number(raw[0]) !== 1) {
      throw notHeldError(reservationId, String(raw[1] ?? 'unknown'));
    }
  }

  async read(principal: string): Promise<CounterStoreReading> {
    try {
      const acct = await this.redis.hGetAll(this.acctKey(principal));
      const limitRaw = acct.limit;
      const limit =
        limitRaw === undefined || limitRaw === '' || limitRaw === 'inf'
          ? UNLIMITED_LIMIT
          : Number(limitRaw);
      const used = Number(acct.used ?? 0);
      const heldRaw = await this.eval(
        SUM_HELD_LUA,
        [this.holdsKey(principal)],
        [this.rsvPrefix(), String(this.clock())],
      );
      const held = Number(heldRaw ?? 0);
      const remaining =
        limit === UNLIMITED_LIMIT
          ? UNLIMITED_LIMIT
          : Math.max(0, limit - used - held);
      return { principal, used, limit, held, remaining };
    } catch (err) {
      if (err instanceof CounterStoreUnavailableError) throw err;
      throw new CounterStoreUnavailableError(
        err instanceof Error ? err.message : 'Redis read failed',
        err,
      );
    }
  }

  async ping(): Promise<boolean> {
    try {
      const pong = await this.redis.ping();
      return typeof pong === 'string' && pong.length > 0;
    } catch {
      return false;
    }
  }
}
