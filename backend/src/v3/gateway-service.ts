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
} from './provider-store';
import { ReceiptService } from './receipt-service';
import { AgentRegistryReader, ScopeEnforcer } from './scope-enforcer';
import {
  AgentRegistryGrant,
  MeterDegradedError,
  MeterInsufficientFundsError,
  MeterRateLimitedError,
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

  deleteRoute(providerId: string,

/* … truncated 9394 chars — edit only what you need near the top … */
