import { describe, expect, it } from 'vitest';
import type { AdmissionResult } from '../src/services/admission-service';
import {
  EXT_AUTHZ_UPSTREAM_HEADERS as H,
  toEnvoyExtAuthzHttpResponse,
} from '../src/v3/ext-authz/envoy-http';

function baseResult(overrides: Partial<AdmissionResult> = {}): AdmissionResult {
  return {
    admitted: true,
    identity: { userId: 'u1', address: 'G...', signature: 's', nonce: 'n', valid: true, resolvedAt: 0 },
    scope: { userId: 'u1', scopes: ['read', 'write'], registryId: 'r', tier: 'pro', resolvedAt: 0 },
    cap: {
      userId: 'u1', capCeiling: 100, currentUsage: 40, remaining: 60, withinCap: true,
      resolvedAt: 0, periodResetAt: null, retryAfterSeconds: null,
    },
    meter: { userId: 'u1', amountReserved: 1, balance: 10, reserveId: 'res_1', expiresAt: 0, resolvedAt: 0 },
    totalLatencyMs: 3,
    stepLatenciesMs: { identityResolution: 1, scopeRead: 1, capCheck: 1, meterReserve: 0 },
    p99Compliant: true,
    errors: [],
    ...overrides,
  };
}

describe('toEnvoyExtAuthzHttpResponse', () => {
  it('allows with 200 and upstream identity/scope/cap headers', () => {
    const res = toEnvoyExtAuthzHttpResponse(baseResult());
    expect(res.status).toBe(200);
    expect(res.body).toBeUndefined();
    expect(res.headers).toEqual({
      [H.userId]: 'u1',
      [H.scopes]: 'read write',
      [H.tier]: 'pro',
      [H.capRemaining]: '60',
      [H.reserveId]: 'res_1',
    });
  });

  it('maps cap exhaustion to taxonomy status with retry-after and reset', () => {
    const res = toEnvoyExtAuthzHttpResponse(baseResult({
      admitted: false,
      errors: [{
        step: 'capCheck', message: 'cap hit', latencyMs: 1, fatal: true,
        code: 'GATEWAY_CAP_EXCEEDED', retryAfterSeconds: 120, resetAt: '2026-12-01T00:00:00Z',
      }],
    }));
    expect(res.status).toBe(403);
    expect(res.headers['retry-after']).toBe('120');
    expect(res.body).toMatchObject({
      code: 'GATEWAY_CAP_EXCEEDED',
      message: 'cap hit',
      retryAfterSeconds: 120,
      capResetAt: '2026-12-01T00:00:00Z',
    });
    expect(Object.keys(res.headers)).not.toContain(H.userId);
  });

  it('prefers the fatal error and falls back to GATEWAY_INTERNAL for unknown codes', () => {
    const res = toEnvoyExtAuthzHttpResponse(baseResult({
      admitted: false,
      errors: [
        { step: 'scopeRead', message: 'slow', latencyMs: 9, fatal: false },
        { step: 'x', message: 'boom', latencyMs: 1, fatal: true, code: 'NOT_A_CODE' },
      ],
    }));
    expect(res.status).toBe(500);
    expect(res.headers['retry-after']).toBe('5');
    expect(res.body).toMatchObject({ code: 'GATEWAY_INTERNAL', message: 'boom', retryable: true });
  });
});
