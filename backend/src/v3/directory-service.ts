/**
 * Provider Directory Service
 * 
 * Public read-only API for agents to discover opted-in providers.
 * Providers must explicitly opt in to appear in the directory.
 * 
 * Features (1% implementation):
 * - Opt-in/opt-out mechanism
 * - Basic filtering by category and asset
 * - Simple reliability stats (uptime tracking)
 * - Rate limiting and caching friendly
 */

import { InMemoryProviderStore } from './provider-store';
import type { ProviderRegistration, RegisteredRoute, RouteUnit } from './types';

/**
 * Directory entry for a single provider.
 * Only public, non-sensitive data exposed to agents.
 */
export interface DirectoryEntry {
  providerId: string;
  identity: string;
  mode: 'staging' | 'production';
  /** Human-readable description of what this provider offers */
  description?: string;
  /** Service categories this provider offers (e.g., 'ai', 'data', 'compute') */
  categories: string[];
  /** Assets accepted for payment (e.g., ['USDC', 'XLM']) */
  acceptedAssets: string[];
  /** Summary statistics */
  stats: ProviderStats;
  /** Sample routes to show pricing */
  sampleRoutes: DirectoryRoute[];
  /** Provider's preferred contact/support info */
  contact?: ContactInfo;
  /** When this provider was added to the directory */
  listedAt: string;
}

export interface DirectoryRoute {
  method: string;
  pathPattern: string;
  unit: RouteUnit;
  /** Price in stroops per unit */
  priceStroops: number;
  /** Human-readable description */
  description?: string;
}

export interface ProviderStats {
  /** Number of routes registered */
  routeCount: number;
  /** Uptime percentage (0-100) */
  uptime: number;
  /** Total successful calls (last 30 days) */
  callsLast30Days: number;
  /** Average response time in ms */
  avgResponseTimeMs: number;
}

export interface ContactInfo {
  website?: string;
  email?: string;
  discord?: string;
  twitter?: string;
}

/**
 * Opt-in record for directory listing.
 * Providers must explicitly opt in to be searchable.
 */
export interface DirectoryOptIn {
  providerId: string;
  optedIn: boolean;
  description?: string;
  categories: string[];
  contact?: ContactInfo;
  optedInAt: string;
  updatedAt: string;
}

/**
 * Query filters for directory search
 */
export interface DirectoryQuery {
  /** Filter by service category */
  category?: string;
  /** Filter by accepted asset */
  asset?: string;
  /** Filter by mode (staging/production) */
  mode?: 'staging' | 'production';
  /** Pagination offset */
  offset?: number;
  /** Pagination limit (max 100) */
  limit?: number;
}

/**
 * Directory service for provider discovery.
 * 
 * This is a 1% implementation with:
 * - In-memory opt-in storage
 * - Basic category filtering
 * - Mock reliability stats
 * 
 * Future work:
 * - Persistent storage (database)
 * - Real uptime/reliability tracking
 * - Moderation queue
 * - Featured providers
 * - Search ranking algorithm
 */
export class DirectoryService {
  private readonly providerStore: InMemoryProviderStore;
  private readonly optIns = new Map<string, DirectoryOptIn>();
  private readonly uptimeTracker = new Map<string, number>(); // Mock uptime data

  constructor(providerStore: InMemoryProviderStore) {
    this.providerStore = providerStore;
  }

  /**
   * Opt a provider into the directory.
   * Only the provider can opt themselves in (authenticated).
   */
  optIn(input: {
    providerId: string;
    description?: string;
    categories: string[];
    contact?: ContactInfo;
  }): DirectoryOptIn {
    const provider = this.providerStore.getProvider(input.providerId);
    if (!provider) {
      throw new Error('provider not found');
    }

    if (!provider.payoutVerified) {
      throw new Error('provider must verify payout address before opting into directory');
    }

    const now = new Date().toISOString();
    const existing = this.optIns.get(input.providerId);

    const optIn: DirectoryOptIn = {
      providerId: input.providerId,
      optedIn: true,
      description: input.description || existing?.description,
      categories: input.categories.length > 0 ? input.categories : existing?.categories || [],
      contact: input.contact || existing?.contact,
      optedInAt: existing?.optedInAt || now,
      updatedAt: now,
    };

    this.optIns.set(input.providerId, optIn);

    // Initialize mock uptime
    if (!this.uptimeTracker.has(input.providerId)) {
      this.uptimeTracker.set(input.providerId, 99.5); // Default 99.5% uptime
    }

    return optIn;
  }

