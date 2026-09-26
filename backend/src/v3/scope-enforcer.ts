import { AgentRegistryGrant, ScopeCheckRequest, ScopeRejectionError } from './types';

interface CacheEntry {
  grant: AgentRegistryGrant;
  cachedAtMs: number;
  hardExpiryMs: number;
  softExpiryMs: number;
}

export interface AgentRegistryReader {
  getGrant(agentId: string): Promise<AgentRegistryGrant>;
}

export interface ScopeEnforcerOptions {
  cacheTtlMs?: number;
  cacheSoftTtlMs?: number;
}

export class ScopeEnforcer {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;
  private readonly cacheSoftTtlMs: number;

  constructor(
    private readonly reader: AgentRegistryReader,
    options: ScopeEnforcerOptions = {},
  ) {
    this.cacheTtlMs = options.cacheTtlMs ?? 5_000;
    this.cacheSoftTtlMs = options.cacheSoftTtlMs ?? 2_500;
  }

  /** Drop a cached grant so a replacement is visible on the next call. */
  invalidate(agentId: string): void {
    this.cache.delete(agentId);
  }

  async assertAllowed(request: ScopeCheckRequest): Promise<void> {
    const nowMs = Date.now();
    const cached = this.cache.get(request.agentId);

    if (cached && nowMs < cached.softExpiryMs) {
      this.validateGrant(cached.grant, request.routeScope);
      return;
    }

    try {
      const fresh = await this.reader.getGrant(request.agentId);
      this.cache.set(request.agentId, {
        grant: fresh,
        cachedAtMs: nowMs,
        softExpiryMs: nowMs + this.cacheSoftTtlMs,
        hardExpiryMs: nowMs + this.cacheTtlMs,
      });
      this.validateGrant(fresh, request.routeScope);
      return;
    } catch (error) {
      if (error instanceof ScopeRejectionError) {
        throw error;
      }
      // If refresh fails, fail closed even if a stale cache entry exists.
      if (!cached || nowMs >= cached.hardExpiryMs) {
        throw new ScopeRejectionError(
          'registry_unavailable',
          'agent registry unavailable; refusing paid request',
        );
      }

      throw new ScopeRejectionError(
        'registry_unavailable',
        'agent registry refresh failed while scope cache stale; refusing paid request',
      );
    }
  }

  private validateGrant(grant: AgentRegistryGrant, routeScope: string): void {
    const now = Date.now();
    if (grant.revokedAt && Date.parse(grant.revokedAt) <= now) {
      throw new ScopeRejectionError('grant_revoked', 'agent grant revoked');
    }
    if (grant.expiresAt && Date.parse(grant.expiresAt) <= now) {
      throw new ScopeRejectionError('grant_expired', 'agent grant expired');
    }
    if (!grant.scopes.includes(routeScope)) {
      throw new ScopeRejectionError(
        'missing_scope',
        `agent missing scope ${routeScope}`,
      );
    }
  }
}

