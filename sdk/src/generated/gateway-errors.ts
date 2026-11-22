/**
 * AUTO-GENERATED FILE — DO NOT EDIT
 * Source: backend/src/errors/gateway-taxonomy.json
 * Taxonomy version: 2026-09-24
 * Taxonomy hash: 704b08451357cc6598c11c169ec4b053c1d5556ec977ca72dce8578fd27e1fe3
 */

export type GatewayErrorCode = 'GATEWAY_PAYMENT_REQUIRED' | 'GATEWAY_KEY_MISSING' | 'GATEWAY_KEY_INVALID' | 'GATEWAY_KEY_REVOKED' | 'GATEWAY_SCOPE_DENIED' | 'GATEWAY_GRANT_EXPIRED' | 'GATEWAY_CAP_EXCEEDED' | 'GATEWAY_CHANNEL_EXHAUSTED' | 'GATEWAY_METER_INSUFFICIENT' | 'GATEWAY_RATE_LIMITED' | 'GATEWAY_UPSTREAM_UNAVAILABLE' | 'GATEWAY_METER_DEGRADED' | 'GATEWAY_BAD_REQUEST' | 'GATEWAY_UNAUTHORIZED' | 'GATEWAY_INTERNAL';

export interface GatewayErrorDetails {
  message?: string | undefined;
  status?: number | undefined;
  retryAfterMs?: number | undefined;
  retryAfterSeconds?: number | undefined;
  capResetAt?: string | undefined;
  cause?: unknown;
}

export class GatewaySdkError extends Error {
  readonly code: GatewayErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number | undefined;
  readonly capResetAt?: string | undefined;
  readonly action: string;

  constructor(input: {
    code: GatewayErrorCode;
    message: string;
    status: number;
    retryable: boolean;
    retryAfterMs?: number | undefined;
    capResetAt?: string | undefined;
    action: string;
    cause?: unknown;
  }) {
    super(input.message);
    this.name = "GatewaySdkError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable;
    this.retryAfterMs = input.retryAfterMs;
    this.capResetAt = input.capResetAt;
    this.action = input.action;
    if (input.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = input.cause;
    }
  }
}

export class GatewayPaymentRequiredError extends GatewaySdkError {
  static readonly gatewayCode = 'GATEWAY_PAYMENT_REQUIRED' as const;
  static readonly defaultHttpStatus = 402 as const;
  static readonly retryableByDefault = false as const;
  static readonly action = 'provide_payment' as const;
  static readonly retryAfterSeconds = undefined as const;
  static readonly supportsRetryAfterHeader = false as const;

  constructor(details: GatewayErrorDetails = {}) {
    super({
      ...details,
      code: GatewayPaymentRequiredError.gatewayCode,
      message: details.message ?? "Valid payment authorization is required.",
      status: details.status ?? GatewayPaymentRequiredError.defaultHttpStatus,
      retryable: GatewayPaymentRequiredError.retryableByDefault,
      retryAfterMs:
        details.retryAfterMs ?? (details.retryAfterSeconds !== undefined ? details.retryAfterSeconds * 1000 : GatewayPaymentRequiredError.retryAfterSeconds !== undefined ? GatewayPaymentRequiredError.retryAfterSeconds * 1000 : undefined),
      action: GatewayPaymentRequiredError.action,
    });
  }
}

export class GatewayKeyMissingError extends GatewaySdkError {
  static readonly gatewayCode = 'GATEWAY_KEY_MISSING' as const;
  static readonly defaultHttpStatus = 401 as const;
  static readonly retryableByDefault = false as const;
  static readonly action = 'provide_credentials' as const;
  static readonly retryAfterSeconds = undefined as const;
  static readonly supportsRetryAfterHeader = false as const;

  constructor(details: GatewayErrorDetails = {}) {
    super({
      ...details,
      code: GatewayKeyMissingError.gatewayCode,
      message: details.message ?? "Gateway credentials are required.",
      status: details.status ?? GatewayKeyMissingError.defaultHttpStatus,
      retryable: GatewayKeyMissingError.retryableByDefault,
      retryAfterMs:
        details.retryAfterMs ?? (details.retryAfterSeconds !== undefined ? details.retryAfterSeconds * 1000 : GatewayKeyMissingError.retryAfterSeconds !== undefined ? GatewayKeyMissingError.retryAfterSeconds * 1000 : undefined),
      action: GatewayKeyMissingError.action,
    });
  }
}

