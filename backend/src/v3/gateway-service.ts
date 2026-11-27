import { randomUUID } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import type { DegradedAdmissionController, DegradedAdmissionDecision } from '../../../packages/metering/src/degraded-admission';
import type { RateLimiter } from '../../../packages/metering/src/rate-limit';
import { OverageError } from '../../../packages/metering/src/errors';
import {
  InMemoryProviderStore,
  assertNetworkForMode,
  RecordSettlementInput,
  RegisterProviderInput,
  RegisterRouteInput,
  ReviseRouteInput,
  UpdateDegradedModePolicyInput,
  UpdateRateLimitInput,
  CreatePayoutChangeInput,
  CancelPayoutChangeInput,
  ApplyPayoutChangeInput,
} from './provider-store';
import { ReceiptService } from './receipt-service';
import { AgentRegistryReader, ScopeEnforcer } from './scope-enforcer';
import { auditProviderPayoutAddressChanged } from '../services/audit-service';
import { v3NotificationDispatch } from '../services/v3-notification-dispatch';
import {
  AgentRegistryGrant,
  MeterDegradedError,
  MeterInsufficientFundsError,
  MeterRateLimitedError,
  PaidCallRequestError,
  PaidReceipt,
  PendingPayoutChange,
  ProviderRegistration,
  ProviderRevenue,
  ProviderRouteView,
  ProviderSettlement,
  RateCardVersion,
  RegisteredRoute,
  ScopeRejectionError,
  UpstreamUnavailableError,
} from './types';
import type { Meter, MeterReservation, MeterReading } from '../../../packages/metering/src/meter';
import { calculateChargeStroops, extractMeasuredQuantity, roundBillableUnits } from './pricing';

export interface UpstreamResult {
  status: number;
  body: unknown;
}

export interface UpstreamCaller {
  call(args: {
    upstreamBaseUrl: string;
    method: string;
    path: string;
    body: unknown;
  }): Promise<UpstreamResult>;
}

export interface PaidCallInput {
  providerId: string;
  method: string;
  path: string;
  body: unknown;
  query: Record<string, unknown>;
  agentId: string;
  exchangeRate?: number | null;
  channelId: string;
  stateNonce: number;
}

// ========= On-chain agent registry (added by #1624) =========

/**
 * Minimal read surface of the `contracts/agent-registry` Soroban contract.
 *
 * Implementations are expected to invoke the contract's `has_scope` and
 * `is_authorized` entrypoints; the gateway only depends on this interface so
 * the on-chain reader and the in-memory test reader are interchangeable.
 */
export interface AgentRegistryContractClient {
  hasScope(agentId: string, scope: string): Promise<boolean>;
  isAuthorized(agentId: string): Promise<boolean>;
}

/**
 * Default cache window for on-chain registry reads (#1624). Revoking an agent
 * on-chain blocks its next paid call within this window.
 */
export const AGENT_REGISTRY_CACHE_TTL_MS = 30_000;

export interface AgentRegistryCacheOptions {
  /** How long a resolved grant may be served from cache. */
  ttlMs?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

interface CachedGrant {
  grant: AgentRegistryGrant;
  expiresAt: number;
}

/**
 * On-chain `AgentRegistryReader` backed by `contracts/agent-registry`.
 *
 * Reads `has_scope` / `is_authorized` and caches the resolved grant for a
 * bounded window. Cache entries are invalidated on `agent`, `scope`, and
 * `revoke` events so a revocation takes effect within the documented window
 * (and immediately when the event is observed).
 */
export class OnChainAgentRegistryReader implements AgentRegistryReader {
  private readonly cache = new Map<string, CachedGrant>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly client: AgentRegistryContractClient,
    options: AgentRegistryCacheOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? AGENT_REGISTRY_CACHE_TTL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  async getGrant(agentId: string): Promise<AgentRegistryGrant> {
    const cached = this.cache.get(agentId);
    if (cached && cached.expiresAt > this.now()) {
      return cached.grant;
    }

    const authorized = await this.client.isAuthorized(agentId);
    const grant: AgentRegistryGrant = {
      agentId,
      scopes: [],
      authorized,
    };

    this.cache.set(agentId, { grant, expiresAt: this.now() + this.ttlMs });
    return grant;
  }

