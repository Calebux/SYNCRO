/**
 * Envoy ext_authz (HTTP service mode) adapter for SYNCRO admission.
 *
 * Envoy's HTTP ext_authz filter forwards a copy of the inbound request to an
 * authorization service and interprets the reply:
 *   - 200       → allow; headers listed in `allowed_upstream_headers` are
 *                 injected into the request sent to the upstream.
 *   - any other → deny; status, body and headers listed in
 *                 `allowed_client_headers` are returned to the caller.
 *
 * This module is a pure mapping from an `AdmissionResult` to that contract so
 * it can be reused by the HTTP server, a future gRPC `CheckResponse` mapper and
 * tests without touching Express or the admission service itself.
 */
import type { AdmissionResult } from '../../services/admission-service';
import gatewayTaxonomy from '../../errors/gateway-taxonomy.json';

/** Headers SYNCRO injects upstream on allow. Configure these in Envoy's `allowed_upstream_headers`. */
export const EXT_AUTHZ_UPSTREAM_HEADERS = {
  userId: 'x-syncro-user-id',
  scopes: 'x-syncro-scopes',
  tier: 'x-syncro-tier',
  capRemaining: 'x-syncro-cap-remaining',
  reserveId: 'x-syncro-reserve-id',
} as const;

export interface ExtAuthzHttpResponse {
  status: number;
  headers: Record<string, string>;
  /** JSON body for denials; undefined on allow (Envoy ignores it). */
  body?: Record<string, unknown>;
}

const FALLBACK_CODE = 'GATEWAY_INTERNAL';

function findDefinition(code: string | undefined) {
  return (
    gatewayTaxonomy.errors.find(e => e.code === code) ??
    gatewayTaxonomy.errors.find(e => e.code === FALLBACK_CODE)!
  );
}

export function toEnvoyExtAuthzHttpResponse(result: AdmissionResult): ExtAuthzHttpResponse {
  if (result.admitted) {
    const h = EXT_AUTHZ_UPSTREAM_HEADERS;
    const headers: Record<string, string> = {};
    if (result.identity) headers[h.userId] = result.identity.userId;
    if (result.scope) {
      headers[h.scopes] = result.scope.scopes.join(' ');
      headers[h.tier] = result.scope.tier;
    }
    if (result.cap) headers[h.capRemaining] = String(result.cap.remaining);
    if (result.meter) headers[h.reserveId] = result.meter.reserveId;
    return { status: 200, headers };
  }

  // Mirrors createAdmissionMiddleware's denial shape so clients see the same
  // body whether they hit the SYNCRO gateway directly or go through Envoy.
  const denied = result.errors.find(e => e.fatal) ?? result.errors[0];
  const def = findDefinition(denied?.code);
  const retryAfterSeconds = denied?.retryAfterSeconds ?? def.retryAfterSeconds;
  const message = denied?.message || def.defaultMessage;

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (retryAfterSeconds !== undefined) headers['retry-after'] = String(retryAfterSeconds);

  return {
    status: def.httpStatus,
    headers,
    body: {
      code: def.code,
      message,
      detail: message,
      action: def.action,
      retryable: def.retryable,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      ...(denied?.resetAt !== undefined ? { capResetAt: denied.resetAt } : {}),
    },
  };
}
