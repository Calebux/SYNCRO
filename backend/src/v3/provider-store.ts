import { randomUUID } from 'node:crypto';
import {
  ProviderMode,
  ProviderRegistration,
  ProviderRevenue,
  ProviderRouteView,
  ProviderSettlement,
  RateCardVersion,
  RegisteredRoute,
  SettlementStatus,
} from './types';

export interface RegisterProviderInput {
  identity: string;
  payoutAddress: string;
  upstreamBaseUrl: string;
  agreementTerms: string;
  mode: ProviderMode;
}

export interface RegisterRouteInput {
  providerId: string;
  pathPattern: string;
  method: string;
  unit: string;
  price: number;
  quantityExtractor: string;
}

export interface ReviseRouteInput {
  pathPattern?: string;
  method?: string;
  unit?: string;
  price?: number;
  quantityExtractor?: string;
}

export interface RecordSettlementInput {
  providerId: string;
  routeId: string;
  receiptId: string;
  method: string;
  pathPattern: string;
  unit: string;
  quantity: number;
  price: number;
  amount: number;
  rateCardVersion: string;
  rateCardEffectiveFrom: string;
  status: SettlementStatus;
  meteredAt: string;
  channelId: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeMethod(method: string): string {
  return method.trim().toUpperCase();
}

function buildScopeKey(method: string, pathPattern: string): string {
  return `${normalizeMethod(method)}:${pathPattern}`;
}

export class InMemoryProviderStore {
  private readonly providers = new Map<string, ProviderRegistration>();
  private readonly routes = new Map<string, RegisteredRoute>();
  private readonly rateCards = new Map<string, RateCardVersion>();
  private readonly settlements = new Map<string, ProviderSettlement>();

  registerProvider(input: RegisterProviderInput): ProviderRegistration {
    const providerId = randomUUID();
    const createdAt = nowIso();
    const record: ProviderRegistration = {
      providerId,
      identity: input.identity,
      payoutAddress: input.payoutAddress,
      upstreamBaseUrl: input.upstreamBaseUrl,
      agreementTerms: input.agreementTerms,
      mode: input.mode,
      payoutVerified: false,
      payoutChallenge: null,
      createdAt,
      updatedAt: createdAt,
    };
    this.providers.set(providerId, record);
    return record;
  }

  getProvider(providerId: string): ProviderRegistration | null {
    return this.providers.get(providerId) ?? null;
  }

  saveProvider(provider: ProviderRegistration): void {
    provider.updatedAt = nowIso();
    this.providers.set(provider.providerId, provider);
  }

  updatePayoutAddress(providerId: string, payoutAddress: string): ProviderRegistration {
    const provider = this.getProvider(providerId);
    if (!provider) {
      throw new Error('provider not found');
    }
    const nextAddress = payoutAddress.trim();
    if (!nextAddress) {
      throw new Error('payout address is required');
    }
    if (provider.payoutAddress === nextAddress) {
      return provider;
    }
    provider.payoutAddress = nextAddress;
    provider.payoutVerified = false;
    provider.payoutChallenge = null;
    this.saveProvider(provider);
    return provider;
  }

  registerRoute(input: RegisterRouteInput): RegisteredRoute {
    const routeId = randomUUID();
    const route: RegisteredRoute = {
      routeId,
      providerId: input.providerId,
      pathPattern: input.pathPattern,
      method: normalizeMethod(input.method),
      unit: input.unit,
      price: input.price,
      quantityExtractor: input.quantityExtractor,
      scopeKey: buildScopeKey(input.method, input.pathPattern),
      createdAt: nowIso(),
    };
    this.routes.set(routeId, route);
    this.appendVersion(route);
    return route;
  }

