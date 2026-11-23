/**
 * Provider manifest endpoints (issue #1828).
 *
 * Two equivalent access paths are served:
 *
 *   GET /api/v3/providers/:providerId/manifest
 *       Canonical REST path, versioned under the v3 API surface.
 *
 *   GET /.well-known/syncro/:providerId
 *       Standards-style well-known path that lets a consumer derive the
 *       manifest URL from the provider's base URL without prior knowledge of
 *       the API layout.
 *
 * Both paths are intentionally **public** (no authentication required).
 * The manifest contains no secret material — only information a consumer
 * agent needs before it can make its first paid call.
 *
 * Cache-Control: max-age=300 (5 min) so agents do not hammer the server on
 * every call, but pick up price changes within a reasonable window.
 */

import { Router, Request, Response } from 'express';
import { buildProviderManifest } from '../../v3/provider-manifest';
import { providerStore } from '../v3-gateway';
import { receiptService } from '../../v3/receipt-runtime';

const router = Router({ mergeParams: true });

/**
 * Shared handler used by both mount paths.
 * Extracted so the two routes share identical logic and no
 * accidental divergence can creep in.
 */
function serveManifest(req: Request, res: Response): void {
  const providerId = req.params.providerId;

  if (!providerId) {
    res.status(400).json({ error: 'providerId is required' });
    return;
  }

  const manifest = buildProviderManifest(providerId, providerStore, receiptService);

  if (!manifest) {
    res.status(404).json({ error: 'provider not found' });
    return;
  }

  // Allow agents to cache for 5 minutes; shared caches (CDN) may hold for the
  // same window. stale-while-revalidate gives 60 more seconds of grace.
  res.setHeader(
    'Cache-Control',
    'public, max-age=300, stale-while-revalidate=60',
  );
  res.json({ data: manifest });
}

// ── REST path: /api/v3/providers/:providerId/manifest ───────────────────────
// (mounted without a prefix — the prefix is applied in index.ts)
router.get('/', serveManifest);

export default router;
