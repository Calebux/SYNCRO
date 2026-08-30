/**
 * RFC 7807 Problem Details for HTTP APIs
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  requestId?: string;
  errors?: Array<{
    field: string;
    message: string;
  }>;
}

/**
 * Base error class for all Syncro SDK errors.
 */
export class SyncroError extends Error {
  public readonly type: string;
  public readonly title: string;
  public readonly status: number;
  public readonly detail?: string;
  public readonly instance?: string;
  public readonly requestId?: string;
  public readonly validationErrors?: Array<{ field: string; message: string }>;

  constructor(problem: ProblemDetails | string, code?: string) {
    if (typeof problem === "string") {
      super(problem);
      this.type = "about:blank";
      this.title = code || "SyncroError";
      this.status = 500;
      this.detail = problem;
    } else {
      super(problem.detail || problem.title);
      this.type = problem.type;
      this.title = problem.title;
      this.status = problem.status;
      this.detail = problem.detail;
      this.instance = problem.instance;
      this.requestId = problem.requestId;
      this.validationErrors = problem.errors;
    }
    this.name = this.constructor.name;
    
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, new.target.prototype);
    }
  }
}

/**
 * Thrown when a requested resource is not found (HTTP 404).
 */
export class NotFoundError extends SyncroError {
  constructor(problem: ProblemDetails | string) {
    super(problem, "NOT_FOUND");
  }
}

/**
 * Thrown when authentication fails (HTTP 401).
 */
export class AuthenticationError extends SyncroError {
  constructor(problem: ProblemDetails | string) {
    super(problem, "AUTHENTICATION_ERROR");
  }
}

/**
 * Thrown when access is forbidden (HTTP 403).
 */
export class ForbiddenError extends SyncroError {
  constructor(problem: ProblemDetails | string) {
    super(problem, "FORBIDDEN");
  }
}

/**
 * Thrown when the API rate limit is exceeded (HTTP 429).
 */
export class RateLimitError extends SyncroError {
  constructor(problem: ProblemDetails | string) {
    super(problem, "RATE_LIMIT_EXCEEDED");
  }
}

/**
 * Thrown when request input fails validation (HTTP 400).
 */
export class ValidationError extends SyncroError {
  constructor(problem: ProblemDetails | string) {
    super(problem, "VALIDATION_ERROR");
  }
}

/**
 * Thrown when a conflict occurs (HTTP 409).
 */
export class ConflictError extends SyncroError {
  constructor(problem: ProblemDetails | string) {
    super(problem, "CONFLICT");
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
    type: data?.type || "about:blank",
    title: data?.title || "Unknown Error",
    status: status,
    detail: data?.detail || data?.error || data?.message || "An error occurred",
    instance: data?.instance,
    requestId: data?.requestId,
    errors: data?.errors,
  };

  switch (status) {
    case 400:
      return new ValidationError(problem);
    case 401:
      return new AuthenticationError(problem);
    case 403:
      return new ForbiddenError(problem);
    case 404:
      return new NotFoundError(problem);
    case 409:
      return new ConflictError(problem);
    case 429:
      return new RateLimitError(problem);
    default:
      return new SyncroError(problem);
  }
}