export class GatewayKeyInvalidError extends GatewaySdkError {
  static readonly gatewayCode = 'GATEWAY_KEY_INVALID' as const;
  static readonly defaultHttpStatus = 401 as const;
  static readonly retryableByDefault = false as const;
  static readonly action = 'refresh_credentials' as const;
  static readonly retryAfterSeconds = undefined as const;
  static readonly supportsRetryAfterHeader = false as const;

  constructor(details: GatewayErrorDetails = {}) {
    super({
      ...details,
      code: GatewayKeyInvalidError.gatewayCode,
      message: details.message ?? "Gateway credentials are invalid.",
      status: details.status ?? GatewayKeyInvalidError.defaultHttpStatus,
      retryable: GatewayKeyInvalidError.retryableByDefault,
      retryAfterMs:
        details.retryAfterMs ?? (details.retryAfterSeconds !== undefined ? details.retryAfterSeconds * 1000 : GatewayKeyInvalidError.retryAfterSeconds !== undefined ? GatewayKeyInvalidError.retryAfterSeconds * 1000 : undefined),
      action: GatewayKeyInvalidError.action,
    });
  }
}

export class GatewayKeyRevokedError extends GatewaySdkError {
  static readonly gatewayCode = 'GATEWAY_KEY_REVOKED' as const;
  static readonly defaultHttpStatus = 403 as const;
  static readonly retryableByDefault = false as const;
  static readonly action = 'refresh_credentials' as const;
  static readonly retryAfterSeconds = undefined as const;
  static readonly supportsRetryAfterHeader = false as const;

  constructor(details: GatewayErrorDetails = {}) {
    super({
      ...details,
      code: GatewayKeyRevokedError.gatewayCode,
      message: details.message ?? "Provider key has been revoked.",
      status: details.status ?? GatewayKeyRevokedError.defaultHttpStatus,
      retryable: GatewayKeyRevokedError.retryableByDefault,
      retryAfterMs:
        details.retryAfterMs ?? (details.retryAfterSeconds !== undefined ? details.retryAfterSeconds * 1000 : GatewayKeyRevokedError.retryAfterSeconds !== undefined ? GatewayKeyRevokedError.retryAfterSeconds * 1000 : undefined),
      action: GatewayKeyRevokedError.action,
    });
  }
}

export class GatewayScopeDeniedError extends GatewaySdkError {
  static readonly gatewayCode = 'GATEWAY_SCOPE_DENIED' as const;
  static readonly defaultHttpStatus = 403 as const;
  static readonly retryableByDefault = false as const;
  static readonly action = 'request_access' as const;
  static readonly retryAfterSeconds = undefined as const;
  static readonly supportsRetryAfterHeader = false as const;

  constructor(details: GatewayErrorDetails = {}) {
    super({
      ...details,
      code: GatewayScopeDeniedError.gatewayCode,
      message: details.message ?? "The credential is not authorized for this scope.",
      status: details.status ?? GatewayScopeDeniedError.defaultHttpStatus,
      retryable: GatewayScopeDeniedError.retryableByDefault,
      retryAfterMs:
        details.retryAfterMs ?? (details.retryAfterSeconds !== undefined ? details.retryAfterSeconds * 1000 : GatewayScopeDeniedError.retryAfterSeconds !== undefined ? GatewayScopeDeniedError.retryAfterSeconds * 1000 : undefined),
      action: GatewayScopeDeniedError.action,
    });
  }
}

export class GatewayGrantExpiredError extends GatewaySdkError {
  static readonly gatewayCode = 'GATEWAY_GRANT_EXPIRED' as const;
  static readonly defaultHttpStatus = 403 as const;
  static readonly retryableByDefault = false as const;
  static readonly action = 'refresh_grant' as const;
  static readonly retryAfterSeconds = undefined as const;
  static readonly supportsRetryAfterHeader = false as const;

  constructor(details: GatewayErrorDetails = {}) {
    super({
      ...details,
      code: GatewayGrantExpiredError.gatewayCode,
      message: details.message ?? "The payment grant has expired.",
      status: details.status ?? GatewayGrantExpiredError.defaultHttpStatus,
      retryable: GatewayGrantExpiredError.retryableByDefault,
      retryAfterMs:
        details.retryAfterMs ?? (details.retryAfterSeconds !== undefined ? details.retryAfterSeconds * 1000 : GatewayGrantExpiredError.retryAfterSeconds !== undefined ? GatewayGrantExpiredError.retryAfterSeconds * 1000 : undefined),
      action: GatewayGrantExpiredError.action,
    });
  }
}

export class GatewayCapExceededError extends GatewaySdkError {
  static readonly gatewayCode = 'GATEWAY_CAP_EXCEEDED' as const;
  static readonly defaultHttpStatus = 403 as const;
  static readonly retryableByDefault = false as const;
  static readonly action = 'request_cap_increase' as const;
  static readonly retryAfterSeconds = undefined as const;
  static readonly supportsRetryAfterHeader = true as const;

