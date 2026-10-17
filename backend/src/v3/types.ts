import type { DegradedPolicy } from '../../../packages/metering/src/degraded-admission';
import type { RateLimitPolicy } from '../../../packages/metering/src/rate-limit';

export type ProviderMode = 'staging' | 'production';

/**
 * What a provider does while the meter's counter store is unavailable
 * (Issue #1444): fail open and serve unbilled, or fail closed and refuse.
 */
export type DegradedModePolicy = DegradedPolicy;

export interface ProviderRegistration {
  providerId: string;
  identity: string;
  payoutAddress: string;
  upstreamBaseUrl: string;
  agreementTerms: string;
  mode: ProviderMode;
  payoutVerified: boolean;
  payoutChallenge: string | null;
  /** Per-provider degraded-mode policy; platform default until overridden. */
  degradedMode: DegradedModePolicy;
  /**
   * Per-agent × route burst rate limit applied to every route this provider
   * registers unless the route overrides it (#1447). Platform default until
   * overridden — nothing is exempt silently.
   */
  rateLimit: RateLimitPolicy;
  createdAt: string;
  updatedAt: string;
}

export interface RegisteredRoute {
  routeId: string;
  providerId: string;
  pathPattern: string;
  method: string;
  unit: string;
  price: number;
  quantityExtractor: string;
  scopeKey: string;
  /** Per-route rate-limit override; falls back to the provider default (#1447). */
  rateLimit?: RateLimitPolicy;
  createdAt: string;
}

/**
 * A published price for one route. Versions are append-only: a later version
 * does not rewrite an earlier one, and a call is priced by the version whose
 * `effectiveFrom` was already in the past when the call was metered.
 */
export interface RateCardVersion {
  versionId: string;
  providerId: string;
  routeId: string;
  sequence: number;
  label: string;
  price: number;
  unit: string;
  quantityExtractor: string;
  pathPattern: string;
  method: string;
  effectiveFrom: string;
  createdAt: string;
}

export interface ProviderRouteView extends RegisteredRoute {
  /** Version that prices calls metered at `applicableAt`. */
  applicableVersion: RateCardVersion | null;
}

export type SettlementStatus = 'settled' | 'unsettled' | 'in_dispute';

export interface ProviderSettlement {
  settlementId: string;
  providerId: string;
  routeId: string;
  receiptId: string;
  method: string;
  pathPattern: string;
  unit: string;
  quantity: number;
  /** Unit price of the rate-card version that applied when the call was metered. */
  price: number;
  amount: number;
  rateCardVersion: string;
  rateCardEffectiveFrom: string;
  status: SettlementStatus;
  meteredAt: string;
  channelId: string;
}

/** Three buckets, kept separate. There is no combined total. */
export interface ProviderRevenue {
  settled: number;
  unsettled: number;
  inDispute: number;
}

export interface AgentRegistryGrant {
  agentId: string;
  scopes: string[];
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface ScopeCheckRequest {
  agentId: string;
  routeScope: string;
}

export type ScopeRejectionCode =
  | 'missing_scope'
  | 'grant_expired'
  | 'grant_revoked'
  | 'registry_unavailable';

export class ScopeRejectionError extends Error {
  readonly code: ScopeRejectionCode;

  constructor(code: ScopeRejectionCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type MeterDegradedReason = 'fail_closed' | 'exposure_ceiling';

/**
 * The counter store is down and the provider's policy says this call must not
 * be served unbilled — either because it fails closed by configuration, or
 * because its unbilled-exposure budget for this outage is spent (#1444).
 *
 * Mapped to HTTP 503 with `GATEWAY_METER_DEGRADED` and `Retry-After`, which
 * the SDK already treats as retryable with a 10s delay.
 */
export class MeterDegradedError extends Error {
  readonly code = 'GATEWAY_METER_DEGRADED';
  readonly status = 503;
  readonly retryAfterSeconds = 10;
  readonly reason: MeterDegradedReason;
  readonly providerId: string;

  constructor(reason: MeterDegradedReason, providerId: string) {
    super(
      reason === 'fail_closed'
        ? 'metering is degraded and this provider fails closed'
        : 'metering is degraded and this provider exhausted its unbilled exposure budget',
    );
    this.name = 'MeterDegradedError';
    this.reason = reason;
    this.providerId = providerId;
  }
}

/**
 * The agent outran its per-route burst budget (#1447): "slow down", not "out
 * of money". Mapped to HTTP 429 `GATEWAY_RATE_LIMITED` with a `Retry-After`
 * hint — deliberately distinguishable from `GatewayMeterInsufficientError`
 * (402, `GATEWAY_METER_INSUFFICIENT`) so a client can back off instead of
 * giving up, and re-fund instead of retrying.
 */
export class MeterRateLimitedError extends Error {
  readonly code = 'GATEWAY_RATE_LIMITED';
  readonly status = 429;
  readonly retryable = true;
  readonly action = 'wait';
  /** Headroom in milliseconds: how long until the next request may pass. */
  readonly retryAfterMs: number;
  readonly route: string;

  constructor(route: string, retryAfterMs: number) {
    super(`per-agent rate limit exceeded on ${route}: retry after ${retryAfterMs}ms`);
    this.name = 'MeterRateLimitedError';
    this.route = route;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * The agent has no metering headroom left (#1447): "out of money", not "slow
 * down". Mapped to HTTP 402 `GATEWAY_METER_INSUFFICIENT` — the taxonomy code
 * v2's `AdmissionService` already emits — which the SDK treats as a hard,
 * non-retryable failure, so the agent refills instead of hammering.
 */
export class MeterInsufficientFundsError extends Error {
  readonly code = 'GATEWAY_METER_INSUFFICIENT';
  readonly status = 402;
  readonly retryable = false;
  readonly action = 'fund';
  readonly route: string;
  readonly available: number;
  readonly needed: number;
  readonly limit: number;

  constructor(route: string, available: number, needed: number, limit: number) {
    super(
      `metering cap exceeded on ${route}: ${available} available, ${needed} needed ` +
        `(limit ${limit})`,
    );
    this.name = 'MeterInsufficientFundsError';
    this.route = route;
    this.available = available;
    this.needed = needed;
    this.limit = limit;
  }
}

export interface PaidReceiptPayload {
  receiptId: string;
  requestHash: string;
  route: string;
  unit: string;
  quantity: number;
  amount: number;
  rateCardVersion: string;
  exchangeRate: number | null;
  channelId: string;
  stateNonce: number;
  timestamp: string;
  signerPublicKey: string;
}

export interface PaidReceipt extends PaidReceiptPayload {
  signature: string;
}

