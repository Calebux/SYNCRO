/**
 * Metering configuration.
 *
 * Idempotency-key lifetime must outlive the SDK's retry window.
 *
 * The SDK (`sdk/src/v3/retry.ts`, `LogicalCallManager`) retries logical
 * calls with the same idempotency key. Its maximum retry span is bounded by
 * `SDK_MAX_RETRY_SPAN_MS`: the sum of all backoff delays across the maximum
 * number of attempts. If the meter forgets a key before the SDK's last
 * retry, a retried call is charged twice; keeping keys forever grows the
 * table without bound (see #126). We therefore keep keys for the SDK retry
 * span plus a safety margin.
 */

/** Maximum number of attempts the SDK's LogicalCallManager will make. */
export const SDK_MAX_RETRY_ATTEMPTS = 5;

/** Base backoff delay (ms) used by the SDK between retries. */
export const SDK_RETRY_BASE_DELAY_MS = 1_000;

/**
 * Maximum retry span (ms) of the SDK's LogicalCallManager: the sum of the
 * exponential backoff delays across all attempts (base * (2^n - 1)).
 */
export const SDK_MAX_RETRY_SPAN_MS =
  SDK_RETRY_BASE_DELAY_MS * (2 ** (SDK_MAX_RETRY_ATTEMPTS - 1) - 1);

/** Safety margin (ms) added on top of the SDK retry span for the meter TTL. */
export const IDEMPOTENCY_TTL_MARGIN_MS = 60_000;

/** Minimum acceptable idempotency-key TTL (ms) for the meter. */
export const MIN_IDEMPOTENCY_TTL_MS =
  SDK_MAX_RETRY_SPAN_MS + IDEMPOTENCY_TTL_MARGIN_MS;

/** Default idempotency-key TTL (ms): SDK retry span plus margin. */
export const DEFAULT_IDEMPOTENCY_TTL_MS = MIN_IDEMPOTENCY_TTL_MS;

export interface MeteringConfig {
  /** How long (ms) the meter retains idempotency keys. */
  idempotencyTtlMs: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Validate metering config. Fails if the idempotency-key TTL is shorter than
 * the SDK's maximum retry span (plus margin), which would allow double
 * charges on retried calls.
 */
export function validateConfig(config: MeteringConfig): MeteringConfig {
  const { idempotencyTtlMs } = config;

  if (!Number.isFinite(idempotencyTtlMs) || idempotencyTtlMs <= 0) {
    throw new ConfigError(
      `idempotencyTtlMs must be a positive number, got ${idempotencyTtlMs}`,
    );
  }

  if (idempotencyTtlMs < MIN_IDEMPOTENCY_TTL_MS) {
    throw new ConfigError(
      `idempotencyTtlMs (${idempotencyTtlMs}ms) must be at least ` +
        `${MIN_IDEMPOTENCY_TTL_MS}ms (SDK max retry span ` +
        `${SDK_MAX_RETRY_SPAN_MS}ms + margin ${IDEMPOTENCY_TTL_MARGIN_MS}ms) ` +
        `to avoid double charges on retried calls`,
    );
  }

  return config;
}

export function loadConfig(
  overrides: Partial<MeteringConfig> = {},
): MeteringConfig {
  return validateConfig({
    idempotencyTtlMs: DEFAULT_IDEMPOTENCY_TTL_MS,
    ...overrides,
  });
}
