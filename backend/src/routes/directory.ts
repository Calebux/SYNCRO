/**
 * Provider Directory API Routes
 * 
 * Public read-only endpoints for provider discovery.
 * Providers opt in explicitly to appear in search results.
 */

import express, { Request, Response, Router } from 'express';
import { z } from 'zod';
import { DirectoryService, type DirectoryQuery } from '../v3/directory-service';
import { authenticateProvider, type ProviderAuthenticatedRequest } from '../middleware/provider-auth';
import logger from '../config/logger';

export function createDirectoryRouter(directory: DirectoryService, requireProviderAuth: express.RequestHandler): Router {
  const router = Router();

  // ── Schemas ──────────────────────────────────────────────────────────────────

  const optInSchema = z.object({
    description: z.string().max(500).optional(),
    categories: z.array(z.string().max(50)).max(10),
    contact: z.object({
      website: z.string().url().optional(),
      email: z.string().email().optional(),
      discord: z.string().max(100).optional(),
      twitter: z.string().max(100).optional(),
    }).optional(),
  });

  const querySchema = z.object({
    category: z.string().max(50).optional(),
    asset: z.string().max(10).optional(),
    mode: z.enum(['staging', 'production']).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  });

  // ── Public Endpoints (Read-only) ─────────────────────────────────────────────

  /**
   * GET /api/v3/directory
   * 
   * Query the provider directory.
   * Returns only opted-in providers matching the filters.
   * 
   * Query params:
   * - category: Filter by service category
   * - asset: Filter by accepted asset (default: USDC)
   * - mode: Filter by staging or production
   * - offset: Pagination offset (default: 0)
   * - limit: Results per page (default: 20, max: 100)
   */
  router.get('/', (req: Request, res: Response) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    try {
      const filters: DirectoryQuery = parsed.data;
      const entries = directory.query(filters);

      return res.json({
        data: entries,
        pagination: {
          offset: filters.offset || 0,
          limit: filters.limit || 20,
          total: entries.length,
        },
      });
    } catch (error) {
      logger.error('Directory query failed', { error });
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/v3/directory/categories
   * 
   * Get list of available categories.
   * Useful for building search UIs.
   */
  router.get('/categories', (_req: Request, res: Response) => {
    try {
      const categories = directory.getCategories();
      return res.json({ data: categories });
    } catch (error) {
      logger.error('Failed to fetch categories', { error });
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/v3/directory/:providerId
   * 
   * Get a specific provider's directory entry.
   * Returns 404 if not opted in.
   */
  router.get('/:providerId', (req: Request, res: Response) => {
    try {
      const providerId = req.params.providerId;
      if (!providerId) {
        return res.status(400).json({ error: 'providerId required' });
      }

      const entry = directory.getEntry(providerId);
      if (!entry) {
        return res.status(404).json({ error: 'Provider not found in directory' });
      }

      return res.json({ data: entry });
    } catch (error) {
      logger.error('Failed to fetch provider entry', { error });
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Provider-Authenticated Endpoints ─────────────────────────────────────────

  /**
   * POST /api/v3/directory/opt-in
   * 
   * Opt into the provider directory.
   * Requires provider authentication (x-provider-key header).
   * Provider must have verified payout address.
   */
  router.post('/opt-in', requireProviderAuth, (req: ProviderAuthenticatedRequest, res: Response) => {
    const parsed = optInSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    try {
      if (!req.provider) {
        return res.status(401).json({ error: 'Provider authentication required' });
      }

      const optIn = directory.optIn({
        providerId: req.provider.providerId,
        description: parsed.data.description,
        categories: parsed.data.categories,
        contact: parsed.data.contact,
      });

      return res.status(201).json({ data: optIn });
    } catch (error) {
      logger.error('Opt-in failed', { error, providerId: req.provider?.providerId });
      
      if (error instanceof Error) {
        if (error.message.includes('verify payout address')) {
          return res.status(403).json({ error: error.message });
        }
        if (error.message.includes('not found')) {
          return res.status(404).json({ error: error.message });
        }
      }

      return res.status(500).json({ error: 'Failed to opt in' });
    }
  });

  /**
   * POST /api/v3/directory/opt-out
   * 
   * Opt out of the provider directory.
   * Requires provider authentication.
   * Provider immediately disappears from search results.
   */
  router.post('/opt-out', requireProviderAuth, (req: ProviderAuthenticatedRequest, res: Response) => {
    try {
      if (!req.provider) {
        return res.status(401).json({ error: 'Provider authentication required' });
      }

      directory.optOut(req.provider.providerId);

      return res.json({ 
        success: true,
        message: 'Provider removed from directory',
      });
    } catch (error) {
      logger.error('Opt-out failed', { error, providerId: req.provider?.providerId });

      if (error instanceof Error && error.message.includes('not in directory')) {
        return res.status(404).json({ error: error.message });
      }

      return res.status(500).json({ error: 'Failed to opt out' });
    }
  });

  /**
   * GET /api/v3/directory/my-listing
   * 
   * Get the authenticated provider's own directory entry.
   * Shows what agents see when they query the directory.
   */
  router.get('/my-listing', requireProviderAuth, (req: ProviderAuthenticatedRequest, res: Response) => {
    try {
      if (!req.provider) {
        return res.status(401).json({ error: 'Provider authentication required' });
      }

      const entry = directory.getEntry(req.provider.providerId);
      if (!entry) {
        return res.status(404).json({ 
          error: 'Not listed in directory',
          message: 'Use POST /api/v3/directory/opt-in to join the directory',
        });
      }

      return res.json({ data: entry });
    } catch (error) {
      logger.error('Failed to fetch own listing', { error, providerId: req.provider?.providerId });
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
