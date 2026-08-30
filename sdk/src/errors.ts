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
