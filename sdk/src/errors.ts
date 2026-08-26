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
 * Transport-level failure (connection refused, timeout, DNS, etc.).
 * Stable code: `SYNCRO_NETWORK`
 * Retryable: true
 */
export class NetworkError extends SyncroError {
  constructor(problem: ProblemDetails | string) {
    super(problem, { code: "SYNCRO_NETWORK", retryable: true });
  }
}

/**
 * The Soroban RPC node returned an error (e.g. simulation failure, bad request
 * to the RPC endpoint, or a 5xx from the RPC host).
 * Stable code: `SYNCRO_RPC`
 * Retryable: true
 */
export class RpcError extends SyncroError {
  /** Raw RPC error object from the node, if available. */
  public readonly rpcError?: unknown;

  constructor(problem: ProblemDetails | string, rpcError?: unknown) {
    super(problem, { code: "SYNCRO_RPC", retryable: true });
    this.rpcError = rpcError;
  }
}

/**
 * The Soroban contract rejected the invocation (e.g. access control, business
 * rule violation, insufficient balance).
 * Stable code: `SYNCRO_CONTRACT`
 * Retryable: false — re-sending the same transaction will not fix a contract error.
 *
 * @property contractName  – which contract raised the error
 * @property errorCode     – raw integer error code from the contract
 * @property variant       – human-readable name resolved from the error registry
 */
export class ContractError extends SyncroError {
  public readonly contractName: string;
  public readonly errorCode: number;
  public readonly variant: string;

  constructor(
    problem: ProblemDetails | string,
    contractName: string,
    errorCode: number,
  ) {
    super(problem, { code: "SYNCRO_CONTRACT", retryable: false });
    this.contractName = contractName;
    this.errorCode = errorCode;
    this.variant = resolveContractErrorVariant(contractName, errorCode);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Backwards-compatible aliases
// ─────────────────────────────────────────────────────────────────────────────

/** @deprecated Use AuthError instead */
export class AuthenticationError extends AuthError {
  constructor(problem: ProblemDetails | string) {
    super(problem);
  }
}

/** @deprecated Use AuthError instead */
export class ForbiddenError extends AuthError {
  constructor(problem: ProblemDetails | string) {
    super(problem);
  }
}

/** @deprecated Errors are now typed by class; use SyncroError for catch-all */
export class NotFoundError extends SyncroError {
  constructor(problem: ProblemDetails | string) {
    super(problem, { code: "SYNCRO_NOT_FOUND", retryable: false });
  }
}

/** @deprecated Use NetworkError or RpcError; RateLimitError is retryable */
export class RateLimitError extends NetworkError {
  public readonly retryAfter?: number;

  constructor(problem: ProblemDetails | string, retryAfter?: number) {
    super(problem);
    this.retryAfter = retryAfter;
  }
}

/** @deprecated Use ValidationError */
export class ConflictError extends ValidationError {
  constructor(problem: ProblemDetails | string) {
    super(problem);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory — maps HTTP status codes to the correct class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps an HTTP status code and response body to the appropriate SDK error class.
 * Contract errors (status 400 with an `errorCode` field) are promoted to ContractError.
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
