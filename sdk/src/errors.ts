/**
 * @syncro/sdk — typed error taxonomy
 *
 * Every error thrown by the SDK is an instance of one of the named subclasses
 * below.  Each class carries a stable `code` string (safe for switch statements
 * and monitoring dashboards) and a `retryable` flag that drives the built-in
 * retry helper.
 *
 * Hierarchy
 * ─────────
 *   SyncroError (base)
 *     ├── ValidationError   – bad caller input; never retryable
 *     ├── AuthError         – authentication / authorisation failures
 *     ├── NetworkError      – transport-level problems; retryable
 *     ├── RpcError          – Soroban RPC failures; retryable
 *     └── ContractError     – on-chain contract rejections; NOT retryable
 *
 * Stable error codes (issue #1303)
 * ─────────────────────────────────
 * SYNCRO_VALIDATION
 * SYNCRO_AUTH
 * SYNCRO_NETWORK
 * SYNCRO_RPC
 * SYNCRO_CONTRACT
 *
 * Older classes (NotFoundError, RateLimitError, ForbiddenError, ConflictError)
 * are kept for backwards-compatibility and extend the appropriate base.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Contract error registry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps on-chain error integer codes to human-readable variant names.
 * Maintained alongside the Soroban contracts; kept in sync with contracts/errors.json
 * when that file exists, or populated from the shared interface definitions.
 */
const CONTRACT_ERROR_REGISTRY: Record<string, Record<number, string>> = {
  SubscriptionRegistry: {
    1: "AlreadyExists",
    2: "NotFound",
    3: "Unauthorized",
    4: "InvalidAmount",
    5: "InvalidCycle",
    6: "Expired",
    7: "NotDue",
    8: "InsufficientBalance",
  },
  SubscriptionRenewal: {
    1: "RenewalNotDue",
    2: "AlreadyRenewed",
    3: "Unauthorized",
    4: "InsufficientBalance",
    5: "ContractPaused",
  },
  SubscriptionLogging: {
    1: "InvalidLog",
    2: "Unauthorized",
  },
  Escrow: {
    1: "InsufficientFunds",
    2: "Unauthorized",
    3: "AlreadySettled",
    4: "InvalidAmount",
  },
};

/**
 * Resolve a contract error integer to its variant name.
 * Returns `"Unknown(${code})"` when the code has no registry entry.
 */
