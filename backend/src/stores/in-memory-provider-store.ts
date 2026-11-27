import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface Provider {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface ProviderRoute {
  id: string;
  providerId: string;
  path: string;
  method: string;
  priceUsd: number;
  createdAt: string;
  updatedAt: string;
}

export interface RateCardVersion {
  id: string;
  providerId: string;
  version: number;
  rates: Record<string, number>;
  createdAt: string;
}

export interface PayoutAddress {
  id: string;
  providerId: string;
  address: string;
  chain: string;
  createdAt: string;
}

export interface ProviderStore {
  createProvider(input: Omit<Provider, 'id' | 'createdAt' | 'updatedAt'>): Promise<Provider>;
  getProvider(id: string): Promise<Provider | null>;
  listProviders(): Promise<Provider[]>;
  updateProvider(id: string, patch: Partial<Omit<Provider, 'id' | 'createdAt'>>): Promise<Provider | null>;
  deleteProvider(id: string): Promise<boolean>;

  createRoute(input: Omit<ProviderRoute, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProviderRoute>;
  listRoutes(providerId: string): Promise<ProviderRoute[]>;
  deleteRoute(id: string): Promise<boolean>;

  createRateCardVersion(input: Omit<RateCardVersion, 'id' | 'createdAt'>): Promise<RateCardVersion>;
  listRateCardVersions(providerId: string): Promise<RateCardVersion[]>;

  createPayoutAddress(input: Omit<PayoutAddress, 'id' | 'createdAt'>): Promise<PayoutAddress>;
  listPayoutAddresses(providerId: string): Promise<PayoutAddress[]>;
}

/**
 * In-memory implementation of {@link ProviderStore}.
 *
 * Retained for tests only. Production code must use the Postgres-backed
 * store so providers, routes, rate cards, and payout addresses survive
 * restarts and are shared across instances.
 */
export class InMemoryProviderStore implements ProviderStore {
  private providers = new Map<string, Provider>();
  private routes = new Map<string, ProviderRoute>();
  private rateCards = new Map<string, RateCardVersion>();
  private payouts = new Map<string, PayoutAddress>();

  async createProvider(input: Omit<Provider, 'id' | 'createdAt' | 'updatedAt'>): Promise<Provider> {
    const now = new Date().toISOString();
    const provider: Provider = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
    this.providers.set(provider.id, provider);
    return provider;
  }

  async getProvider(id: string): Promise<Provider | null> {
    return this.providers.get(id) ?? null;
  }

  async listProviders(): Promise<Provider[]> {
    return Array.from(this.providers.values());
  }

  async updateProvider(
    id: string,
    patch: Partial<Omit<Provider, 'id' | 'createdAt'>>,
  ): Promise<Provider | null> {
    const existing = this.providers.get(id);
    if (!existing) return null;
    const updated: Provider = { ...existing, ...patch, id, updatedAt: new Date().toISOString() };
    this.providers.set(id, updated);
    return updated;
  }

  async deleteProvider(id: string): Promise<boolean> {
    return this.providers.delete(id);
  }

  async createRoute(input: Omit<ProviderRoute, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProviderRoute> {
    const now = new Date().toISOString();
    const route: ProviderRoute = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
    this.routes.set(route.id, route);
    return route;
  }

  async listRoutes(providerId: string): Promise<ProviderRoute[]> {
    return Array.from(this.routes.values()).filter((r) => r.providerId === providerId);
  }

  async deleteRoute(id: string): Promise<boolean> {
    return this.routes.delete(id);
  }

  async createRateCardVersion(input: Omit<RateCardVersion, 'id' | 'createdAt'>): Promise<RateCardVersion> {
    const card: RateCardVersion = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.rateCards.set(card.id, card);
    return card;
  }

  async listRateCardVersions(providerId: string): Promise<RateCardVersion[]> {
    return Array.from(this.rateCards.values())
      .filter((c) => c.providerId === providerId)
      .sort((a, b) => b.version - a.version);
  }

  async createPayoutAddress(input: Omit<PayoutAddress, 'id' | 'createdAt'>): Promise<PayoutAddress> {
    const payout: PayoutAddress = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.payouts.set(payout.id, payout);
    return payout;
  }

  async listPayoutAddresses(providerId: string): Promise<PayoutAddress[]> {
    return Array.from(this.payouts.values()).filter((p) => p.providerId === providerId);
  }
}

/**
 * Postgres/Supabase-backed implementation of {@link ProviderStore}.
 *
 * Persists providers, provider routes, rate card versions, and payout
 * addresses so data survives restarts and is shared across instances.
 * Relies on the `providers`, `provider_routes`, `rate_card_versions`, and
 * `provider_payout_addresses` tables (see migrations) with RLS enabled.
 */
export class PostgresProviderStore implements ProviderStore {
  constructor(private readonly supabase: SupabaseClient) {}

  private get client(): SupabaseClient {
    return this.supabase;
  }

  async createProvider(input: Omit<Provider, 'id' | 'createdAt' | 'updatedAt'>): Promise<Provider> {
    const { data, error } = await this.client
      .from('providers')
      .insert({
        name: input.name,
        description: input.description ?? null,
        owner_id: input.ownerId,
        status: input.status,
      })
      .select()
      .single();
    if (error) throw new Error(`createProvider failed: ${error.message}`);
    return mapProvider(data);
  }

  async getProvider(id: string): Promise<Provider | null> {
    const { data, error } = await this.client.from('providers').select().eq('id', id).maybeSingle();
    if (error) throw new Error(`getProvider failed: ${error.message}`);
    return data ? mapProvider(data) : null;
  }

  async listProviders(): Promise<Provider[]> {
    const { data, error } = await this.client.from('providers').select().order('created_at', { ascending: true });
    if (error) throw new Error(`listProviders failed: ${error.message}`);
    return (data ?? []).map(mapProvider);
  }

  async updateProvider(
    id: string,
    patch: Partial<Omit<Provider, 'id' | 'createdAt'>>,
  ): Promise<Provider | null> {
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.description !== undefined) update.description = patch.description;
    if (patch.ownerId !== undefined) update.owner_id = patch.ownerId;
    if (patch.status !== undefined) update.status = patch.status;
    const { data, error } = await this.client
      .from('providers')
      .update(update)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw new Error(`updateProvider failed: ${error.message}`);
    return data ? mapProvider(data) : null;
  }

  async deleteProvider(id: string): Promise<boolean> {
    const { error, count } = await this.client
      .from('providers')
      .delete({ count: 'exact' })
      .eq('id', id);
    if (error) throw new Error(`deleteProvider failed: ${error.message}`);
    return (count ?? 0) > 0;
  }

  async createRoute(input: Omit<ProviderRoute, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProviderRoute> {
    const { data, error } = await this.client
      .from('provider_routes')
      .insert({
        provider_id: input.providerId,
        path: input.path,
        method: input.method,
        price_usd: input.priceUsd,
      })
      .select()
      .single();
    if (error) throw new Error(`createRoute failed: ${error.message}`);
    return mapRoute(data);
  }

  async listRoutes(providerId: string): Promise<ProviderRoute[]> {
    const { data, error } = await this.client
      .from('provider_routes')
      .select()
      .eq('provider_id', providerId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(`listRoutes failed: ${error.message}`);
    return (data ?? []).map(mapRoute);
  }

  async deleteRoute(id: string): Promise<boolean> {
    const { error, count } = await this.client
      .from('provider_routes')
      .delete({ count: 'exact' })
      .eq('id', id);
    if (error) throw new Error(`deleteRoute failed: ${error.message}`);
    return (count ?? 0) > 0;
  }

  async createRateCardVersion(input: Omit<RateCardVersion, 'id' | 'createdAt'>): Promise<RateCardVersion> {
    const { data, error } = await this.client
      .from('rate_card_versions')
      .insert({
        provider_id: input.providerId,
        version: input.version,
        rates: input.rates,
      })
      .select()
      .single();
    if (error) throw new Error(`createRateCardVersion failed: ${error.message}`);
    return mapRateCard(data);
  }

  async listRateCardVersions(providerId: string): Promise<RateCardVersion[]> {
    const { data, error } = await this.client
      .from('rate_card_versions')
      .select()
      .eq('provider_id', providerId)
      .order('version', { ascending: false });
    if (error) throw new Error(`listRateCardVersions failed: ${error.message}`);
    return (data ?? []).map(mapRateCard);
  }

  async createPayoutAddress(input: Omit<PayoutAddress, 'id' | 'createdAt'>): Promise<PayoutAddress> {
    const { data, error } = await this.client
      .from('provider_payout_addresses')
      .insert({
        provider_id: input.providerId,
        address: input.address,
        chain: input.chain,
      })
      .select()
      .single();
    if (error) throw new Error(`createPayoutAddress failed: ${error.message}`);
    return mapPayout(data);
  }

  async listPayoutAddresses(providerId: string): Promise<PayoutAddress[]> {
    const { data, error } = await this.client
      .from('provider_payout_addresses')
      .select()
      .eq('provider_id', providerId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(`listPayoutAddresses failed: ${error.message}`);
    return (data ?? []).map(mapPayout);
  }
}

function mapProvider(row: any): Provider {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    ownerId: row.owner_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRoute(row: any): ProviderRoute {
  return {
    id: row.id,
    providerId: row.provider_id,
    path: row.path,
    method: row.method,
    priceUsd: Number(row.price_usd),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

function mapPayout(row: any): PayoutAddress {
  return {
    id: row.id,
    providerId: row.provider_id,
    address: row.address,
    chain: row.chain,
    createdAt: row.created_at,
  };
}
