import type { Response } from 'express';
import logger from '../config/logger';
import { getRequestId } from '../middleware/requestContext';
import gatewayTaxonomy from './gateway-taxonomy.json';
import {
  MeterDegradedError,
  MeterInsufficientFundsError,
  MeterRateLimitedError,
  PaidCallRequestError,
  ScopeRejectionError,
  UpstreamUnavailableError,
} from '../v3/types';

/**
 * One entry of the gateway error taxonomy
 * (`backend/src/errors/gateway-taxonomy.json`), which is the single source of
 * truth shared with the SDK's generated error classes.
 */
export interface GatewayTaxonomyEntry {
  code: string;
  className: string;
  httpStatus: number;
  action: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  supportsRetryAfterHeader: boolean;
  defaultMessage: string;
}

type TaxonomyCode = GatewayTaxonomyEntry['code'];

const taxonomyByCode = new Map<string, GatewayTaxonomyEntry>(
  (gatewayTaxonomy.errors as GatewayTaxonomyEntry[]).map((entry) => [entry.code, entry]),
);

/**
 * Look up a taxonomy entry by code. Throws if the code is not part of the
 * taxonomy so a typo can never silently degrade to a generic response.
 */
export function taxonomyEntry(code: TaxonomyCode): GatewayTaxonomyEntry {
  const entry = taxonomyByCode.get(code);
  if (!entry) {
    throw new Error(`unknown gateway taxonomy code: ${code}`);
  }
  return entry;
}

/**
 * A gateway error reduced to what a client is allowed to see: a taxonomy code,
 * its HTTP status and the taxonomy's public message. Never carries the
 * internal error text.
 */
export interface PublicGatewayError {
  code: TaxonomyCode;
  httpStatus: number;
  action: string;
  retryable: boolean;
  message: string;
  retryAfterSeconds?: number;
  /** Extra non-sensitive fields for the specific code (route, caps, ...). */
  details?: Record<string, unknown>;
}

/**
 * Classify an error thrown while serving a paid call into a transferable
 * taxonomy member. Only the error *kind* crosses the boundary — the internal
 * `message` is deliberately discarded and replaced by the taxonomy's public
 * `defaultMessage`.
 *
 * The mapping is exhaustive over what the paid-call path can throw:
 * - scope rejections (403 family) come from the scope enforcer,
 * - `MeterDegradedError` (503), `MeterRateLimitedError` (429) and
 *   `MeterInsufficientFundsError` (402) from the meter/admission stages,
 * - `UpstreamUnavailableError` (503) when the provider's upstream fails,
 * - everything else is a client-shaped problem (`GATEWAY_BAD_REQUEST`) except
 *   truly unknown failures, which become `GATEWAY_INTERNAL`.
 */
export function toPublicGatewayError(error: unknown): PublicGatewayError {
  if (error instanceof ScopeRejectionError) {
    const code = scopeTaxonomyCode(error.code);
    const entry = taxonomyEntry(code);
    return { ...base(entry), code: entry.code };
  }

  if (error instanceof MeterDegradedError) {
    const entry = taxonomyEntry('GATEWAY_METER_DEGRADED');
    return { ...base(entry), code: entry.code, details: { reason: error.reason } };
  }

  if (error instanceof MeterRateLimitedError) {
    const entry = taxonomyEntry('GATEWAY_RATE_LIMITED');
    return {
      ...base(entry),
      code: entry.code,
      retryAfterSeconds: Math.max(1, Math.ceil(error.retryAfterMs / 1000)),
      details: { route: error.route, retryAfterMs: error.retryAfterMs, action: entry.action },
    };
  }

  if (error instanceof MeterInsufficientFundsError) {
    const entry = taxonomyEntry('GATEWAY_METER_INSUFFICIENT');
    return {
      ...base(entry),
      code: entry.code,
      details: {
        route: error.route,
        available: error.available,
        needed: error.needed,
        limit: error.limit,
        action: entry.action,
      },
    };
  }

  if (error instanceof UpstreamUnavailableError) {
    const entry = taxonomyEntry('GATEWAY_UPSTREAM_UNAVAILABLE');
    return { ...base(entry), code: entry.code };
  }

  // Client-shaped failures from the provider/route lookup stages: the request
  // named something we do not have. 400 without leaking which internal value
  // was missing (#1617).
  if (error instanceof PaidCallRequestError) {
    const entry = taxonomyEntry('GATEWAY_BAD_REQUEST');
    return { ...base(entry), code: entry.code };
  }

  const entry = taxonomyEntry('GATEWAY_INTERNAL');
  return { ...base(entry), code: entry.code };
}

function scopeTaxonomyCode(code: ScopeRejectionError['code']): TaxonomyCode {
  switch (code) {
    case 'grant_expired':
      return 'GATEWAY_GRANT_EXPIRED';
    case 'grant_revoked':
      return 'GATEWAY_KEY_REVOKED';
    case 'missing_scope':
    case 'registry_unavailable':
    default:
      return 'GATEWAY_SCOPE_DENIED';
  }
}

function base(entry: GatewayTaxonomyEntry): PublicGatewayError {
  return {
    code: entry.code as TaxonomyCode,
    httpStatus: entry.httpStatus,
    action: entry.action,
    retryable: entry.retryable,
    message: entry.defaultMessage,
    ...(entry.retryAfterSeconds !== undefined
      ? { retryAfterSeconds: entry.retryAfterSeconds }
      : {}),
  };
}

/**
 * Convert an error into the public taxonomy response, log the internal message
 * with the request correlation id, and write it to `res`. Nothing from the
 * original error other than its classified kind reaches the client.
 */
export function sendGatewayError(res: Response, error: unknown): Response {
  const publicError = toPublicGatewayError(error);
  const internalMessage =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'non-error thrown';

  logger.error('gateway paid-call failed', {
    code: publicError.code,
    httpStatus: publicError.httpStatus,
    requestId: getRequestId(),
    err: { message: internalMessage, name: error instanceof Error ? error.name : typeof error },
  });

  if (publicError.retryAfterSeconds !== undefined) {
    res.setHeader('Retry-After', String(publicError.retryAfterSeconds));
  }

  const { httpStatus, ...body } = publicError;
  return res.status(httpStatus).json(body);
}