  /**
   * Check a single scope against the on-chain registry, consulting the cache
   * first. Returns false when the agent is not authorized or lacks the scope.
   */
  async hasScope(agentId: string, scope: string): Promise<boolean> {
    const grant = await this.getGrant(agentId);
    if (!grant.authorized) {
      return false;
    }
    return this.client.hasScope(agentId, scope);
  }

  /**
   * Invalidate cached reads for an agent. Called when an `agent`, `scope`, or
   * `revoke` event is observed for that agent.
   */
  invalidate(agentId: string): void {
    this.cache.delete(agentId);
  }

  /** Drop every cached grant (e.g. on reconnect / reorg). */
  invalidateAll(): void {
    this.cache.clear();
  }
}

export class InMemoryAgentRegistryReader implements AgentRegistryReader {
  private readonly grants = new Map<string, AgentRegistryGrant>();

  setGrant(grant: AgentRegistryGrant): void {
    this.grants.set(grant.agentId, grant);
  }

  async getGrant(agentId: string): Promise<AgentRegistryGrant> {
    const grant = this.grants.get(agentId);
    if (!grant) {
      throw new Error('grant not found');
    }
    return grant;
  }
}

export class V3GatewayService {
  constructor(
    private readonly providers: InMemoryProviderStore,
    private readonly enforcer: ScopeEnforcer,
    private readonly receipts: ReceiptService,
    private readonly upstream: UpstreamCaller,
    /**
     * Metering core instance. Injected so tests can use InMemoryMeter and
     * production can swap to a durable implementation without touching this file.
     *
     * The Meter interface (reserve / commit / release / read) is the only
     * surface the gateway needs; all internal accounting is behind it.
     */
    private readonly meter: Meter,
    /**
     * Degraded-mode admission for counter-store outages (Issue #1444).
     *
     * Optional so the gateway can be built without an outage policy in unit
     * tests; production wiring always supplies one, because "unbounded
     * fail-open" is not a policy we ship.
     */
    private readonly degraded?: DegradedAdmissionController,
    /**
     * Per-agent x route burst rate limiting (#1447).
     *
     * Optional so the gateway can be built without rate policies in unit
     * tests; production wiring always supplies one, because "unlimited" is
     * not a default we ship.
     */
    private readonly rateLimiter?: RateLimiter,
  ) {}

  registerProvider(input: RegisterProviderInput): ProviderRegistration {
    const provider = this.providers.registerProvider(input);
    this.degraded?.setPolicy(provider.providerId, provider.degradedMode);
    return provider;
  }

  /**
   * Re-policy a provider's counter-store outage behaviour (#1444): fail open
   * or closed, and how much value it may serve unbilled during one outage.
   */
  updateDegradedModePolicy(
    providerId: string,
    patch: UpdateDegradedModePolicyInput,
  ): ProviderRegistration {
    const provider = this.providers.updateDegradedModePolicy(providerId, patch);
    this.degraded?.setPolicy(provider.providerId, provider.degradedMode);
    return provider;
  }

  /**
   * Re-policy every route this provider registers (#1447). Routes with their
   * own override keep it; routes inheriting the provider default pick up the
   * new budget immediately.
   */
  updateRateLimit(providerId: string, patch: UpdateRateLimitInput): ProviderRegistration {
    const provider = this.providers.updateRateLimit(providerId, patch);
    if (this.rateLimiter) {
      for (const route of this.providers.listRoutes(providerId)) {
        if (route.rateLimit === undefined) {
          this.rateLimiter.setPolicy(route.routeId, provider.rateLimit);
        }
      }
    }
    return provider;
  }

  readProvider(providerId: string): ProviderRegistration {
    return this.getProviderOrThrow(providerId);
  }

  updatePayoutAddress(providerId: string, payoutAddress: string): ProviderRegistration {
    this.getProviderOrThrow(providerId);
    return this.providers.updatePayoutAddress(providerId, payoutAddress);
  }

