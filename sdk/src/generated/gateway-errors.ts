/**
 * AUTO-GENERATED FILE - DO NOT EDIT
 * Source: backend/src/errors/gateway-taxonomy.json
 * Taxonomy version: 2026-09-24
 * Taxonomy hash: 9a24e62a375677c0ded81354f6afc0477c0fa1581f2c2d21a6586dfee4688c4d
 */

export type GatewayErrorCode =
  | 'GATEWAY_PAYMENT_REQUIRED'
  | 'GATEWAY_KEY_MISSING'
  | 'GATEWAY_KEY_INVALID'
  | 'GATEWAY_KEY_REVOKED'
  | 'GATEWAY_SCOPE_DENIED'
  | 'GATEWAY_GRANT_EXPIRED'
  | 'GATEWAY_CAP_EXCEEDED'
  | 'GATEWAY_CHANNEL_EXHAUSTED'
  | 'GATEWAY_METER_INSUFFICIENT'
  | 'GATEWAY_RATE_LIMITED'
  | 'GATEWAY_UPSTREAM_UNAVAILABLE'
  | 'GATEWAY_METER_DEGRADED'
  | 'GATEWAY_BAD_REQUEST'
  | 'GATEWAY_UNAUTHORIZED'
  | 'GATEWAY_INTERNAL';

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
  readonly action: string;

  constructor(input: {
    code: GatewayErrorCode;
    message: string;
    status: number;
    retryable: boolean;
    retryAfterMs?: number;
    action: string;
    cause?: unknown;
  }) {
    super(input.message);
    this.name = 'GatewaySdkError';
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable;
    this.retryAfterMs = input.retryAfterMs;
    this.action = input.action;
    if (input.cause !== undefined) (this as Error & { cause?: unknown }).cause = input.cause;
  }
}

function createErrorClass<const Code extends GatewayErrorCode>(code: Code, status: number, action: string, retryable: boolean, defaultMessage: string, retryAfterSeconds?: number) {
  return class extends GatewaySdkError {
    static readonly gatewayCode = code;
    static readonly defaultHttpStatus = status;
    static readonly retryableByDefault = retryable;
    static readonly action = action;
    static readonly retryAfterSeconds = retryAfterSeconds;
    static readonly supportsRetryAfterHeader = retryAfterSeconds !== undefined;

    constructor(details: GatewayErrorDetails = {}) {
      super({
        ...details,
        code,
        message: details.message ?? defaultMessage,
        status: details.status ?? status,
        retryable,
        action,
        retryAfterMs: details.retryAfterMs ?? ((details.retryAfterSeconds ?? retryAfterSeconds) === undefined ? undefined : (details.retryAfterSeconds ?? retryAfterSeconds)! * 1000),
      });
    }
  };
}

