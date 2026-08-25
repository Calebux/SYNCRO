import { supabase } from '../config/database';
import logger from '../config/logger';
import { RedisCacheAdapter } from './exchange-rate/redis-cache';
import type { Merchant, MerchantCreateInput, MerchantUpdateInput } from '../types/merchant';

/**
 * Default TTL for merchant metadata cached in Redis: 30 minutes.
 * Override via MERCHANT_CACHE_TTL_MS environment variable.
 */
const DEFAULT_MERCHANT_TTL_MS = 1_800_000;

function getMerchantTtlMs(): number {
  const env = process.env.MERCHANT_CACHE_TTL_MS;
  if (env) {
    const parsed = parseInt(env, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_MERCHANT_TTL_MS;
}

const CACHE_KEY_MERCHANT = (id: string) => `merchant:${id}`;
const CACHE_KEY_LIST = (category: string | undefined, limit: number, offset: number) =>
  `merchant:list:${category ?? '_all'}:${limit}:${offset}`;

interface MerchantListPayload {
  merchants: Merchant[];
  total: number;
}

export class MerchantService {
  private readonly cache: RedisCacheAdapter;

  /**
   * Set of cache keys currently being revalidated in the background (SWR).
   * Prevents duplicate concurrent background refreshes.
   */
  private revalidating = new Set<string>();

  constructor() {
    const ttlSeconds = Math.floor(getMerchantTtlMs() / 1000);
    this.cache = new RedisCacheAdapter(ttlSeconds);
  }

  // ── Write operations (always go to DB and invalidate cache) ─────────────────

  async createMerchant(input: MerchantCreateInput): Promise<Merchant> {
    const { data: merchant, error } = await supabase
      .from('merchants')
      .insert({
        name: input.name,
        logo_url: input.logo_url || null,
        category: input.category || null,
        cancellation_url: input.cancellation_url || null,
        gift_card_supported: input.gift_card_supported || false,
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create merchant:', error);
      throw new Error(`Failed to create merchant: ${error.message}`);
    }

    return merchant;
  }

  async updateMerchant(merchantId: string, input: MerchantUpdateInput): Promise<Merchant> {
    const updateData: Record<string, unknown> = {
      ...input,
      updated_at: new Date().toISOString(),
    };

    // Remove undefined fields
    Object.keys(updateData).forEach(
      (key) => updateData[key] === undefined && delete updateData[key],
    );

    const { data: merchant, error } = await supabase
      .from('merchants')
      .update(updateData)
      .eq('merchant_id', merchantId)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update merchant:', error);
      throw new Error(`Failed to update merchant: ${error.message}`);
    }

    if (!merchant) {
      throw new Error('Merchant not found');
    }

    // Invalidate the individual merchant cache entry (non-blocking)
    this.cache
      .set(CACHE_KEY_MERCHANT(merchantId), JSON.stringify(merchant))
      .catch(() => undefined);

    return merchant;
  }

  async deleteMerchant(merchantId: string): Promise<void> {
    const { error } = await supabase
      .from('merchants')
      .delete()
      .eq('merchant_id', merchantId);

    if (error) {
      logger.error('Failed to delete merchant:', error);
      throw new Error(`Failed to delete merchant: ${error.message}`);
    }
    // Cache entries for this merchant will expire naturally via TTL.
    // No active deletion is needed because reads always fall back to DB on miss.
  }

  // ── Read operations (cache-first with SWR) ──────────────────────────────────

  async getMerchant(merchantId: string): Promise<Merchant> {
    const cacheKey = CACHE_KEY_MERCHANT(merchantId);
    const cacheResult = await this.cache.getWithStatus(cacheKey);

    if (cacheResult.status === 'hit') {
      return JSON.parse(cacheResult.value) as Merchant;
    }

    if (cacheResult.status === 'stale') {
      // Serve stale data immediately; refresh in the background
      this.scheduleBackgroundRefreshMerchant(merchantId);
      return JSON.parse(cacheResult.value) as Merchant;
    }

    // Cache miss — fetch from DB
    return this.fetchAndCacheMerchant(merchantId);
  }

  async listMerchants(
    options: { limit?: number; offset?: number; category?: string } = {},
  ): Promise<{ merchants: Merchant[]; total: number }> {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const cacheKey = CACHE_KEY_LIST(options.category, limit, offset);
    const cacheResult = await this.cache.getWithStatus(cacheKey);

    if (cacheResult.status === 'hit') {
      return JSON.parse(cacheResult.value) as MerchantListPayload;
    }

    if (cacheResult.status === 'stale') {
      this.scheduleBackgroundRefreshList(options);
      return JSON.parse(cacheResult.value) as MerchantListPayload;
    }

    return this.fetchAndCacheList(options);
  }

  // ── Metrics ─────────────────────────────────────────────────────────────────

  /**
   * Returns the current Redis cache hit-rate for merchant lookups as a
   * fraction in [0, 1]. Returns NaN when no requests have been recorded.
   */
  getCacheHitRate(): number {
    return this.cache.getMetrics().hitRate;
  }

  /** Returns full cache metrics snapshot (hits, staleHits, misses, hitRate). */
  getCacheMetrics() {
    return this.cache.getMetrics();
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async fetchAndCacheMerchant(merchantId: string): Promise<Merchant> {
    const { data: merchant, error } = await supabase
      .from('merchants')
      .select('*')
      .eq('merchant_id', merchantId)
      .single();

    if (error) {
      logger.error('Failed to get merchant:', error);
      throw new Error(`Failed to get merchant: ${error.message}`);
    }

    if (!merchant) {
      throw new Error('Merchant not found');
    }

    // Populate cache (non-blocking)
    this.cache
      .set(CACHE_KEY_MERCHANT(merchantId), JSON.stringify(merchant))
      .catch(() => undefined);

    return merchant;
  }

  private async fetchAndCacheList(
    options: { limit?: number; offset?: number; category?: string },
  ): Promise<MerchantListPayload> {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    let query = supabase
      .from('merchants')
      .select('*', { count: 'exact' })
      .order('name', { ascending: true });

    if (options.category) {
      query = query.eq('category', options.category);
    }

    query = query.limit(limit);

    if (offset > 0) {
      query = query.range(offset, offset + limit - 1);
    }

    const { data: merchants, error, count } = await query;

    if (error) {
      logger.error('Failed to list merchants:', error);
      throw new Error(`Failed to list merchants: ${error.message}`);
    }

    const payload: MerchantListPayload = {
      merchants: merchants || [],
      total: count || 0,
    };

    const cacheKey = CACHE_KEY_LIST(options.category, limit, offset);
    this.cache.set(cacheKey, JSON.stringify(payload)).catch(() => undefined);

    return payload;
  }

  private scheduleBackgroundRefreshMerchant(merchantId: string): void {
    const cacheKey = CACHE_KEY_MERCHANT(merchantId);
    if (this.revalidating.has(cacheKey)) return;
    this.revalidating.add(cacheKey);

    this.fetchAndCacheMerchant(merchantId)
      .then(() => {
        logger.debug('SWR background revalidation succeeded for merchant', { merchantId });
      })
      .catch((err) => {
        logger.warn('SWR background revalidation failed for merchant', { merchantId, err });
      })
      .finally(() => {
        this.revalidating.delete(cacheKey);
      });
  }

  private scheduleBackgroundRefreshList(
    options: { limit?: number; offset?: number; category?: string },
  ): void {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const cacheKey = CACHE_KEY_LIST(options.category, limit, offset);
    if (this.revalidating.has(cacheKey)) return;
    this.revalidating.add(cacheKey);

    this.fetchAndCacheList(options)
      .then(() => {
        logger.debug('SWR background revalidation succeeded for merchant list', { options });
      })
      .catch((err) => {
        logger.warn('SWR background revalidation failed for merchant list', { options, err });
      })
      .finally(() => {
        this.revalidating.delete(cacheKey);
      });
  }
}

export const merchantService = new MerchantService();

/**
 * Normalize a merchant identifier for virtual-card allowlist/blocklist matching.
 * Lowercases and trims whitespace so on-chain String comparisons stay stable.
 */
export function normalizeMerchantId(merchantId: string): string {
  return merchantId.trim().toLowerCase();
}

/**
 * Returns true when `merchantId` may charge a card given optional allow/block lists.
 * Empty allowlist means all merchants are allowed except those on the blocklist.
 */
export function isMerchantPermittedForCard(
  merchantId: string,
  allowlist: string[] = [],
  blocklist: string[] = [],
): boolean {
  const normalized = normalizeMerchantId(merchantId);
  const blocked = blocklist.map(normalizeMerchantId);
  if (blocked.includes(normalized)) {
    return false;
  }
  if (allowlist.length === 0) {
    return true;
  }
  const allowed = allowlist.map(normalizeMerchantId);
  return allowed.includes(normalized);
}

/**
 * Validate merchant metadata exists and is permitted for a virtual card charge.
 */
export async function validateMerchantForVirtualCard(
  merchantId: string,
  allowlist: string[] = [],
  blocklist: string[] = [],
): Promise<Merchant> {
  const merchant = await merchantService.getMerchant(merchantId);
  if (!isMerchantPermittedForCard(merchantId, allowlist, blocklist)) {
    throw new Error(`Merchant "${merchantId}" is not permitted for this virtual card`);
  }
  return merchant;
}
