/**
 * Base class for all application errors that should be returned to the client
 * following the RFC 7807 Problem Details for HTTP APIs format.
 */
export class AppError extends Error {
  constructor(
    public title: string,
    public status: number,
    public detail: string,
    public type: string = 'about:blank',
    public extensions?: Record<string, any>
  ) {
    super(detail);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Thrown when a requested resource is not found (HTTP 404).
 */
export class NotFoundError extends AppError {
  constructor(detail: string) {
    super('Not Found', 404, detail, 'https://syncro.app/errors/not-found');
  }
}

/**
 * Thrown when request input fails validation (HTTP 400).
 */
export class ValidationError extends AppError {
  constructor(detail: string, public errors?: Record<string, string[]>) {
    super('Validation Error', 400, detail, 'https://syncro.app/errors/validation', { errors });
  }
}

/**
 * Thrown when authentication is required or fails (HTTP 401).
 */
export class UnauthorizedError extends AppError {
  constructor(detail: string = 'Authentication required.') {
    super('Unauthorized', 401, detail, 'https://syncro.app/errors/unauthorized');
  }
}

/**
 * Thrown when the user is authenticated but lacks permission (HTTP 403).
 */
export class ForbiddenError extends AppError {
  constructor(detail: string = 'Access denied.') {
    super('Forbidden', 403, detail, 'https://syncro.app/errors/forbidden');
  }
}

/**
 * Thrown when a request conflicts with the current state of the server (HTTP 409).
 */
export class ConflictError extends AppError {
  constructor(detail: string) {
    super('Conflict', 409, detail, 'https://syncro.app/errors/conflict');
  }
}

/**
 * Thrown for general client errors (HTTP 400).
 */
export class BadRequestError extends AppError {
  constructor(detail: string, public extensions?: Record<string, any>) {
    super('Bad Request', 400, detail, 'https://syncro.app/errors/bad-request', extensions);
  }
}

/**
 * Thrown when too many requests are sent (HTTP 429).
 */
export class RateLimitError extends AppError {
  constructor(detail: string, public retryAfter: number) {
    super('Too Many Requests', 429, detail, 'https://syncro.app/errors/too-many-requests', { retryAfter });
  }
}

/**
 * Thrown when an external dependency (Redis, email provider, payment gateway, etc.)
 * is unavailable or returns an unexpected error (HTTP 502).
 */
export class ExternalDependencyError extends AppError {
  constructor(detail: string, public dependency: string) {
    super(
      'External Dependency Error',
      502,
      detail,
      'https://syncro.app/errors/external-dependency',
      { dependency }
    );
  }
}