  /**
   * Create a pending payout address change. Requires a verified
   * challenge id so that a compromised session alone cannot
   * redirect payouts. The change only takes effect after the
   * cooling-off window, during which settlements continue to the
   * old address.
   */
  async createPendingPayoutChange(input: CreatePayoutChangeInput): Promise<PendingPayoutChange> {
    const change = this.providers.createPendingPayoutChange(input);
    const provider = this.providers.readProvider(input.providerId);
    await auditProviderPayoutAddressChanged(input.requestedBy, {
      providerId: input.providerId,
      before: { payoutAddress: change.oldAddress },
      after: { payoutAddress: change.newAddress, challengeId: change.challengeId, status: 'pending', requestedAt: change.requestedAt, coolsDownUntil: change.coolsDownUntil },
    });
    await v3NotificationDispatch.dispatch({
      eventType: 'payout_change_requested',
      targetUserId: provider.identity,
      payload: {
        providerId: input.providerId,
        oldAddress: change.oldAddress,
        newAddress: change.newAddress,
        changeId: change.changeId,
        challengeId: change.challengeId,
        requestedBy: input.requestedBy,
        requestedAt: change.requestedAt,
        coolsDownUntil: change.coolsDownUntil,
      },
    });
    return change;
  }

  /**
   * Cancel a pending payout address change during the cooling-off
   * window. Settlements during the window continue to the old
   * address.
   */
  async cancelPendingPayoutChange(input: CancelPayoutChangeInput): Promise<PendingPayoutChange> {
    const change = this.providers.cancelPendingPayoutChange(input);
    await auditProviderPayoutAddressChanged(input.requestedBy, {
      providerId: input.providerId,
      before: { payoutAddress: change.oldAddress, status: 'pending' },
      after: { payoutAddress: change.newAddress, status: 'cancelled', cancelledAt: new Date().toISOString() },
    });
    const provider = this.providers.readProvider(input.providerId);
    await v3NotificationDispatch.dispatch({
      eventType: 'payout_change_cancelled',
      targetUserId: provider.identity,
      payload: {
        providerId: input.providerId,
        oldAddress: change.oldAddress,
        newAddress: change.newAddress,
        changeId: change.changeId,
        cancelledAt: new Date().toISOString(),
      },
    });
    return change;
  }

  /**
   * Apply a pending payout address change after the cooling-off
   * window. New settlements after this point go to the new address.
   */
  async applyPendingPayoutChange(input: ApplyPayoutChangeInput): Promise<ProviderRegistration> {
    const change = this.providers.listPendingPayoutChanges(input.providerId).find(
      (c) => c.changeId === input.changeId && c.status === 'pending',
    );
    if (!change) {
      throw new Error('pending payout change not found');
    }
    const provider = this.providers.readProvider(input.providerId);
    const appliedProvider = this.providers.applyPendingPayoutChange(input);
    await auditProviderPayoutAddressChanged(input.providerId, {
      providerId: input.providerId,
      before: { payoutAddress: change.oldAddress },
      after: { payoutAddress: change.newAddress, status: 'applied', appliedAt: new Date().toISOString() },
    });
    await v3NotificationDispatch.dispatch({
      eventType: 'payout_change_applied',
      targetUserId: provider.identity,
      payload: {
        providerId: input.providerId,
        oldAddress: change.oldAddress,
        newAddress: change.newAddress,
        changeId: change.changeId,
        appliedAt: new Date().toISOString(),
      },
    });
    return appliedProvider;
  }

  /**
   * Return a pending payout change for a provider, or null if none
   * exists or it is no longer pending.
   */
  getPendingPayoutChange(providerId: string): PendingPayoutChange | null {
    return this.providers.getPendingPayoutChange(providerId);
  }

  /**
   * Return all pending payout changes for a provider.
   */
  listPendingPayoutChanges(providerId: string): PendingPayoutChange[] {
    return this.providers.listPendingPayoutChanges(providerId);
  }

