/**
 * AUTO-GENERATED FILE — DO NOT EDIT
 * Source: backend/src/errors/gateway-taxonomy.json
 * Taxonomy version: 2026-09-24
 * Taxonomy hash: becd6784ff9354477a69c01cb25664395ccc002da72a7def7a861a6e56291891
 */

export type GatewayErrorCode = 'GATEWAY_RATE_LIMITED' | 'GATEWAY_CHANNEL_EXHAUSTED' | 'GATEWAY_KEY_REVOKED' | 'GATEWAY_BAD_REQUEST' | 'GATEWAY_UNAUTHORIZED' | 'GATEWAY_INTERNAL';

export interface GatewayErrorDetails {
  message?: string;
  status?: number;
  retryAfterMs?: number;
  retryAfterSeconds?: number;
  cause?: unknown;
}

export class GatewaySdkError extends Error {
  readonly code: GatewayErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(input: {
    code: GatewayErrorCode;
    message: string;
    status: number;
    retryable: boolean;
    retryAfterMs?: number;
    cause?: unknown;
  }) {
    super(input.message);
    this.name = "GatewaySdkError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable;
    this.retryAfterMs = input.retryAfterMs;
    if (input.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = input.cause;
    }
  }
}

export class GatewayRateLimitedError extends GatewaySdkError {
  static readonly gatewayCode = 'GATEWAY_RATE_LIMITED' as const;
  static readonly defaultHttpStatus = 429 as const;
  static readonly retryableByDefault = true as const;
  static readonly supportsRetryAfterHeader = true as const;

  constructor(details: GatewayErrorDetails = {}) {
    super({
      ...details,
      code: GatewayRateLimitedError.gatewayCode,
      message: details.message ?? "Gateway rate limit exceeded.",
      status: details.status ?? GatewayRateLimitedError.defaultHttpStatus,
      retryable: GatewayRateLimitedError.retryableByDefault,
      retryAfterMs:
        details.retryAfterMs ?? (details.retryAfterSeconds !== undefined ? details.retryAfterSeconds * 1000 : undefined),
    });
  }
}

export class GatewayChannelExhaustedError extends GatewaySdkError {
  static readonly gatewayCode = 'GATEWAY_CHANNEL_EXHAUSTED' as const;
  static readonly defaultHttpStatus = 402 as const;
  static readonly retryableByDefault = false as const;
  static readonly supportsRetryAfterHeader = false as const;

  constructor(details: GatewayErrorDetails = {}) {
    super({
      ...details,
      code: GatewayChannelExhaustedError.gatewayCode,
      message: details.message ?? "Payment channel balance is exhausted.",
      status: details.status ?? GatewayChannelExhaustedError.defaultHttpStatus,
      retryable: GatewayChannelExhaustedError.retryableByDefault,
      retryAfterMs:
        details.retryAfterMs ?? (details.retryAfterSeconds !== undefined ? details.retryAfterSeconds * 1000 : undefined),
    });
  }
}

export class GatewayKeyRevokedError extends GatewaySdkError {
  static readonly gatewayCode = 'GATEWAY_KEY_REVOKED' as const;
  static readonly defaultHttpStatus = 403 as const;
  static readonly retryableByDefault = false as const;
  static readonly supportsRetryAfterHeader = false as const;

  constructor(details: GatewayErrorDetails = {}) {
    super({
      ...details,
      code: GatewayKeyRevokedError.gatewayCode,
      message: details.message ?? "Provider key has been revoked.",
      status: details.status ?? GatewayKeyRevokedError.defaultHttpStatus,
      retryable: GatewayKeyRevokedError.retryableByDefault,
      retryAfterMs:
        details.retryAfterMs ?? (details.retryAfterSeconds !== undefined ? details.retryAfterSeconds * 1000 : undefined),
    });
  }
}

export class GatewayBadRequestError extends GatewaySdkError {
  static readonly gatewayCode = 'GATEWAY_BAD_REQUEST' as const;
  static readonly defaultHttpStatus = 400 as const;
  static readonly retryableByDefault = false as const;
  static readonly supportsRetryAfterHeader = false as const;

  constructor(details: GatewayErrorDetails = {}) {
    super({
      ...details,
      code: GatewayBadRequestError.gatewayCode,
      message: details.message ?? "Gateway request is invalid.",
      status: details.status ?? GatewayBadRequestError.defaultHttpStatus,
      retryable: GatewayBadRequestError.retryableByDefault,
      retryAfterMs:
        details.retryAfterMs ?? (details.retryAfterSeconds !== undefined ? details.retryAfterSeconds * 1000 : undefined),
    });
  }
}