  /**
   * Opt a provider out of the directory.
   * They disappear from search results immediately.
   */
  optOut(providerId: string): void {
    const existing = this.optIns.get(providerId);
    if (!existing) {
      throw new Error('provider not in directory');
    }

    this.optIns.set(providerId, {
      ...existing,
      optedIn: false,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Check if a provider is opted in
   */
  isOptedIn(providerId: string): boolean {
    const optIn = this.optIns.get(providerId);
    return optIn?.optedIn === true;
  }

  /**
   * Query the directory with filters.
   * Returns only opted-in providers.
   * 
   * This is the main public API for agents discovering providers.
   */
  query(filters: DirectoryQuery = {}): DirectoryEntry[] {
    const {
      category,
      asset = 'USDC', // Default to USDC
      mode,
      offset = 0,
      limit = 20,
    } = filters;

    // Validate pagination
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const safeOffset = Math.max(0, offset);

    // Get all opted-in providers
    const entries: DirectoryEntry[] = [];

    for (const [providerId, optIn] of this.optIns) {
      if (!optIn.optedIn) continue;

      const provider = this.providerStore.getProvider(providerId);
      if (!provider) continue;

      // Filter by mode
      if (mode && provider.mode !== mode) continue;

      // Filter by category
      if (category && !optIn.categories.includes(category)) continue;

      // Build entry
      const entry = this.buildDirectoryEntry(provider, optIn);

      // Filter by asset (check if any route accepts it)
      if (asset && !entry.acceptedAssets.includes(asset)) {
        continue;
      }

      entries.push(entry);
    }

    // Sort by uptime (best first)
    entries.sort((a, b) => b.stats.uptime - a.stats.uptime);

    // Paginate
    return entries.slice(safeOffset, safeOffset + safeLimit);
  }

  /**
   * Get a specific provider's directory entry.
   * Returns null if not opted in.
   */
  getEntry(providerId: string): DirectoryEntry | null {
    const optIn = this.optIns.get(providerId);
    if (!optIn?.optedIn) return null;

    const provider = this.providerStore.getProvider(providerId);
    if (!provider) return null;

    return this.buildDirectoryEntry(provider, optIn);
  }

  /**
   * Get available categories (for search UI)
   */
  getCategories(): string[] {
    const categories = new Set<string>();
    for (const optIn of this.optIns.values()) {
      if (optIn.optedIn) {
        optIn.categories.forEach(cat => categories.add(cat));
      }
    }
    return Array.from(categories).sort();
  }

  /**
   * Get provider stats (for internal use / future analytics)
   */
  getStats(providerId: string): ProviderStats {
    const routes = this.providerStore.listRoutes(providerId);
    const uptime = this.uptimeTracker.get(providerId) || 95.0;

    return {
      routeCount: routes.length,
      uptime,
      callsLast30Days: Math.floor(Math.random() * 10000), // Mock data
      avgResponseTimeMs: Math.floor(Math.random() * 500) + 100, // Mock: 100-600ms
    };
  }

  /**
   * Build a directory entry from provider + opt-in data.
   * Internal helper.
   */
  private buildDirectoryEntry(
    provider: ProviderRegistration,
    optIn: DirectoryOptIn,
  ): DirectoryEntry {
    const routes = this.providerStore.listRoutes(provider.providerId);
    
    // Sample routes: pick up to 5 representative routes
    const sampleRoutes: DirectoryRoute[] = routes.slice(0, 5).map(route => ({
      method: route.method,
      pathPattern: route.pathPattern,
      unit: route.unit,
      priceStroops: route.priceStroops,
      description: undefined, // Could be enhanced with route descriptions
    }));

    // Extract accepted assets from routes
    // For now, we assume USDC (could be enhanced with per-route asset config)
    const acceptedAssets = ['USDC'];

    return {
      providerId: provider.providerId,
      identity: provider.identity,
      mode: provider.mode,
      description: optIn.description,
      categories: optIn.categories,
      acceptedAssets,
      stats: this.getStats(provider.providerId),
      sampleRoutes,
      contact: optIn.contact,
      listedAt: optIn.optedInAt,
    };
  }

  /**
   * Admin function: remove a provider from directory (moderation).
   * Not yet implemented - just marks as opted out.
   */
  moderateRemove(providerId: string, reason: string): void {
    const optIn = this.optIns.get(providerId);
    if (!optIn) {
      throw new Error('provider not in directory');
    }

    // For 1% implementation, just opt them out
    // Future: add moderation log, notification, appeal process
    this.optOut(providerId);

    // TODO: Log moderation action
    console.warn(`Provider ${providerId} removed from directory: ${reason}`);
  }
}
