import {
  taxonomyEntry,
  toPublicGatewayError,
} from '../src/errors/gateway-error-response';
import {
  MeterDegradedError,
  MeterInsufficientFundsError,
  MeterRateLimitedError,
  PaidCallRequestError,
  ScopeRejectionError,
  UpstreamUnavailableError,
} from '../src/v3/types';

// Internal text that must never reach a client.
const INTERNAL_SECRET = 'internal-store-dsn-postgres://user:pass@host/db';

describe('gateway error response mapping (#1617)', () => {
  it('maps each scope rejection reason to its taxonomy code and 403', () => {
    expect(toPublicGatewayError(new ScopeRejectionError('missing_scope', INTERNAL_SECRET))).toMatchObject({
      code: 'GATEWAY_SCOPE_DENIED',
      httpStatus: 403,
      action: 'request_access',
    });
    expect(toPublicGatewayError(new ScopeRejectionError('grant_expired', INTERNAL_SECRET))).toMatchObject({
      code: 'GATEWAY_GRANT_EXPIRED',
      httpStatus: 403,
    });
    expect(toPublicGatewayError(new ScopeRejectionError('grant_revoked', INTERNAL_SECRET))).toMatchObject({
      code: 'GATEWAY_KEY_REVOKED',
      httpStatus: 403,
    });
    expect(toPublicGatewayError(new ScopeRejectionError('registry_unavailable', INTERNAL_SECRET))).toMatchObject({
      code: 'GATEWAY_SCOPE_DENIED',
      httpStatus: 403,
    });
  });

  it('maps meter failures to 503/429/402 with their taxonomy codes', () => {
    expect(toPublicGatewayError(new MeterDegradedError('fail_closed', 'provider-1'))).toMatchObject({
      code: 'GATEWAY_METER_DEGRADED',
      httpStatus: 503,
      retryAfterSeconds: 10,
    });
    const limited = toPublicGatewayError(new MeterRateLimitedError('POST:/x', 1500));
    expect(limited).toMatchObject({
      code: 'GATEWAY_RATE_LIMITED',
      httpStatus: 429,
      retryAfterSeconds: 2,
    });
    expect(toPublicGatewayError(new MeterInsufficientFundsError('POST:/x', 0, 5, 10))).toMatchObject({
      code: 'GATEWAY_METER_INSUFFICIENT',
      httpStatus: 402,
    });
  });

  it('maps upstream failures to a retryable 503', () => {
    expect(toPublicGatewayError(new UpstreamUnavailableError())).toMatchObject({
      code: 'GATEWAY_UPSTREAM_UNAVAILABLE',
      httpStatus: 503,
      retryable: true,
    });
  });

  it('maps request-shaped failures to 400 without echoing the internal message', () => {
    const publicError = toPublicGatewayError(new PaidCallRequestError(INTERNAL_SECRET));
    expect(publicError).toMatchObject({ code: 'GATEWAY_BAD_REQUEST', httpStatus: 400 });
    expect(JSON.stringify(publicError)).not.toContain(INTERNAL_SECRET);
  });

  it('maps unknown failures to 500 and never leaks the original message', () => {
    const publicError = toPublicGatewayError(new Error(INTERNAL_SECRET));
    expect(publicError).toMatchObject({ code: 'GATEWAY_INTERNAL', httpStatus: 500 });
    expect(JSON.stringify(publicError)).not.toContain(INTERNAL_SECRET);
  });

  it('never exposes an internal message for any classification', () => {
    const errors: unknown[] = [
      new ScopeRejectionError('missing_scope', INTERNAL_SECRET),
      new MeterDegradedError('exposure_ceiling', 'provider-1'),
      new MeterRateLimitedError('POST:/x', 1000),
      new MeterInsufficientFundsError('POST:/x', 0, 1, 1),
      new UpstreamUnavailableError(),
      new PaidCallRequestError(INTERNAL_SECRET),
      new Error(INTERNAL_SECRET),
      'a bare string',
      undefined,
    ];
    for (const error of errors) {
      expect(JSON.stringify(toPublicGatewayError(error))).not.toContain(INTERNAL_SECRET);
    }
  });

  it('resolves every used code against the shared taxonomy', () => {
    expect(taxonomyEntry('GATEWAY_SCOPE_DENIED').httpStatus).toBe(403);
    expect(taxonomyEntry('GATEWAY_GRANT_EXPIRED').httpStatus).toBe(403);
    expect(taxonomyEntry('GATEWAY_KEY_REVOKED').httpStatus).toBe(403);
    expect(taxonomyEntry('GATEWAY_METER_DEGRADED').httpStatus).toBe(503);
    expect(taxonomyEntry('GATEWAY_RATE_LIMITED').httpStatus).toBe(429);
    expect(taxonomyEntry('GATEWAY_METER_INSUFFICIENT').httpStatus).toBe(402);
    expect(taxonomyEntry('GATEWAY_UPSTREAM_UNAVAILABLE').httpStatus).toBe(503);
    expect(taxonomyEntry('GATEWAY_BAD_REQUEST').httpStatus).toBe(400);
    expect(taxonomyEntry('GATEWAY_INTERNAL').httpStatus).toBe(500);
  });
});