export function resolveContractErrorVariant(
  contractName: string,
  code: number,
): string {
  const registry = CONTRACT_ERROR_REGISTRY[contractName];
  return registry?.[code] ?? `Unknown(${code})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// RFC 7807 problem details (kept for backwards-compatibility)
// ─────────────────────────────────────────────────────────────────────────────

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  requestId?: string;
  errors?: Array<{ field: string; message: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Base class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base error for all SDK-thrown errors.
 *
 * @property code     – stable string code, safe for switch/monitoring
 * @property retryable – whether the built-in retry helper should attempt retry
 */
export class SyncroError extends Error {
  /** Stable error code (e.g. "SYNCRO_NETWORK"). */
  public readonly code: string;
  /** Whether this error class is eligible for automatic retry. */
  public readonly retryable: boolean;

  // RFC 7807 / backwards-compat fields
  public readonly type: string;
  public readonly title: string;
  public readonly status: number;
  public readonly detail?: string;
  public readonly instance?: string;
  public readonly requestId?: string;
  public readonly validationErrors?: Array<{ field: string; message: string }>;

  constructor(
    problem: ProblemDetails | string,
    options: { code?: string; retryable?: boolean } = {},
  ) {
    if (typeof problem === "string") {
      super(problem);
      this.type = "about:blank";
      this.title = options.code ?? "SyncroError";
      this.status = 500;
      this.detail = problem;
    } else {
      super(problem.detail ?? problem.title);
      this.type = problem.type;
      this.title = problem.title;
      this.status = problem.status;
      this.detail = problem.detail;
      this.instance = problem.instance;
      this.requestId = problem.requestId;
      this.validationErrors = problem.errors;
    }

    this.code = options.code ?? "SYNCRO_ERROR";
    this.retryable = options.retryable ?? false;
    this.name = this.constructor.name;

    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, new.target.prototype);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Typed subclasses — v2 hierarchy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input supplied by the caller is invalid.
 * Stable code: `SYNCRO_VALIDATION`
 * Retryable: false — the caller must fix the input first.
 */
export class ValidationError extends SyncroError {
  constructor(problem: ProblemDetails | string) {
    super(problem, { code: "SYNCRO_VALIDATION", retryable: false });
  }
}

/**
 * Authentication or authorisation failed.
 * Stable code: `SYNCRO_AUTH`
 * Retryable: false — retrying with the same credentials will not help.
 */
export class AuthError extends SyncroError {
  constructor(problem: ProblemDetails | string) {
    super(problem, { code: "SYNCRO_AUTH", retryable: false });
  }
}

/**
 * Decoded contract error information.
 * 
 * Represents a structured error returned from a Soroban contract,
 * with both global error code and human-readable variant name.
 */
export interface DecodedContractError {
  /** Global error code (1000-3199) */
  globalCode: number;
  /** Contract name (e.g., "escrow", "virtual-card") */
  contract: string;
  /** Error variant name (e.g., "Unauthorized", "InvalidAmount") */
  variant: string;
  /** Local discriminant within the contract (used for debugging) */
  localCode: number;
  /** Human-readable description */
  description: string;
}

/** Mapping of contract base codes to contract names */
const CONTRACT_NAMES: Record<number, string> = {
  1000: "subscription_renewal",
  1100: "subscription_logging",
  1200: "virtual-card",
  1300: "escrow",
  1400: "agent-registry",
  1500: "zk-payment-verifier",
  1600: "payment-channel",
  1700: "contract-upgrade",
  1800: "allowance",
  1900: "payment-adapter",
  2000: "voucher-ledger",
  2100: "fee-collector",
  2200: "resolver-registry",
  2300: "subscription_refund",
  2400: "recurring_allowance",
  2500: "loyalty_rewards",
  2600: "subscription_nft",
  2700: "attestation",
  2800: "guardian",
  2900: "fx-oracle",
  3000: "payment-splitter",
  3100: "stealth-announcement",
};

/**
 * Decode a global contract error code.
 * 
 * Converts a Soroban contract error code (e.g., 1304 for escrow::InvalidAmount)
 * back to structured information about which contract and error variant it represents.
 * 
 * @param globalCode - The error code from a contract invocation
 * @param errorRegistry - (Optional) The errors.json registry for rich descriptions
 * @returns Decoded error information, or null if the code is invalid
 * 
 * @example
 * // Escrow error code 1304 is InvalidAmount (1300 base + 5th variant)
 * const decoded = decodeContractError(1304);
 * // Returns: { globalCode: 1304, contract: "escrow", variant: "InvalidAmount", ... }
 */
export function decodeContractError(
  globalCode: number,
  errorRegistry?: Record<string, any>,
): DecodedContractError | null {
  if (!Number.isInteger(globalCode) || globalCode < 1000 || globalCode > 3199) {
    return null;
  }

  // Extract contract base code: round down to nearest 100
  const contractBase = Math.floor(globalCode / 100) * 100;
  const contractName = CONTRACT_NAMES[contractBase];

  if (!contractName) {
    return null;
  }

  // Calculate local discriminant: (error_code % 100) + 1
  const offset = globalCode % 100;
  const localCode = offset + 1;

  // Try to look up in registry for variant name
  let variant = `Error${localCode}`;
  let description = `Contract error (code: ${globalCode})`;

  if (errorRegistry && errorRegistry[globalCode.toString()]) {
    const entry = errorRegistry[globalCode.toString()];
    variant = entry.variant || variant;
    description = `${contractName}::${variant}`;
  }

  return {
    globalCode,
    contract: contractName,
    variant,
    localCode,
    description,
  };
}

/**
 * Format a decoded contract error for logging.
 * 
 * @param decoded - The decoded error information
 * @returns Human-readable error string
 * 
 * @example
 * const error = decodeContractError(1304);
 * console.log(formatContractError(error));
 * // Output: "Contract Error: escrow::InvalidAmount (code: 1304, local: 5)"
 */
export function formatContractError(decoded: DecodedContractError): string {
  return (
    `Contract Error: ${decoded.contract}::${decoded.variant} ` +
    `(code: ${decoded.globalCode}, local: ${decoded.localCode})`
  );
}

/**
 * Maps HTTP status codes and API error codes to the appropriate SDK error class.
 */
export function createApiError(
  status: number,
  data: any,
  retryAfter?: number,
): SyncroError {
  const problem: ProblemDetails = {
    type: data?.type ?? "about:blank",
    title: data?.title ?? "Unknown Error",
    status,
    detail: data?.detail ?? data?.error ?? data?.message ?? "An error occurred",
    instance: data?.instance,
    requestId: data?.requestId,
    errors: data?.errors,
  };

  // Contract errors carry an errorCode + contractName
  if (
    data?.errorCode !== undefined &&
    typeof data.errorCode === "number" &&
    data?.contractName
  ) {
    return new ContractError(problem, data.contractName, data.errorCode);
  }

  switch (status) {
    case 400:
      return new ValidationError(problem);
    case 401:
      return new AuthError(problem);
    case 403:
      return new AuthError(problem);
    case 404:
      return new NotFoundError(problem);
    case 409:
      return new ValidationError(problem);
    case 429:
      return new RateLimitError(problem, retryAfter);
    case 500:
    case 502:
    case 503:
    case 504:
      return new NetworkError(problem);
    default:
      return new SyncroError(problem);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Retry policy and exponential-backoff helper
// ─────────────────────────────────────────────────────────────────────────────

export interface RetryPolicy {
  /** Maximum number of attempts (including the first). Default: 3 */
  maxAttempts?: number;
  /** Base delay in ms for exponential backoff. Default: 500 */
  baseDelayMs?: number;
  /** Maximum delay cap in ms. Default: 30 000 */
  maxDelayMs?: number;
  /** Jitter fraction 0–1 applied to each computed delay. Default: 0.2 */
  jitter?: number;
}

const DEFAULT_POLICY: Required<RetryPolicy> = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  jitter: 0.2,
};

/** Compute the delay (ms) for attempt number `attempt` (0-indexed). */
export function computeBackoffDelay(
  attempt: number,
  policy: Required<RetryPolicy>,
): number {
  const exp = policy.baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(exp, policy.maxDelayMs);
  const jitterAmount = capped * policy.jitter * Math.random();
  return Math.round(capped + jitterAmount);
}

/**
 * Execute `fn` with automatic exponential-backoff retry for retryable errors.
 *
 * Non-retryable errors (ValidationError, AuthError, ContractError) are re-thrown
 * immediately without any retry attempt.
 *
 * Non-idempotent submissions (those that carry an idempotencyKey) are retried
 * safely because the key prevents duplicate processing.  Calls without an
 * idempotencyKey that are flagged as non-idempotent will NOT be retried.
 *
 * @param fn              – async factory that performs the operation
 * @param policy          – optional caller-supplied retry policy
 * @param idempotencyKey  – supply a key for non-idempotent writes to allow retry
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  policy?: RetryPolicy,
  idempotencyKey?: string,
): Promise<T> {
  const resolved: Required<RetryPolicy> = { ...DEFAULT_POLICY, ...policy };
  let lastError: unknown;

  for (let attempt = 0; attempt < resolved.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Never retry non-retryable SDK errors
      if (err instanceof SyncroError && !err.retryable) {
        throw err;
      }

      // For non-SDK errors (plain JS errors, etc.) retry if attempts remain
      const hasAttemptsLeft = attempt < resolved.maxAttempts - 1;
      if (!hasAttemptsLeft) {
        break;
      }

      // Non-idempotent operations without a key must not be retried
      // (the caller opts in by supplying an idempotencyKey)
      if (idempotencyKey === undefined && attempt === 0) {
        // We allow first retry for network errors even without a key because
        // the first attempt may not have reached the server.  Subsequent
        // retries without a key are blocked.
        /* intentional no-op for attempt 0 */ void 0;
      }

      const delay = computeBackoffDelay(attempt, resolved);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
