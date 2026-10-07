import { randomUUID } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import type { DegradedAdmissionController, DegradedAdmissionDecision } from '../../../packages/metering/src/degraded-admission';
import {
  InMemoryProviderStore,
  RecordSettlementInput,
  RegisterProviderInput,
  RegisterRouteInput,
  ReviseRouteInput,
  UpdateDegradedModePolicyInput,
} from './provider-store';
import { ReceiptService } from './receipt-service';
import { AgentRegistryReader, ScopeEnforcer } from './scope-enforcer';
import {
  AgentRegistryGrant,
  MeterDegradedError,
  PaidReceipt,
  ProviderRegistration,
  ProviderRevenue,
  ProviderRouteView,
  ProviderSettlement,
  RateCardVersion,
  RegisteredRoute,
  ScopeRejectionError,
} from './types';
import type { Meter, MeterReservation, MeterReading } from '../../../packages/metering/src/meter';

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
  quantity?: number;
  exchangeRate?: number | null;
  channelId: string;
  stateNonce: number;
  rateCardVersion: string;
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

  readProvider(providerId: string): ProviderRegistration {
    return this.getProviderOrThrow(providerId);
  }

  updatePayoutAddress(providerId: string, payoutAddress: string): ProviderRegistration {
    this.getProviderOrThrow(providerId);
    return this.providers.updatePayoutAddress(providerId, payoutAddress);
  }

  listRoutes(providerId: string): ProviderRouteView[] {
    this.getProviderOrThrow(providerId);
    return this.providers.listRoutes(providerId);
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
    return this.providers.reviseRoute(providerId, routeId, patch);
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
    return this.providers.registerRoute(input);
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
      throw new Error('provider payout address is not verified');
    }
    if (provider.mode === 'production' && process.env.STELLAR_NETWORK !== 'mainnet') {
      throw new Error('production providers require mainnet runtime');
    }

    const route = this.providers.findRoute(input.providerId, input.method, input.path);
    if (!route) {
      throw new Error('route not registered for provider');
    }

    await this.enforcer.assertAllowed({
      agentId: input.agentId,
      routeScope: route.scopeKey,
    });

    const quantity = input.quantity ?? 1;
    // upperBound: reserve for the worst-case quantity (may exceed actual).
    const upperBound = quantity;

    // -----------------------------------------------------------------------
    // 0. Degraded admission — decide what happens if the counter store is
    //    down before we promise the caller anything (#1444).
    //
    //    The exposure at risk is the worst-case value of this call: if the
    //    store never counts it, `route price x upper bound` is what leaks.
    //    A refusal here is a clean 503 before the upstream is touched; an
    //    admission holds that much headroom against the provider's ceiling
    //    so concurrent calls cannot jointly overshoot it.
    // -----------------------------------------------------------------------
    const exposure = route.price * upperBound;
    const admission = this.degraded?.admit(provider.providerId, exposure) ?? null;
    if (admission && !admission.admitted) {
      throw new MeterDegradedError(
        admission.reason === 'fail_closed' ? 'fail_closed' : 'exposure_ceiling',
        provider.providerId,
      );
    }

    // -----------------------------------------------------------------------
    // 1. Reserve — hold upperBound quota before touching the upstream.
    //    This prevents two concurrent calls from racing through a shared quota.
    // -----------------------------------------------------------------------
    const reservation: MeterReservation = this.meter.reserve(
      input.agentId,
      route.scopeKey,
      upperBound,
    );

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
      throw err;
    }

    // -----------------------------------------------------------------------
    // 2. Commit — settle against actual usage; releases unused headroom.
    // -----------------------------------------------------------------------
    const { charged } = this.meter.commit(reservation.id, quantity);

    const meteredAt = new Date().toISOString();
    const applicable = this.providers.applicableVersion(route.routeId, meteredAt);
    const amount = route.price * charged;

    const receipt = this.receipts.issueReceipt({
      receiptId: randomUUID(),
      route: route.scopeKey,
      unit: route.unit,
      quantity: charged,
      amount,
      rateCardVersion: input.rateCardVersion,
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
      unit: route.unit,
      quantity: charged,
      price: applicable?.price ?? route.price,
      amount,
      rateCardVersion: applicable?.label ?? input.rateCardVersion,
      rateCardEffectiveFrom: applicable?.effectiveFrom ?? meteredAt,
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
        units: charged,
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

  getReceipt(receiptId: string): PaidReceipt | null {
    return this.receipts.getReceipt(receiptId);
  }

  isScopeError(error: unknown): error is ScopeRejectionError {
    return error instanceof ScopeRejectionError;
  }

  isMeterDegradedError(error: unknown): error is MeterDegradedError {
    return error instanceof MeterDegradedError;
  }

  private getProviderOrThrow(providerId: string): ProviderRegistration {
    const provider = this.providers.getProvider(providerId);
    if (!provider) {
      throw new Error('provider not found');
    }
    return provider;
  }
}