export class GatewayUnauthorizedError extends GatewaySdkError {
  static readonly gatewayCode = 'GATEWAY_UNAUTHORIZED' as const;
  static readonly defaultHttpStatus = 401 as const;
  static readonly retryableByDefault = false as const;
  static readonly supportsRetryAfterHeader = false as const;

  constructor(details: GatewayErrorDetails = {}) {
    super({
      ...details,
      code: GatewayUnauthorizedError.gatewayCode,
      message: details.message ?? "Gateway credentials are invalid.",
      status: details.status ?? GatewayUnauthorizedError.defaultHttpStatus,
      retryable: GatewayUnauthorizedError.retryableByDefault,
      retryAfterMs:
        details.retryAfterMs ?? (details.retryAfterSeconds !== undefined ? details.retryAfterSeconds * 1000 : undefined),
    });
  }
}

export class GatewayInternalError extends GatewaySdkError {
  static readonly gatewayCode = 'GATEWAY_INTERNAL' as const;
  static readonly defaultHttpStatus = 500 as const;
  static readonly retryableByDefault = true as const;
  static readonly supportsRetryAfterHeader = true as const;

  constructor(details: GatewayErrorDetails = {}) {
    super({
      ...details,
      code: GatewayInternalError.gatewayCode,
      message: details.message ?? "Gateway internal error.",
      status: details.status ?? GatewayInternalError.defaultHttpStatus,
      retryable: GatewayInternalError.retryableByDefault,
      retryAfterMs:
        details.retryAfterMs ?? (details.retryAfterSeconds !== undefined ? details.retryAfterSeconds * 1000 : undefined),
    });
  }
}

const ERROR_BY_CODE = {
  GATEWAY_RATE_LIMITED: GatewayRateLimitedError,
  GATEWAY_CHANNEL_EXHAUSTED: GatewayChannelExhaustedError,
  GATEWAY_KEY_REVOKED: GatewayKeyRevokedError,
  GATEWAY_BAD_REQUEST: GatewayBadRequestError,
  GATEWAY_UNAUTHORIZED: GatewayUnauthorizedError,
  GATEWAY_INTERNAL: GatewayInternalError,
} as const;

const ERROR_BY_HTTP_STATUS = {
  429: GatewayRateLimitedError,
  402: GatewayChannelExhaustedError,
  403: GatewayKeyRevokedError,
  400: GatewayBadRequestError,
  401: GatewayUnauthorizedError,
  500: GatewayInternalError,
} as const;

const RETRY_DEFAULTS = {
  GATEWAY_RATE_LIMITED: { retryable: true, supportsRetryAfter: true },
  GATEWAY_CHANNEL_EXHAUSTED: { retryable: false, supportsRetryAfter: false },
  GATEWAY_KEY_REVOKED: { retryable: false, supportsRetryAfter: false },
  GATEWAY_BAD_REQUEST: { retryable: false, supportsRetryAfter: false },
  GATEWAY_UNAUTHORIZED: { retryable: false, supportsRetryAfter: false },
  GATEWAY_INTERNAL: { retryable: true, supportsRetryAfter: true },
} as const;

export type GeneratedGatewayError =
  | GatewayRateLimitedError
  | GatewayChannelExhaustedError
  | GatewayKeyRevokedError
  | GatewayBadRequestError
  | GatewayUnauthorizedError
  | GatewayInternalError;

export function createGatewayErrorFromCode(
  code: GatewayErrorCode,
  details: GatewayErrorDetails = {},
): GeneratedGatewayError {
  const Cls = ERROR_BY_CODE[code];
  return new Cls(details);
}

export function createGatewayErrorFromHttpStatus(
  status: number,
  details: GatewayErrorDetails = {},
): GeneratedGatewayError | null {
  const Cls = ERROR_BY_HTTP_STATUS[status as keyof typeof ERROR_BY_HTTP_STATUS];
  return Cls ? new Cls({ ...details, status }) : null;
}

export function getGatewayRetrySemantics(code: GatewayErrorCode): {
  retryable: boolean;
  supportsRetryAfter: boolean;
} {
  return RETRY_DEFAULTS[code];
}
