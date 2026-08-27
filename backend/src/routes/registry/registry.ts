import { Router, Express, raw } from 'express';
import logger from '../../config/logger';
import type { RouteDescriptor } from './types';
import { buildMiddlewareChain } from './middleware';

/**
 * Central registry that holds every route descriptor and mounts them
 * onto an Express application.  Validates at startup that every route
 * has an explicit auth policy.
 */
export class RouteRegistry {
  private descriptors: RouteDescriptor[] = [];
  private basePath: string;
  private mounted = false;

  constructor(basePath = '/api') {
    this.basePath = basePath;
  }

  /**
   * Register route descriptors.  Can be called multiple times.
   */
  register(...descriptors: RouteDescriptor[]): this {
    this.descriptors.push(...descriptors);
    return this;
  }

  /**
   * Validate all registered descriptors.  Throws on startup if any
   * route is missing an explicit auth policy.
   */
  validate(): void {
    const errors: string[] = [];

    for (let i = 0; i < this.descriptors.length; i++) {
      const d = this.descriptors[i];
      const label = `${d.method} ${this.basePath}${d.path}`;

      if (d.auth === undefined || d.auth === null) {
        errors.push(
          `${label}: auth policy is missing — every route must declare auth explicitly (public | user | admin)`,
        );
      }

      if (d.rateLimit && !['admin', 'login', 'mfa', 'team-invite', 'import', 'payment', 'refund', 'api-key', 'simulation', 'stealth-address', 'zk-proof', 'payment-channel-state-update', 'selective-disclosure', 'subscription-tier', null].includes(d.rateLimit)) {
        errors.push(`${label}: unknown rateLimit policy "${d.rateLimit}"`);
      }
    }

    // Check for duplicate routes
    const seen = new Map<string, string>();
    for (const d of this.descriptors) {
      const key = `${d.method} ${this.basePath}${d.path}`;
      if (seen.has(key)) {
        errors.push(`Duplicate route: ${key} (first: ${seen.get(key)})`);
      }
      seen.set(key, key);
    }

    if (errors.length > 0) {
      logger.error('Route registry validation failed:');
      for (const e of errors) {
        logger.error(`  ✗ ${e}`);
      }
      throw new Error(
        `Route registry validation failed with ${errors.length} error(s):\n${errors.join('\n')}`,
      );
    }

    logger.info(
      `Route registry validated: ${this.descriptors.length} descriptors`,
    );
  }

  /**
   * Mount all registered routes onto the Express app.
   * Call this after validate().
   */
  mount(app: Express): void {
    if (this.mounted) {
      throw new Error('Registry already mounted — call mount() only once');
    }

    this.validate();

    // Group descriptors by version for organized mounting
    const byVersion = new Map<string, RouteDescriptor[]>();
    for (const d of this.descriptors) {
      const list = byVersion.get(d.version) || [];
      list.push(d);
      byVersion.set(d.version, list);
    }

    // Mount versioned routers
    // For backwards compatibility, routes are mounted at {basePath}/{path}
    // (without version prefix). The version field is metadata for OpenAPI
    // and future use. When v2 routes are added, they'll be mounted at
    // {basePath}/v2/{path}.
    for (const [version, routes] of byVersion) {
      const versionRouter = Router();

      for (const descriptor of routes) {
        const chain = buildMiddlewareChain(descriptor);
        const fullPath = descriptor.path || '/';

        // For rawBody routes (webhooks), prepend express.raw() middleware
        // so the raw buffer is available before any JSON parsing.
        const preMiddleware = descriptor.rawBody
          ? [raw({ type: 'application/json' })]
          : [];

        switch (descriptor.method) {
          case 'ALL':
            versionRouter.use(fullPath, ...preMiddleware, ...chain);
            break;
          case 'GET':
            versionRouter.get(fullPath, ...preMiddleware, ...chain);
            break;
          case 'POST':
            versionRouter.post(fullPath, ...preMiddleware, ...chain);
            break;
          case 'PUT':
            versionRouter.put(fullPath, ...preMiddleware, ...chain);
            break;
          case 'PATCH':
            versionRouter.patch(fullPath, ...preMiddleware, ...chain);
            break;
          case 'DELETE':
            versionRouter.delete(fullPath, ...preMiddleware, ...chain);
            break;
        }
      }

      // Mount at basePath (for backwards compatibility, no version prefix)
      app.use(this.basePath, versionRouter);
      logger.info(`Mounted ${routes.length} routes at ${this.basePath} (version: ${version})`);
    }

    this.mounted = true;
  }

  /**
   * Get all registered descriptors (for OpenAPI generation, inventory, etc.)
   */
  getDescriptors(): ReadonlyArray<RouteDescriptor> {
    return this.descriptors;
  }

  /**
   * Get the base path prefix.
   */
  getBasePath(): string {
    return this.basePath;
  }

  /**
   * Get the full resolved path for a descriptor.
   * For backwards compatibility, this returns {basePath}/{path} without
   * the version prefix. The version is metadata for OpenAPI generation.
   */
  getFullPath(d: RouteDescriptor): string {
    return `${this.basePath}${d.path}`;
  }

  /**
   * Generate a plain-text route inventory.
   */
  generateInventory(): string {
    const lines: string[] = [];
    lines.push('SYNCRO API Route Inventory');
    lines.push('='.repeat(60));
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Total descriptors: ${this.descriptors.length}`);
    lines.push('');

    const byVersion = new Map<string, RouteDescriptor[]>();
    for (const d of this.descriptors) {
      const list = byVersion.get(d.version) || [];
      list.push(d);
      byVersion.set(d.version, list);
    }

    for (const [version, routes] of [...byVersion].sort()) {
      lines.push(`── ${version.toUpperCase()} ${'─'.repeat(55)}`);
      for (const d of routes) {
        const auth = d.auth.padEnd(6);
        const rateLimit = d.rateLimit ? ` [${d.rateLimit}]` : '';
        const method = d.method.padEnd(7);
        const full = `${method} ${this.getFullPath(d)}`;
        lines.push(`  ${auth} ${full}${rateLimit}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