  listRoutes(providerId: string): ProviderRouteView[] {
    this.getProviderOrThrow(providerId);
    return this.providers.listRoutes(providerId);
  }

  /**
   * Dry-run: resolve the route (and price) a request would match without
   * serving it (issue #1698). Returns null when nothing matches.
   */
  dryRunRoute(
    providerId: string,
    method: string,
    path: string,
  ): { route: RegisteredRoute; applicableVersion: RateCardVersion | null } | null {
    this.getProviderOrThrow(providerId);
    return this.providers.dryRunRoute(providerId, method, path);
  }

  listRateCards(providerId: string): RateCardVersion[] {
    this.getProviderOrThrow(providerId);
    return this.providers.listRateCards(providerId);
  }

  listSettlements(providerId: string): ProviderSettlement[] {
    this.getProviderOrThrow(providerId);
    return this.providers.listSettlements(providerId);
  }

  revenue(providerId: string): ProviderRevenue {
    this.getProviderOrThrow(providerId);
    return this.providers.revenue(providerId);
  }

  reviseRoute(
    providerId: string,
    routeId: string,
    patch: ReviseRouteInput,
  ): { route: RegisteredRoute; version: RateCardVersion } {
    const provider = this.getProviderOrThrow(providerId);
    if (!provider.payoutVerified) {
      throw new Error('payout address must be verified before route registration');
    }
    const result = this.providers.reviseRoute(providerId, routeId, patch);
    // The route may have gained a rate-limit override on revision (#1447).
    this.syncRateLimitForRoute(provider, result.route);
    return result;
  }

  createPayoutChallenge(providerId: string): { challenge: string } {
    const provider = this.getProviderOrThrow(providerId);
    const challenge = `syncro-payout:${provider.providerId}:${randomUUID()}`;
    provider.payoutChallenge = challenge;
    this.providers.saveProvider(provider);
    return { challenge };
  }

  verifyPayoutChallenge(providerId: string, signatureBase64: string): ProviderRegistration {
    const provider = this.getProviderOrThrow(providerId);
    if (!provider.payoutChallenge) {
      throw new Error('payout challenge not created');
    }

    const signature = Buffer.from(signatureBase64, 'base64');
    const verified = Keypair.fromPublicKey(provider.payoutAddress).verify(
      Buffer.from(provider.payoutChallenge),
      signature,
    );

    if (!verified) {
      throw new Error('invalid payout signature');
    }

    provider.payoutVerified = true;
    provider.payoutChallenge = null;
    this.providers.saveProvider(provider);
    return provider;
  }

  registerRoute(input: RegisterRouteInput): RegisteredRoute {
    const provider = this.getProviderOrThrow(input.providerId);
    if (!provider.payoutVerified) {
      throw new Error('payout address must be verified before route registration');
    }
    const route = this.providers.registerRoute(input);
    this.syncRateLimitForRoute(provider, route);
    return route;
  }

  deleteRoute(providerId: string, routeId: string): RegisteredRoute {
    this.getProviderOrThrow(providerId);
    return this.providers.deleteRoute(providerId, routeId);
  }

