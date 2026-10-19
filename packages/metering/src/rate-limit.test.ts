import { describe, it, expect, beforeEach } from 'vitest';
import {
  RateLimiter,
  DEFAULT_RATE_LIMIT_POLICY,
  normalizeRateLimitPolicy,
  validateRateLimitPolicy,
  type RateLimitPolicy,
} from './rate-limit';

function policy(overrides: Partial<RateLimitPolicy> = {}): RateLimitPolicy {
  return { ...DEFAULT_RATE_LIMIT_POLICY, ...overrides };
}

describe('RateLimiter (Issue #1447)', () => {
  let clockMs: number;
  let limiter: RateLimiter;

  beforeEach(() => {
    clockMs = 1_000_000;
    limiter = new RateLimiter(() => clockMs);
  });

  const advance = (ms: number): void => {
    clockMs += ms;
  };

  it('allows unconditionally when no policy is installed', () => {
    const decision = limiter.consume('agent-a', 'POST:/echo/*');
    expect(decision).toMatchObject({ allowed: true, remaining: Infinity, limit: Infinity });
  });

  it('allows a full burst of requestsPerInterval + burstAllowance, then denies', () => {
    limiter.setPolicy('POST:/echo/*', policy({ requestsPerInterval: 3, burstAllowance: 1 }));
    for (let i = 0; i < 4; i += 1) {
      expect(limiter.consume('agent-a', 'POST:/echo/*').allowed).toBe(true);
    }
    const denied = limiter.consume('agent-a', 'POST:/echo/*');
    expect(denied.allowed).toBe(false);
    expect(denied.limit).toBe(4);
  });

  it('refills one request per interval at steady state', () => {
    limiter.setPolicy('POST:/echo/*', policy({ requestsPerInterval: 1, intervalMs: 1_000, burstAllowance: 0 }));
    expect(limiter.consume('agent-a', 'POST:/echo/*').allowed).toBe(true);
    expect(limiter.consume('agent-a', 'POST:/echo/*').allowed).toBe(false);

    advance(1_000);
    expect(limiter.consume('agent-a', 'POST:/echo/*').allowed).toBe(true);
    expect(limiter.consume('agent-a', 'POST:/echo/*').allowed).toBe(false);

    // Partial refill: the bucket has 0.5 tokens after 500ms, still < 1 needed.
    advance(500);
    expect(limiter.consume('agent-a', 'POST:/echo/*').allowed).toBe(false);
    advance(500);
    expect(limiter.consume('agent-a', 'POST:/echo/*').allowed).toBe(true);
  });

  it('reports a retry-after hint in milliseconds', () => {
    limiter.setPolicy('POST:/echo/*', policy({ requestsPerInterval: 2, intervalMs: 1_000, burstAllowance: 0 }));
    expect(limiter.consume('agent-a', 'POST:/echo/*').allowed).toBe(true);
    expect(limiter.consume('agent-a', 'POST:/echo/*').allowed).toBe(true);
    // rate = 2 req / 1000ms = 0.002 / ms; next token needs ceil(1 / 0.002) = 500ms.
    const denied = limiter.consume('agent-a', 'POST:/echo/*');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBe(500);
  });

  it('isolates tokens per agent under a shared per-route policy', () => {
    limiter.setPolicy('POST:/echo/*', policy({ requestsPerInterval: 1, intervalMs: 60_000, burstAllowance: 0 }));
    expect(limiter.consume('agent-a', 'POST:/echo/*').allowed).toBe(true);
    expect(limiter.consume('agent-a', 'POST:/echo/*').allowed).toBe(false);
    // A different agent starts with full tokens.
    expect(limiter.consume('agent-b', 'POST:/echo/*').allowed).toBe(true);
  });

  it('isolates policies per route', () => {
    limiter.setPolicy('POST:/cheap/*', policy({ requestsPerInterval: 1, intervalMs: 60_000, burstAllowance: 0 }));
    limiter.setPolicy('POST:/expensive/*', policy({ requestsPerInterval: 5, intervalMs: 60_000, burstAllowance: 0 }));

    expect(limiter.consume('agent-a', 'POST:/cheap/*').allowed).toBe(true);
    expect(limiter.consume('agent-a', 'POST:/cheap/*').allowed).toBe(false);

    for (let i = 0; i < 5; i += 1) {
      expect(limiter.consume('agent-a', 'POST:/expensive/*').allowed).toBe(true);
    }
    expect(limiter.consume('agent-a', 'POST:/expensive/*').allowed).toBe(false);
  });

  it('denies with retryAfterMs = intervalMs when the refill rate is zero', () => {
    limiter.setPolicy('POST:/echo/*', policy({ requestsPerInterval: 0, intervalMs: 60_000, burstAllowance: 0 }));
    const denied = limiter.consume('agent-a', 'POST:/echo/*');
    expect(denied).toMatchObject({ allowed: false, retryAfterMs: 60_000 });
  });

  it('resets buckets when a policy is re-set mid-burst', () => {
    limiter.setPolicy('POST:/echo/*', policy({ requestsPerInterval: 1, intervalMs: 60_000, burstAllowance: 0 }));
    expect(limiter.consume('agent-a', 'POST:/echo/*').allowed).toBe(true);
    expect(limiter.consume('agent-a', 'POST:/echo/*').allowed).toBe(false);

    limiter.setPolicy('POST:/echo/*', policy({ requestsPerInterval: 2, intervalMs: 60_000, burstAllowance: 0 }));
    expect(limiter.consume('agent-a', 'POST:/echo/*').allowed).toBe(true);
  });

  it('treats a backwards clock as an empty refill window, never a refund', () => {
    limiter.setPolicy('POST:/echo/*', policy({ requestsPerInterval: 2, intervalMs: 1_000, burstAllowance: 0 }));
    limiter.consume('agent-a', 'POST:/echo/*'); // 2 -> 1
    limiter.consume('agent-a', 'POST:/echo/*'); // 1 -> 0
    advance(1_000); // full refill: 0 -> 2
    expect(limiter.consume('agent-a', 'POST:/echo/*').allowed).toBe(true); // 2 -> 1

    clockMs -= 5_000; // jump far below the bucket's last update
    // Without the rewind guard the elapsed window would be -5000ms and eat the
    // stored token (denied, remaining -9). The guard treats it as 0ms.
    const decision = limiter.consume('agent-a', 'POST:/echo/*');
    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(0);
  });

  it('clearPolicy removes the policy and the buckets', () => {
    limiter.setPolicy('POST:/echo/*', policy({ requestsPerInterval: 0, intervalMs: 60_000, burstAllowance: 0 }));
    expect(limiter.consume('agent-a', 'POST:/echo/*').allowed).toBe(false);
    limiter.clearPolicy('POST:/echo/*');
    expect(limiter.consume('agent-a', 'POST:/echo/*').allowed).toBe(true);
  });
});