export const GatewayPaymentRequiredError = createErrorClass('GATEWAY_PAYMENT_REQUIRED', 402, 'provide_payment', false, 'Valid payment authorization is required.');
export const GatewayKeyMissingError = createErrorClass('GATEWAY_KEY_MISSING', 401, 'provide_credentials', false, 'Gateway credentials are required.');
export const GatewayKeyInvalidError = createErrorClass('GATEWAY_KEY_INVALID', 401, 'refresh_credentials', false, 'Gateway credentials are invalid.');
export const GatewayKeyRevokedError = createErrorClass('GATEWAY_KEY_REVOKED', 403, 'refresh_credentials', false, 'Provider key has been revoked.');
export const GatewayScopeDeniedError = createErrorClass('GATEWAY_SCOPE_DENIED', 403, 'request_access', false, 'The credential is not authorized for this scope.');
export const GatewayGrantExpiredError = createErrorClass('GATEWAY_GRANT_EXPIRED', 403, 'refresh_grant', false, 'The payment grant has expired.');
export const GatewayCapExceededError = createErrorClass('GATEWAY_CAP_EXCEEDED', 403, 'request_cap_increase', false, 'The credential spending cap has been exceeded.');
export const GatewayChannelExhaustedError = createErrorClass('GATEWAY_CHANNEL_EXHAUSTED', 402, 'fund_channel', false, 'Payment channel balance is exhausted.');
export const GatewayMeterInsufficientError = createErrorClass('GATEWAY_METER_INSUFFICIENT', 402, 'fund_meter', false, 'Meter balance is insufficient for this request.');
export const GatewayRateLimitedError = createErrorClass('GATEWAY_RATE_LIMITED', 429, 'wait', true, 'Gateway rate limit exceeded.', 1);
export const GatewayUpstreamUnavailableError = createErrorClass('GATEWAY_UPSTREAM_UNAVAILABLE', 503, 'retry', true, 'Gateway upstream is unavailable.', 5);
export const GatewayMeterDegradedError = createErrorClass('GATEWAY_METER_DEGRADED', 503, 'retry', true, 'Gateway metering is temporarily degraded.', 10);
export const GatewayBadRequestError = createErrorClass('GATEWAY_BAD_REQUEST', 400, 'fix_request', false, 'Gateway request is invalid.');
export const GatewayUnauthorizedError = createErrorClass('GATEWAY_UNAUTHORIZED', 401, 'provide_credentials', false, 'Gateway credentials are invalid.');
export const GatewayInternalError = createErrorClass('GATEWAY_INTERNAL', 500, 'retry', true, 'Gateway internal error.', 5);

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
  400: GatewayBadRequestError,
  401: GatewayUnauthorizedError,
  402: GatewayPaymentRequiredError,
  403: GatewayScopeDeniedError,
  429: GatewayRateLimitedError,
  500: GatewayInternalError,
  503: GatewayUpstreamUnavailableError,
} as const;

const RETRY_DEFAULTS = {
  GATEWAY_PAYMENT_REQUIRED: { retryable: false, supportsRetryAfter: false },
  GATEWAY_KEY_MISSING: { retryable: false, supportsRetryAfter: false },
  GATEWAY_KEY_INVALID: { retryable: false, supportsRetryAfter: false },
  GATEWAY_KEY_REVOKED: { retryable: false, supportsRetryAfter: false },
  GATEWAY_SCOPE_DENIED: { retryable: false, supportsRetryAfter: false },
  GATEWAY_GRANT_EXPIRED: { retryable: false, supportsRetryAfter: false },
  GATEWAY_CAP_EXCEEDED: { retryable: false, supportsRetryAfter: false },
  GATEWAY_CHANNEL_EXHAUSTED: { retryable: false, supportsRetryAfter: false },
  GATEWAY_METER_INSUFFICIENT: { retryable: false, supportsRetryAfter: false },
  GATEWAY_RATE_LIMITED: { retryable: true, supportsRetryAfter: true },
  GATEWAY_UPSTREAM_UNAVAILABLE: { retryable: true, supportsRetryAfter: true },
  GATEWAY_METER_DEGRADED: { retryable: true, supportsRetryAfter: true },
  GATEWAY_BAD_REQUEST: { retryable: false, supportsRetryAfter: false },
  GATEWAY_UNAUTHORIZED: { retryable: false, supportsRetryAfter: false },
  GATEWAY_INTERNAL: { retryable: true, supportsRetryAfter: true },
} as const;

export type GeneratedGatewayError = GatewaySdkError;

export function createGatewayErrorFromCode(code: GatewayErrorCode, details: GatewayErrorDetails = {}): GeneratedGatewayError {
  return new ERROR_BY_CODE[code](details);
}

export function isGatewayErrorCode(code: string): code is GatewayErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_BY_CODE, code);
}

export function createGatewayErrorFromHttpStatus(status: number, details: GatewayErrorDetails = {}): GeneratedGatewayError | null {
  const Cls = ERROR_BY_HTTP_STATUS[status as keyof typeof ERROR_BY_HTTP_STATUS];
  return Cls ? new Cls({ ...details, status }) : null;
}

export function getGatewayRetrySemantics(code: GatewayErrorCode): { retryable: boolean; supportsRetryAfter: boolean } {
  return RETRY_DEFAULTS[code];
}