  async processPaidCall(input: PaidCallInput): Promise<{
    upstream: UpstreamResult;
    receipt: PaidReceipt;
    route: RegisteredRoute;
    inlineReceiptHeader: string | null;
    /** Metering reading at the time the call was settled. */
    meterReading: MeterReading;
    /** True when the meter is operating in degraded mode for this principal. */
    meterDegraded: boolean;
    /**
     * The counter-store outage decision for this call (#1444). Null when no
     * degraded-admission controller is wired; otherwise present on every call
     * so callers can tell a healthy serve from a fail-open one.
     */
    degradedAdmission: DegradedAdmissionDecision | null;
  }> {
    const provider = this.getProviderOrThrow(input.providerId);
    if (!provider.payoutVerified) {
      throw new PaidCallRequestError('provider payout address is not verified');
    }
    // Sandbox rule (#1699): staging is testnet-only (separate keys/data,
    // mainnet traffic refused); production requires the mainnet runtime.
    assertNetworkForMode(provider.mode, process.env.STELLAR_NETWORK);

    const route = this.providers.findRoute(input.providerId, input.method, input.path);
    if (!route) {
      throw new PaidCallRequestError('route not registered for provider');
    }

    await this.enforcer.assertAllowed({
      agentId: input.agentId,
      routeScope: route.scopeKey,
    });

    // -----------------------------------------------------------------------
    // 0. Rate limit — throttle the agent before it touches the upstream or
    //    spends anything (#1447). A denial here is a clean 429 with a
    //    Retry-After hint: the agent is told to back off, not that it ran out
    //    of funds. Throttled calls consume neither tokens nor the cap.
    // -----------------------------------------------------------------------
    const rateDecision = this.rateLimiter?.consume(input.agentId, route.routeId) ?? {
      allowed: true,
      retryAfterMs: 0,
    };
    if (!rateDecision.allowed) {
      throw new MeterRateLimitedError(route.scopeKey, rateDecision.retryAfterMs);
    }

    const admittedAt = new Date().toISOString();
    const rateCard = this.providers.applicableVersion(route.routeId, admittedAt);
    if (!rateCard) {
      throw new PaidCallRequestError('route has no applicable rate-card version');
    }
    const upperBoundUnits = rateCard.maxBillableUnits;
    const upperBoundStroops = calculateChargeStroops(rateCard.priceStroops, upperBoundUnits);

    // -----------------------------------------------------------------------
    // 1. Degraded admission — decide what happens if the counter store is
    //    down before we promise the caller anything (#1444).
    //
    //    The exposure at risk is the worst-case value of this call: if the
    //    store never counts it, `route price x upper bound` is what leaks.
    //    A refusal here is a clean 503 before the upstream is touched; an
    //    admission holds that much headroom against the provider's ceiling
    //    so concurrent calls cannot jointly overshoot it.
    // -----------------------------------------------------------------------
    const exposure = upperBoundStroops;
    const admission = this.degraded?.admit(provider.providerId, exposure) ?? null;
    if (admission && !admission.admitted) {
      throw new MeterDegradedError(
        admission.reason === 'fail_closed' ? 'fail_closed' : 'exposure_ceiling',
        provider.providerId,
      );
    }

    // -----------------------------------------------------------------------
    // 2. Reserve — hold upperBound quota before touching the upstream.
    //    This prevents two concurrent calls from racing through a shared quota.
    //    An overage here is "out of funds" (402), the mirror image of the
    //    "slow down" (429) raised above — the agent can tell the two apart.
    // -----------------------------------------------------------------------
    let reservation: MeterReservation;
    try {
      reservation = this.meter.reserve(
        input.agentId,
        route.scopeKey,
        upperBoundStroops,
      );
    } catch (err) {
      if (err instanceof OverageError) {
        throw new MeterInsufficientFundsError(
          route.scopeKey,
          err.available ?? 0,
          err.needed ?? upperBoundStroops,
          err.limit ?? 0,
        );
      }
      throw err;
    }

    let upstream: UpstreamResult;

    try {
      upstream = await this.upstream.call({
        upstreamBaseUrl: provider.upstreamBaseUrl,
        method: input.method,
        path: input.path,
        body: input.body,
      });
    } catch (err) {
      // -----------------------------------------------------------------------
      // 3a. Release — upstream failed; return the full hold.
      //     A failed call is not a free call in the product spec, but we do not
      //     charge for it either — we simply release the reservation and let
      //     the caller decide on retry policy.
      // -----------------------------------------------------------------------
      this.meter.release(reservation.id);
      // Nothing was served, so the unbilled headroom goes back to the pool.
      this.degraded?.rollback(admission?.holdId ?? null);
      // The provider's upstream is an external dependency we do not control:
      // surface it as a retryable 503 (#1617), not as a client error.
      throw new UpstreamUnavailableError();
    }

    // -----------------------------------------------------------------------
    // 2. Commit — settle against measured whole units; releases unused headroom.
    // -----------------------------------------------------------------------
    const measuredQuantity = extractMeasuredQuantity(rateCard.quantityExtractor, upstream.body);
    const actualUnits = roundBillableUnits(measuredQuantity);
    if (actualUnits > upperBoundUnits) {
      this.meter.commit(reservation.id, upperBoundStroops);
      throw new PaidCallRequestError('measured usage exceeded the route admission maximum');
    }
    const amount = calculateChargeStroops(rateCard.priceStroops, actualUnits);
    this.meter.commit(reservation.id, amount);

    const meteredAt = admittedAt;

    const receipt = await this.receipts.issueReceipt({
      receiptId: randomUUID(),
      route: route.scopeKey,
      unit: rateCard.unit,
      quantity: actualUnits,
      amount,
      rateCardVersion: rateCard.versionId,
      exchangeRate: input.exchangeRate ?? null,
      channelId: input.channelId,
      stateNonce: input.stateNonce,
      requestMethod: input.method,
      requestPath: input.path,
      requestQuery: input.query,
    });

    const settlement: RecordSettlementInput = {
      providerId: provider.providerId,
      routeId: route.routeId,
      receiptId: receipt.receiptId,
      method: route.method,
      pathPattern: route.pathPattern,
      unit: rateCard.unit,
      quantity: actualUnits,
      priceStroops: rateCard.priceStroops,
      amount,
      rateCardVersion: rateCard.versionId,
      rateCardEffectiveFrom: rateCard.effectiveFrom,
      status: 'unsettled',
      meteredAt,
      channelId: input.channelId,
    };
    this.providers.recordSettlement(settlement);

    // -----------------------------------------------------------------------
    // 3b. Settle the degraded hold — the call went out unbilled, so write it
    //     down before returning. The receipt id keys the record, which makes
    //     the write idempotent under replay and lets reconciliation match the
    //     log against receipts one-for-one. (#1444)
    // -----------------------------------------------------------------------
    if (admission?.holdId) {
      this.degraded?.settle(admission.holdId, {
        id: receipt.receiptId,
        providerId: provider.providerId,
        principal: input.agentId,
        route: route.scopeKey,
        reservationId: reservation.id,
        receiptId: receipt.receiptId,
        units: actualUnits,
        amount,
        meteredAt,
      });
    }

    // -----------------------------------------------------------------------
    // 4. Read — snapshot the meter state for the receipt and callers.
    // -----------------------------------------------------------------------
    const meterReading = this.meter.read(input.agentId);

    return {
      upstream,
      route,
      receipt,
      inlineReceiptHeader: this.receipts.headerFitsInline(receipt)
        ? this.receipts.encodeHeaderValue(receipt)
        : null,
      meterReading,
      meterDegraded: reservation.degraded || (admission?.degraded ?? false),
      degradedAdmission: admission,
    };
  }