  constructor(details: GatewayErrorDetails = {}) {
    super({
      ...details,
      code: GatewayCapExceededError.gatewayCode,
      message: details.message ?? "The credential spending cap has been exceeded.",
      status: details.status ?? GatewayCapExceededError.defaultHttpStatus,
      retryable: GatewayCapExceededError.retryableByDefault,
      retryAfterMs:
        details.retryAfterMs ?? (details.retryAfterSeconds !== undefined ? details.retryAfterSeconds * 1000 : GatewayCapExceededError.retryAfterSeconds !== undefined ? GatewayCapExceededError.retryAfterSeconds * 1000 : undefined),
      action: GatewayCapExceededError.action,
    });
  }
}

export class GatewayChannelExhaustedError extends GatewaySdkError {
  static readonly gatewayCode = 'GATEWAY_CHANNEL_EXHAUSTED' as const;
  static readonly defaultHttpStatus = 402 as const;
  static readonly retryableByDefault = false as const;
  static readonly action = 'fund_channel' as const;
  static readonly retryAfterSeconds = undefined as const;
  static readonly supportsRetryAfterHeader = false as const;

  constructor(details: GatewayErrorDetails = {}) {
    super({
      ...details,
      code: GatewayChannelExhaustedError.gatewayCode,
      message: details.message ?? "Payment channel balance is exhausted.",
      status: details.status ?? GatewayChannelExhaustedError.defaultHttpStatus,
      retryable: GatewayChannelExhaustedError.retryableByDefault,
      retryAfterMs:
        details.retryAfterMs ?? (details.retryAfterSeconds !== undefined ? details.retryAfterSeconds * 1000 : GatewayChannelExhaustedError.retryAfterSeconds !== undefined ? GatewayChannelExhaustedError.retryAfterSeconds * 1000 : undefined),
      action: GatewayChannelExhaustedError.action,
    });
  }
}

export class GatewayMeterInsufficientError extends GatewaySdkError {
  static readonly gatewayCode = 'GATEWAY_METER_INSUFFICIENT' as const;
  static readonly defaultHttpStatus = 402 as const;
  static readonly retryableByDefault = false as const;
  static readonly action = 'fund_meter' as const;
  static readonly retryAfterSeconds = undefined as const;
  static readonly supportsRetryAfterHeader = false as const;

  constructor(details: GatewayErrorDetails = {}) {
    super({
      ...details,
      code: GatewayMeterInsufficientError.gatewayCode,
      message: details.message ?? "Meter balance is insufficient for this request.",
      status: details.status ?? GatewayMeterInsufficientError.defaultHttpStatus,
      retryable: GatewayMeterInsufficientError.retryableByDefault,
      retryAfterMs:
        details.retryAfterMs ?? (details.retryAfterSeconds !== undefined ? details.retryAfterSeconds * 1000 : GatewayMeterInsufficientError.retryAfterSeconds !== undefined ? GatewayMeterInsufficientError.retryAfterSeconds * 1000 : undefined),
      action: GatewayMeterInsufficientError.action,
    });
  }
}

export class GatewayRateLimitedError extends GatewaySdkError {
  static readonly gatewayCode = 'GATEWAY_RATE_LIMITED' as const;
  static readonly defaultHttpStatus = 429 as const;
  static readonly retryableByDefault = true as const;
  static readonly action = 'wait' as const;
  static readonly retryAfterSeconds = 1 as const;
  static readonly supportsRetryAfterHeader = true as const;

  constructor(details: GatewayErrorDetails = {}) {
    super({
      ...details,
      code: GatewayRateLimitedError.gatewayCode,
      message: details.message ?? "Gateway rate limit exceeded.",
      status: details.status ?? GatewayRateLimitedError.defaultHttpStatus,
      retryable: GatewayRateLimitedError.retryableByDefault,
      retryAfterMs:
        details.retryAfterMs ?? (details.retryAfterSeconds !== undefined ? details.retryAfterSeconds * 1000 : GatewayRateLimitedError.retryAfterSeconds !== undefined ? GatewayRateLimitedError.retryAfterSeconds * 1000 : undefined),
      action: GatewayRateLimitedError.action,
    });
  }
}

export class GatewayUpstreamUnavailableError extends GatewaySdkError {
  static readonly gatewayCode = 'GATEWAY_UPSTREAM_UNAVAILABLE' as const;
  static readonly defaultHttpStatus = 503 as const;
  static readonly retryableByDefault = true as const;
  static readonly action = 'retry' as const;
  static readonly retryAfterSeconds = 5 as const;
  static readonly supportsRetryAfterHeader = true as const;

