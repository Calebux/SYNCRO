import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface Provider {
  id: string;
  name: string;
  ownerId: string;
  payoutAddress: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderRoute {
  id: string;
  providerId: string;
  model: string;
  upstreamUrl: string;
  createdAt: string;
}

export interface RateCardVersion {
  id: string;
  providerId: string;
  version: number;
  rates: Record<string, number>;
  createdAt: string;
}

export interface CreateProviderInput {
  name: string;
  ownerId: string;
  payoutAddress?: string | null;
}

export interface CreateProviderRouteInput {
  providerId: string;
  model: string;
  upstreamUrl: string;
}

export interface CreateRateCardVersionInput {
  providerId: string;
  rates: Record<string, number>;
}

export interface ProviderStore {
  createProvider(input: CreateProviderInput): Promise<Provider>;
  getProvider(id: string): Promise<Provider | null>;
  listProviders(): Promise<Provider[]>;
  updatePayoutAddress(id: string, payoutAddress: string | null): Promise<Provider | null>;
  createRoute(input: CreateProviderRouteInput): Promise<ProviderRoute>;
  listRoutes(providerId: string): Promise<ProviderRoute[]>;
  createRateCardVersion(input: CreateRateCardVersionInput): Promise<RateCardVersion>;
  listRateCardVersions(providerId: string): Promise<RateCardVersion[]>;
}

const PROVIDERS_TABLE = 'v3_providers';
const ROUTES_TABLE = 'v3_provider_routes';
const RATE_CARDS_TABLE = 'v3_rate_card_versions';

function nowIso(): string {
  return new Date().toISOString();
}

function mapProvider(row: any): Provider {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    payoutAddress: row.payout_address ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRoute(row: any): ProviderRoute {
  return {
    id: row.id,
    providerId: row.provider_id,
    model: row.model,
    upstreamUrl: row.upstream_url,
    createdAt: row.created_at,
  };
}

function mapRateCard(row: any): RateCardVersion {
  return {
    id: row.id,
    providerId: row.provider_id,
    version: row.version,
    rates: row.rates ?? {},
    createdAt: row.created_at,
  };
}

/**
 * Postgres/Supabase-backed provider store. Providers, routes, rate cards, and
 * payout addresses persist across restarts and are shared between instances.
 */
export class PostgresProviderStore implements ProviderStore {
  constructor(private readonly supabase: SupabaseClient) {}

  async createProvider(input: CreateProviderInput): Promise<Provider> {
    const timestamp = nowIso();
    const { data, error } = await this.supabase
      .from(PROVIDERS_TABLE)
      .insert({
        id: randomUUID(),
        name: input.name,
        owner_id: input.ownerId,
        payout_address: input.payoutAddress ?? null,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .select()
      .single();
    if (error) throw error;
    return mapProvider(data);
  }

  async getProvider(id: string): Promise<Provider | null> {
    const { data, error } = await this.supabase
      .from(PROVIDERS_TABLE)
      .select()
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? mapProvider(data) : null;
  }

  async listProviders(): Promise<Provider[]> {
    const { data, error } = await this.supabase
      .from(PROVIDERS_TABLE)
      .select()
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapProvider);
  }

  async updatePayoutAddress(id: string, payoutAddress: string | null): Promise<Provider | null> {
    const { data, error } = await this.supabase
      .from(PROVIDERS_TABLE)
      .update({ payout_address: payoutAddress, updated_at: nowIso() })
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data ? mapProvider(data) : null;
  }

  async createRoute(input: CreateProviderRouteInput): Promise<ProviderRoute> {
    const { data, error } = await this.supabase
      .from(ROUTES_TABLE)
      .insert({
        id: randomUUID(),
        provider_id: input.providerId,
        model: input.model,
        upstream_url: input.upstreamUrl,
        created_at: nowIso(),
      })
      .select()
      .single();
    if (error) throw error;
    return mapRoute(data);
  }

  async listRoutes(providerId: string): Promise<ProviderRoute[]> {
    const { data, error } = await this.supabase
      .from(ROUTES_TABLE)
      .select()
      .eq('provider_id', providerId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapRoute);
  }

  async createRateCardVersion(input: CreateRateCardVersionInput): Promise<RateCardVersion> {
    const { data: latest, error: latestError } = await this.supabase
      .from(RATE_CARDS_TABLE)
      .select('version')
      .eq('provider_id', input.providerId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throw latestError;
    const nextVersion = (latest?.version ?? 0) + 1;

    const { data, error } = await this.supabase
      .from(RATE_CARDS_TABLE)
      .insert({
        id: randomUUID(),
        provider_id: input.providerId,
        version: nextVersion,
        rates: input.rates,
        created_at: nowIso(),
      })
      .select()
      .single();
    if (error) throw error;
    return mapRateCard(data);
  }

  async listRateCardVersions(providerId: string): Promise<RateCardVersion[]> {
    const { data, error } = await this.supabase
      .from(RATE_CARDS_TABLE)
      .select()
      .eq('provider_id', providerId)
      .order('version', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapRateCard);
  }
}

/**
 * In-memory provider store. Retained for tests only; production code should
 * use {@link PostgresProviderStore}.
 */
export class InMemoryProviderStore implements ProviderStore {
  private providers = new Map<string, Provider>();
  private routes = new Map<string, ProviderRoute[]>();
  private rateCards = new Map<string, RateCardVersion[]>();

  async createProvider(input: CreateProviderInput): Promise<Provider> {
    const timestamp = nowIso();
    const provider: Provider = {
      id: randomUUID(),
      name: input.name,
      ownerId: input.ownerId,
      payoutAddress: input.payoutAddress ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.providers.set(provider.id, provider);
    return provider;
  }

  async getProvider(id: string): Promise<Provider | null> {
    return this.providers.get(id) ?? null;
  }

  async listProviders(): Promise<Provider[]> {
    return Array.from(this.providers.values());
  }

  async updatePayoutAddress(id: string, payoutAddress: string | null): Promise<Provider | null> {
    const existing = this.providers.get(id);
    if (!existing) return null;
    const updated: Provider = { ...existing, payoutAddress, updatedAt: nowIso() };
    this.providers.set(id, updated);
    return updated;
  }

  async createRoute(input: CreateProviderRouteInput): Promise<ProviderRoute> {
    const route: ProviderRoute = {
      id: randomUUID(),
      providerId: input.providerId,
      model: input.model,
      upstreamUrl: input.upstreamUrl,
      createdAt: nowIso(),
    };
    const list = this.routes.get(input.providerId) ?? [];
    list.push(route);
    this.routes.set(input.providerId, list);
    return route;
  }

  async listRoutes(providerId: string): Promise<ProviderRoute[]> {
    return [...(this.routes.get(providerId) ?? [])];
  }

  async createRateCardVersion(input: CreateRateCardVersionInput): Promise<RateCardVersion> {
    const list = this.rateCards.get(input.providerId) ?? [];
    const nextVersion = list.reduce((max, card) => Math.max(max, card.version), 0) + 1;
    const card: RateCardVersion = {
      id: randomUUID(),
      providerId: input.providerId,
      version: nextVersion,
      rates: input.rates,
      createdAt: nowIso(),
    };
    list.push(card);
    this.rateCards.set(input.providerId, list);
    return card;
  }

  async listRateCardVersions(providerId: string): Promise<RateCardVersion[]> {
    return [...(this.rateCards.get(providerId) ?? [])].sort((a, b) => b.version - a.version);
  }
}