  listRoutes(providerId: string, atIso: string = nowIso()): ProviderRouteView[] {
    return [...this.routes.values()]
      .filter((route) => route.providerId === providerId)
      .map((route) => ({
        ...route,
        applicableVersion: this.applicableVersion(route.routeId, atIso),
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Publish a new rate-card version. The previous version is left unchanged,
   * so calls already metered keep the price that applied at that time.
   */
  reviseRoute(
    providerId: string,
    routeId: string,
    patch: ReviseRouteInput,
  ): { route: RegisteredRoute; version: RateCardVersion } {
    const existing = this.routes.get(routeId);
    if (!existing || existing.providerId !== providerId) {
      throw new Error('route not found');
    }

    const next: RegisteredRoute = {
      ...existing,
      pathPattern: patch.pathPattern?.trim() || existing.pathPattern,
      method: patch.method !== undefined ? normalizeMethod(patch.method) : existing.method,
      unit: patch.unit?.trim() || existing.unit,
      price: patch.price !== undefined ? patch.price : existing.price,
      quantityExtractor: patch.quantityExtractor?.trim() || existing.quantityExtractor,
    };
    next.scopeKey = buildScopeKey(next.method, next.pathPattern);

    if (!Number.isFinite(next.price) || next.price <= 0) {
      throw new Error('price must be greater than zero');
    }
    if (!next.pathPattern || !next.method || !next.unit || !next.quantityExtractor) {
      throw new Error('route fields must not be empty');
    }

    const unchanged =
      next.pathPattern === existing.pathPattern &&
      next.method === existing.method &&
      next.unit === existing.unit &&
      next.price === existing.price &&
      next.quantityExtractor === existing.quantityExtractor;
    if (unchanged) {
      throw new Error('no route changes');
    }

    this.routes.set(routeId, next);
    const version = this.appendVersion(next);
    return { route: { ...next }, version: { ...version } };
  }

  listRateCards(providerId: string): RateCardVersion[] {
    return [...this.rateCards.values()]
      .filter((version) => version.providerId === providerId)
      .map((version) => ({ ...version }))
      .sort((a, b) => a.routeId.localeCompare(b.routeId) || a.sequence - b.sequence);
  }

  /**
   * The version that prices a call metered at `atIso`: the latest version
   * whose effective time is already in the past. Later versions do not apply.
   */
  applicableVersion(routeId: string, atIso: string): RateCardVersion | null {
    const at = Date.parse(atIso);
    if (Number.isNaN(at)) return null;
    const match = this.versionsFor(routeId)
      .filter((version) => Date.parse(version.effectiveFrom) <= at)
      .sort((a, b) => a.sequence - b.sequence)
      .at(-1);
    return match ? { ...match } : null;
  }

  recordSettlement(input: RecordSettlementInput): ProviderSettlement {
    const settlement: ProviderSettlement = {
      settlementId: randomUUID(),
      providerId: input.providerId,
      routeId: input.routeId,
      receiptId: input.receiptId,
      method: input.method,
      pathPattern: input.pathPattern,
      unit: input.unit,
      quantity: input.quantity,
      price: input.price,
      amount: input.amount,
      rateCardVersion: input.rateCardVersion,
      rateCardEffectiveFrom: input.rateCardEffectiveFrom,
      status: input.status,
      meteredAt: input.meteredAt,
      channelId: input.channelId,
    };
    this.settlements.set(settlement.settlementId, settlement);
    return { ...settlement };
  }

  listSettlements(providerId: string): ProviderSettlement[] {
    return [...this.settlements.values()]
      .filter((settlement) => settlement.providerId === providerId)
      .map((settlement) => ({ ...settlement }))
      .sort((a, b) => b.meteredAt.localeCompare(a.meteredAt) || b.settlementId.localeCompare(a.settlementId));
  }

  revenue(providerId: string): ProviderRevenue {
    const rows = this.listSettlements(providerId);
    const sum = (status: SettlementStatus) =>
      rows.filter((row) => row.status === status).reduce((bucket, row) => bucket + row.amount, 0);
    return {
      settled: sum('settled'),
      unsettled: sum('unsettled'),
      inDispute: sum('in_dispute'),
    };
  }

  findRoute(providerId: string, method: string, requestPath: string): RegisteredRoute | null {
    const normalized = normalizeMethod(method);
    const routeList = [...this.routes.values()].filter((route) => route.providerId === providerId && route.method === normalized);
    for (const route of routeList) {
      if (pathMatchesPattern(requestPath, route.pathPattern)) {
        return route;
      }
    }
    return null;
  }

  private versionsFor(routeId: string): RateCardVersion[] {
    return [...this.rateCards.values()].filter((version) => version.routeId === routeId);
  }

  private appendVersion(route: RegisteredRoute): RateCardVersion {
    const existing = this.versionsFor(route.routeId);
    const sequence = existing.reduce((max, version) => Math.max(max, version.sequence), 0) + 1;
    const previous = existing.find((version) => version.sequence === sequence - 1);
    let effectiveFrom = nowIso();
    if (previous && Date.parse(effectiveFrom) <= Date.parse(previous.effectiveFrom)) {
      effectiveFrom = new Date(Date.parse(previous.effectiveFrom) + 1).toISOString();
    }
    const version: RateCardVersion = {
      versionId: randomUUID(),
      providerId: route.providerId,
      routeId: route.routeId,
      sequence,
      label: `v${sequence}`,
      price: route.price,
      unit: route.unit,
      quantityExtractor: route.quantityExtractor,
      pathPattern: route.pathPattern,
      method: route.method,
      effectiveFrom,
      createdAt: nowIso(),
    };
    this.rateCards.set(version.versionId, version);
    return version;
  }
}

function pathMatchesPattern(path: string, pattern: string): boolean {
  const regex = new RegExp(
    `^${pattern
      .replace(/[.+?^${}()|[\]\\*]/g, '\\$&')
      .replace(/\\\*/g, '.*')}$`,
  );
  return regex.test(path);
}