  constructor(details: GatewayErrorDetails = {}) {
    super({
      ...details,
      code: GatewayUpstreamUnavailableError.gatewayCode,
      message: details.message ?? "Gateway upstream is unavailable.",
      status: details.status ?? GatewayUpstreamUnavailableError.defaultHttpStatus,
      retryable: GatewayUpstreamUnavailableError.retryableByDefault,
      retryAfterMs:
        details.retryAfterMs ?? (details.retryAfterSeconds !== undefined ? details.retryAfterSeconds * 1000 : GatewayUpstreamUnavailableError.retryAfterSeconds !== undefined ? GatewayUpstreamUnavailableError.retryAfterSeconds * 1000 : undefined),
      action: GatewayUpstreamUnavailableError.action,
    });
  }
}

export class GatewayMeterDegradedError extends GatewaySdkError {
  static readonly gatewayCode = 'GATEWAY_METER_DEGRADED' as const;
  static readonly defaultHttpStatus = 503 as const;
  static readonly retryableByDefault = true as const;
  static readonly action = 'retry' as const;
  static readonly retryAfterSeconds = 10 as const;
  static readonly supportsRetryAfterHeader = true as const;

  constructor(details: GatewayErrorDetails = {}) {
    super({
      ...details,
      code: GatewayMeterDegradedError.gatewayCode,
      message: details.message ?? "Gateway metering is temporarily degraded.",
      status: details.status ?? GatewayMeterDegradedError.defaultHttpStatus,
      retryable: GatewayMeterDegradedError.retryableByDefault,
      retryAfterMs:
        details.retryAfterMs ?? (details.retryAfterSeconds !== undefined ? details.retryAfterSeconds * 1000 : GatewayMeterDegradedError.retryAfterSeconds !== undefined ? GatewayMeterDegradedError.retryAfterSeconds * 1000 : undefined),
      action: GatewayMeterDegradedError.action,
    });
  }
}

export class GatewayBadRequestError extends GatewaySdkError {
  static readonly gatewayCode = 'GATEWAY_BAD_REQUEST' as const;
  static readonly defaultHttpStatus = 400 as const;
  static readonly retryableByDefault = false as const;
  static readonly action = 'fix_request' as const;
  static readonly retryAfterSeconds = undefined as const;
  static readonly supportsRetryAfterHeader = false as const;

  constructor(details: GatewayErrorDetails = {}) {
    super({
      ...details,
      code: GatewayBadRequestError.gatewayCode,
      message: details.message ?? "Gateway request is invalid.",
      status: details.status ?? GatewayBadRequestError.defaultHttpStatus,
      retryable: GatewayBadRequestError.retryableByDefault,
      retryAfterMs:
        details.retryAfterMs ?? (details.retryAfterSeconds !== undefined ? details.retryAfterSeconds * 1000 : GatewayBadRequestError.retryAfterSeconds !== undefined ? GatewayBadRequestError.retryAfterSeconds * 1000 : undefined),
      action: GatewayBadRequestError.action,
    });
  }
}

export class GatewayUnauthorizedError extends GatewaySdkError {
  static readonly gatewayCode = 'GATEWAY_UNAUTHORIZED' as const;
  static readonly defaultHttpStatus = 401 as const;
  static readonly retryableByDefault = false as const;
  static readonly action = 'provide_credentials' as const;
  static readonly retryAfterSeconds = undefined as const;
  static readonly supportsRetryAfterHeader = false as const;

  constructor(details: GatewayErrorDetails = {}) {
    super({
      ...details,
      code: GatewayUnauthorizedError.gatewayCode,
      message: details.message ?? "Gateway credentials are invalid.",
      status: details.status ?? GatewayUnauthorizedError.defaultHttpStatus,
      retryable: GatewayUnauthorizedError.retryableByDefault,
      retryAfterMs:
        details.retryAfterMs ?? (details.retryAfterSeconds !== undefined ? details.retryAfterSeconds * 1000 : GatewayUnauthorizedError.retryAfterSeconds !== undefined ? GatewayUnauthorizedError.retryAfterSeconds * 1000 : undefined),
      action: GatewayUnauthorizedError.action,
    });
  }
}

export class GatewayInternalError extends GatewaySdkError {
  static readonly gatewayCode = 'GATEWAY_INTERNAL' as const;
  static readonly defaultHttpStatus = 500 as const;
  static readonly retryableByDefault = true as const;
  static readonly action = 'retry' as const;
  static readonly retryAfterSeconds = 5 as const;
  static readonly supportsRetryAfterHeader = true as const;