describe('rate limit policy normalization (Issue #1447)', () => {
  it('fills missing fields with the platform default', () => {
    expect(normalizeRateLimitPolicy({})).toEqual(DEFAULT_RATE_LIMIT_POLICY);
    expect(normalizeRateLimitPolicy(undefined)).toEqual(DEFAULT_RATE_LIMIT_POLICY);
    expect(normalizeRateLimitPolicy({ requestsPerInterval: 10 })).toMatchObject({
      requestsPerInterval: 10,
      intervalMs: DEFAULT_RATE_LIMIT_POLICY.intervalMs,
      burstAllowance: DEFAULT_RATE_LIMIT_POLICY.burstAllowance,
    });
  });

  it('rejects negative or non-finite values', () => {
    expect(validateRateLimitPolicy({ requestsPerInterval: -1, intervalMs: 1000, burstAllowance: 0 })).toBeTruthy();
    expect(validateRateLimitPolicy({ requestsPerInterval: 1, intervalMs: 0, burstAllowance: 0 })).toBeTruthy();
    expect(validateRateLimitPolicy({ requestsPerInterval: 1, intervalMs: 1000, burstAllowance: -5 })).toBeTruthy();
    expect(validateRateLimitPolicy({ requestsPerInterval: 1, intervalMs: 1000, burstAllowance: 5 })).toBeNull();
    expect(() => normalizeRateLimitPolicy({ requestsPerInterval: -1 })).toThrow(/requestsPerInterval/);
  });
});