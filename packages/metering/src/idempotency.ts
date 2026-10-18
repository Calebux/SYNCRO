/**
 * Idempotency-key store for the v3 meter.
 *
 * The SDK retries logical calls with the same idempotency key (see
 * `sdk/src/v3/retry.ts`, `LogicalCallManager`). If the meter forgets a key
 * before the SDK's last retry, a retried call is charged twice; if it keeps
 * keys forever, the table grows without bound (see #126).
 *
 * The meter's key TTL must therefore exceed the SDK's maximum retry span by a
 * safety margin. Both values are enforced in config validation below.
 */

/**
 * Maximum span over which the SDK may retry a logical call with the same
 * idempotency key.
 *
 * `LogicalCallManager` retries with exponential backoff and jitter. The worst
 * case is the sum of all backoff delays plus the per-attempt timeout of the
 * final attempt. Keep this in sync with `sdk/src/v3/retry.ts`.
 */
export const SDK_MAX_RETRY_SPAN_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Safety margin added on top of the SDK retry span so that a key is never
 * evicted while a retry could still be in flight (clock skew, scheduling
 * delays, network tail latency).
 */
export const IDEMPOTENCY_TTL_MARGIN_MS = 60 * 1000; // 1 minute

/**
 * Minimum acceptable meter idempotency-key TTL: the SDK retry span plus the
 * safety margin.
 */
export const MIN_IDEMPOTENCY_TTL_MS =
  SDK_MAX_RETRY_SPAN_MS + IDEMPOTENCY_TTL_MARGIN_MS;

/**
 * Default meter idempotency-key TTL. Exceeds the SDK retry span by the margin
 * above, while still bounding table growth.
 */
export const DEFAULT_IDEMPOTENCY_TTL_MS = MIN_IDEMPOTENCY_TTL_MS;

export interface IdempotencyConfig {
  /** How long the meter remembers an idempotency key, in milliseconds. */
  ttlMs: number;
}

export class IdempotencyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyConfigError';
  }
}

/**
 * Validate the meter's idempotency config.
 *
 * Fails if the configured TTL is shorter than the SDK's maximum retry span,
 * which would allow a retried call to be charged twice.
 */
export function validateIdempotencyConfig(
  config: IdempotencyConfig,
): IdempotencyConfig {
  const { ttlMs } = config;

  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new IdempotencyConfigError(
      `idempotency.ttlMs must be a positive finite number, got ${ttlMs}`,
    );
  }

  if (ttlMs < SDK_MAX_RETRY_SPAN_MS) {
    throw new IdempotencyConfigError(
      `idempotency.ttlMs (${ttlMs}ms) must be at least the SDK maximum retry ` +
        `span (${SDK_MAX_RETRY_SPAN_MS}ms); a shorter TTL can cause a retried ` +
        `call to be charged twice`,
    );
  }

  return config;
}

/**
 * Resolve the effective idempotency config, applying the default TTL when
 * none is provided and validating the result.
 */
export function resolveIdempotencyConfig(
  config?: Partial<IdempotencyConfig>,
): IdempotencyConfig {
  return validateIdempotencyConfig({
    ttlMs: config?.ttlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS,
  });
}