  constructor(details: GatewayErrorDetails = {}) {
    super({
      ...details,
      code: GatewayInternalError.gatewayCode,
      message: details.message ?? "Gateway internal error.",
      status: details.status ?? GatewayInternalError.defaultHttpStatus,
      retryable: GatewayInternalError.retryableByDefault,
      retryAfterMs:
        details.retryAfterMs ?? (details.retryAfterSeconds !== undefined ? details.retryAfterSeconds * 1000 : GatewayInternalError.retryAfterSeconds !== undefined ? GatewayInternalError.retryAfterSeconds * 1000 : undefined),
      action: GatewayInternalError.action,
    });
  }
}

const ERROR_BY_CODE = {
  GATEWAY_PAYMENT_REQUIRED: GatewayPaymentRequiredError,
  GATEWAY_KEY_MISSING: GatewayKeyMissingError,
  GATEWAY_KEY_INVALID: GatewayKeyInvalidError,
  GATEWAY_KEY_REVOKED: GatewayKeyRevokedError,
  GATEWAY_SCOPE_DENIED: GatewayScopeDeniedError,
  GATEWAY_GRANT_EXPIRED: GatewayGrantExpiredError,
  GATEWAY_CAP_EXCEEDED: GatewayCapExceededError,
  GATEWAY_CHANNEL_EXHAUSTED: GatewayChannelExhaustedError,
  GATEWAY_METER_INSUFFICIENT: GatewayMeterInsufficientError,
  GATEWAY_RATE_LIMITED: GatewayRateLimitedError,
  GATEWAY_UPSTREAM_UNAVAILABLE: GatewayUpstreamUnavailableError,
  GATEWAY_METER_DEGRADED: GatewayMeterDegradedError,
  GATEWAY_BAD_REQUEST: GatewayBadRequestError,
  GATEWAY_UNAUTHORIZED: GatewayUnauthorizedError,
  GATEWAY_INTERNAL: GatewayInternalError,
} as const;

const ERROR_BY_HTTP_STATUS = {
  402: GatewayPaymentRequiredError,
  401: GatewayKeyMissingError,
  403: GatewayKeyRevokedError,
  429: GatewayRateLimitedError,
  503: GatewayUpstreamUnavailableError,
  400: GatewayBadRequestError,
  500: GatewayInternalError,
} as const;

const RETRY_DEFAULTS = {
  GATEWAY_PAYMENT_REQUIRED: { retryable: false, supportsRetryAfter: false },
  GATEWAY_KEY_MISSING: { retryable: false, supportsRetryAfter: false },
  GATEWAY_KEY_INVALID: { retryable: false, supportsRetryAfter: false },
  GATEWAY_KEY_REVOKED: { retryable: false, supportsRetryAfter: false },
  GATEWAY_SCOPE_DENIED: { retryable: false, supportsRetryAfter: false },
  GATEWAY_GRANT_EXPIRED: { retryable: false, supportsRetryAfter: false },
  GATEWAY_CAP_EXCEEDED: { retryable: false, supportsRetryAfter: true },
  GATEWAY_CHANNEL_EXHAUSTED: { retryable: false, supportsRetryAfter: false },
  GATEWAY_METER_INSUFFICIENT: { retryable: false, supportsRetryAfter: false },
  GATEWAY_RATE_LIMITED: { retryable: true, supportsRetryAfter: true },
  GATEWAY_UPSTREAM_UNAVAILABLE: { retryable: true, supportsRetryAfter: true },
  GATEWAY_METER_DEGRADED: { retryable: true, supportsRetryAfter: true },
  GATEWAY_BAD_REQUEST: { retryable: false, supportsRetryAfter: false },
  GATEWAY_UNAUTHORIZED: { retryable: false, supportsRetryAfter: false },
  GATEWAY_INTERNAL: { retryable: true, supportsRetryAfter: true },
} as const;

export type GeneratedGatewayError =
  | GatewayPaymentRequiredError
  | GatewayKeyMissingError
  | GatewayKeyInvalidError
  | GatewayKeyRevokedError
  | GatewayScopeDeniedError
  | GatewayGrantExpiredError
  | GatewayCapExceededError
  | GatewayChannelExhaustedError
  | GatewayMeterInsufficientError
  | GatewayRateLimitedError
  | GatewayUpstreamUnavailableError
  | GatewayMeterDegradedError
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

export function isGatewayErrorCode(code: string): code is GatewayErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_BY_CODE, code);
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