  getReceipt(receiptId: string): Promise<PaidReceipt | null> {
    return this.receipts.getReceipt(receiptId);
  }

  isScopeError(error: unknown): error is ScopeRejectionError {
    return error instanceof ScopeRejectionError;
  }

  isMeterDegradedError(error: unknown): error is MeterDegradedError {
    return error instanceof MeterDegradedError;
  }

  isMeterRateLimitedError(error: unknown): error is MeterRateLimitedError {
    return error instanceof MeterRateLimitedError;
  }

  isMeterInsufficientFundsError(error: unknown): error is MeterInsufficientFundsError {
    return error instanceof MeterInsufficientFundsError;
  }

  private syncRateLimitForRoute(provider: ProviderRegistration, route: RegisteredRoute): void {
    // A route without its own override inherits the provider default (#1447).
    // Without this, a newly registered route would be unlimited until someone
    // touched it — "unlimited" is not a default we ship.
    this.rateLimiter?.setPolicy(
      route.routeId,
      route.rateLimit ?? provider.rateLimit,
    );
  }

  private getProviderOrThrow(providerId: string): ProviderRegistration {
    const provider = this.providers.getProvider(providerId);
    if (!provider) {
      throw new PaidCallRequestError('provider not found');
    }
    return provider;
  }
}
