/**
 * Per-agent × route rate limiting (Issue #1447).
 *
 * Spend caps bound *cost over a period*; they do not bound *burst rate*. An
 * agent in a retry loop can exhaust its entire cap in seconds and hammer the
 * upstream provider on the way — the meter counts the damage afterwards, it
 * never prevented it.
 *
 * This module adds the missing orthogonal bound: a token bucket keyed by
 * `agentId + route`, expressed as requests per interval with a burst
 * allowance. It lives in the metering core because the rate limit is part of
 * admission — the gateway calls `consume()` before it touches the upstream
 * and before it spends anything, so a throttled agent never reaches the cap.
 *
 * The rejection is a decision, not an exception: the caller decides what to
 * surface (the gateway maps a denial to `GATEWAY_RATE_LIMITED` / 429 with a
 * `Retry-After` hint — deliberately distinct from an out-of-funds rejection,
 * so a client can tell "slow down" from "out of money").
 */

export interface RateLimitPolicy {
  /** Requests allowed per interval at steady state. */
  requestsPerInterval: number;
  /** Length of the interval in milliseconds. */
  intervalMs: number;
  /** Burst headroom above the per-interval allowance, refilled at the same rate. */
  burstAllowance: number;
}

/**
 * Sane default, applied to every route unless a provider overrides it
 * (nothing is exempt silently): 90 requests on the first burst, then a
 * sustained 1 request/second.
 */
export const DEFAULT_RATE_LIMIT_POLICY: RateLimitPolicy = {
  requestsPerInterval: 60,
  intervalMs: 60_000,
  burstAllowance: 30,
};

/** Outcome of a `RateLimiter.consume()` call. */
export interface RateLimitDecision {
  allowed: boolean;
  /** Milliseconds until the next request may pass; 0 when allowed. */
  retryAfterMs: number;
  /** Tokens remaining in the bucket (before a denied request is refused). */
  remaining: number;
  /** Bucket capacity (requestsPerInterval + burstAllowance). */
  limit: number;
}

/** Validate a policy, returning a human-readable message when it is invalid. */
export function validateRateLimitPolicy(policy: RateLimitPolicy): string | null {
  if (typeof policy.requestsPerInterval !== 'number' || !Number.isFinite(policy.requestsPerInterval) || policy.requestsPerInterval < 0) {
    return 'rateLimit.requestsPerInterval must be a finite number greater than or equal to 0';
  }
  if (typeof policy.intervalMs !== 'number' || !Number.isFinite(policy.intervalMs) || policy.intervalMs <= 0) {
    return 'rateLimit.intervalMs must be a finite number greater than 0';
  }
  if (typeof policy.burstAllowance !== 'number' || !Number.isFinite(policy.burstAllowance) || policy.burstAllowance < 0) {
    return 'rateLimit.burstAllowance must be a finite number greater than or equal to 0';
  }
  return null;
}

/** Fill missing fields with the platform default, then validate the result. */
export function normalizeRateLimitPolicy(input: Partial<RateLimitPolicy> | undefined): RateLimitPolicy {
  const policy: RateLimitPolicy = { ...DEFAULT_RATE_LIMIT_POLICY, ...(input ?? {}) };
  const problem = validateRateLimitPolicy(policy);
  if (problem) {
    throw new Error(problem);
  }
  return policy;
}

/**
 * Token-bucket rate limiter for the metering core (Issue #1447).
 *
 * Policies are keyed by route so all agents share the provider's per-route
 * budget; every agent consumes from its own bucket of that shared policy.
 * A route without a policy is unlimited — wiring always installs one, because
 * "unlimited" is not a default we ship.
 */
export class RateLimiter {
  private readonly policies = new Map<string, RateLimitPolicy>();
  private readonly buckets = new Map<string, { tokens: number; updatedAtMs: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Install or replace the policy for a route. Rejects invalid policies. */
  setPolicy(route: string, policy: Partial<RateLimitPolicy>): void {
    const normalized = normalizeRateLimitPolicy(policy);
    // A changed policy starts everyone at the new budget, not at a carry-over
    // of the old one — retuning a provider mid-burst should take effect now.
    const suffix = `\u0000${route}`;
    for (const key of this.buckets.keys()) {
      if (key.endsWith(suffix)) {
        this.buckets.delete(key);
      }
    }
    this.policies.set(route, normalized);
  }

  /** Remove the policy (and buckets) for a route. */
  clearPolicy(route: string): void {
    this.policies.delete(route);
    for (const key of this.buckets.keys()) {
      if (key.endsWith(`\u0000${route}`)) {
        this.buckets.delete(key);
      }
    }
  }

  /** The policy currently in force for a route, if any. */
  policyFor(route: string): RateLimitPolicy | undefined {
    return this.policies.get(route);
  }

  /**
   * Attempt to allow `tokens` requests for `agentId` on `route`, holding the
   * bucket state only when the request is allowed.
   *
   * No policy → allowed unconditionally (remaining = Infinity).
   */
  consume(agentId: string, route: string, tokens = 1): RateLimitDecision {
    const policy = this.policies.get(route);
    if (!policy) {
      return { allowed: true, retryAfterMs: 0, remaining: Infinity, limit: Infinity };
    }

    const key = `${agentId}\u0000${route}`;
    const nowMs = this.now();
    const capacity = policy.requestsPerInterval + policy.burstAllowance;
    const ratePerMs = policy.requestsPerInterval / policy.intervalMs;

    const existing = this.buckets.get(key);
    // Clock going backwards is treated as an empty refill window, never a refund.
    const elapsed = existing && existing.updatedAtMs <= nowMs ? nowMs - existing.updatedAtMs : 0;
    const tokensNow = existing ? Math.min(capacity, existing.tokens + elapsed * ratePerMs) : capacity;

    if (tokensNow >= tokens) {
      const next = Math.max(0, tokensNow - tokens);
      this.buckets.set(key, { tokens: next, updatedAtMs: nowMs });
      return { allowed: true, retryAfterMs: 0, remaining: next, limit: capacity };
    }

    const retryAfterMs =
      ratePerMs > 0 ? Math.ceil((tokens - tokensNow) / ratePerMs) : policy.intervalMs;
    return { allowed: false, retryAfterMs, remaining: tokensNow, limit: capacity };
  }
}