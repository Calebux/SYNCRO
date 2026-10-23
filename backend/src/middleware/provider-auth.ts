import { Request, Response, NextFunction } from 'express';
import { InMemoryProviderStore } from '../v3/provider-store';
import logger from '../config/logger';

/** Extended request with provider identity attached by this middleware. */
export interface ProviderAuthenticatedRequest extends Request {
  provider?: {
    providerId: string;
    identity: string;
  };
}

/**
 * Provider authentication middleware.
 *
 * Validates the `x-provider-key` header against the provider store.
 * When valid, attaches the provider identity to `req.provider` so that
 * downstream authorization middleware can verify the provider owns the
 * `:providerId` resource in the route.
 *
 * Returns 401 when no key is present or the key is not recognised.
 */
export function authenticateProvider(
  providerStore: InMemoryProviderStore,
) {
  return (req: ProviderAuthenticatedRequest, res: Response, next: NextFunction): void => {
    const key = req.headers['x-provider-key'];
    if (!key || typeof key !== 'string') {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Provider key required',
      });
      return;
    }

    const provider = providerStore.getProviderBySecret(key);
    if (!provider) {
      logger.warn('Provider auth failed: unknown key', { ip: req.ip });
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid provider key',
      });
      return;
    }

    req.provider = {
      providerId: provider.providerId,
      identity: provider.identity,
    };
    next();
  };
}
