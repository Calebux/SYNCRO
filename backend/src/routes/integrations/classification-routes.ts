/**
 * classification-routes.ts
 *
 * Mounts on: /api/subscriptions
 *
 * Routes added:
 *   GET  /suggest                  – lightweight category suggestion chips
 *   POST /:id/reclassify           – reclassify a single subscription
 *   POST /reclassify-all           – reclassify all "other"-labelled subscriptions
 *
 * Converted from JavaScript to TypeScript (issue #1265). The classifier's
 * input/output contract lives in `services/subscription-classifier` and is
 * imported here rather than restated, so the route and the service cannot
 * drift apart.
 */

import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { supabase } from '../../config/database';
import logger from '../../config/logger';
import {
  classifyService,
  suggestCategory,
  type Category,
  type CategorySuggestion,
  type ClassificationSource,
  type Confidence,
} from '../../services/subscription-classifier';
import {
  suggestCategoryQuerySchema,
  reclassifyBodySchema,
  type SuggestCategoryQuery,
  type ReclassifyBody,
} from '../../schemas/classification';

// ─── Response contracts ──────────────────────────────────────────────────────

/** Row shape this router reads from `subscriptions`. */
interface SubscriptionRow {
  id: string;
  name: string;
  website_url: string | null;
  category: string | null;
}

/** Response body of POST /:id/reclassify. */
export interface ReclassifyResponse {
  subscriptionId: string;
  name: string;
  oldCategory: string | null;
  newCategory: Category;
  confidence: Confidence;
  source: ClassificationSource;
}

/** A single failure recorded during a bulk reclassification. */
export interface ReclassifyAllError {
  id: string;
  error: string;
}

/** Response body of POST /reclassify-all. */
export interface ReclassifyAllResponse {
  processed: number;
  updated: number;
  errors: ReclassifyAllError[];
}

const router: Router = Router();

// ─── GET /api/subscriptions/suggest ──────────────────────────────────────────
/**
 * Return a lightweight category suggestion for a service name.
 * Only uses the static lookup table — no DB or LLM call.
 */
router.get(
  '/suggest',
  validate(suggestCategoryQuerySchema, 'query'),
  (req: AuthenticatedRequest, res: Response<CategorySuggestion>) => {
    const { name } = req.query as unknown as SuggestCategoryQuery;
    return res.json(suggestCategory(name));
  },
);

// ─── POST /api/subscriptions/:id/reclassify ──────────────────────────────────
/**
 * Re-run the full classification pipeline for a single subscription,
 * optionally bypassing the DB cache so a fresh LLM call is made.
 */
router.post(
  '/:id/reclassify',
  validate(reclassifyBodySchema),
  async (req: AuthenticatedRequest, res: Response) => {
    // Express types a route param as string | string[]; the repo normalises
    // with this guard elsewhere (see routes/webhooks.ts).
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { forceRefresh } = req.body as ReclassifyBody;
    const userId = req.user!.id;

    // Fetch the subscription (ownership check)
    const { data, error: fetchErr } = await supabase
      .from('subscriptions')
      .select('id, name, website_url, category')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    const sub = data as SubscriptionRow | null;

    if (fetchErr || !sub) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    const result = await classifyService({
      serviceName: sub.name,
      serviceUrl: sub.website_url ?? '',
      supabase,
      skipCache: forceRefresh,
    });

    // Persist the new category
    const { error: updateErr } = await supabase
      .from('subscriptions')
      .update({ category: result.category, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId);

    if (updateErr) {
      logger.error('[classification] Failed to persist category', {
        subscriptionId: id,
        error: updateErr.message,
      });
      return res.status(500).json({ error: 'Failed to update subscription category' });
    }

    const body: ReclassifyResponse = {
      subscriptionId: id,
      name: sub.name,
      oldCategory: sub.category,
      newCategory: result.category,
      confidence: result.confidence,
      source: result.source,
    };

    return res.json(body);
  },
);

// ─── POST /api/subscriptions/reclassify-all ──────────────────────────────────
/**
 * Reclassify every subscription currently labelled "other" for the user.
 * Processes items sequentially to avoid rate-limiting the LLM API.
 */
// VALIDATION_BYPASS: No request parameters needed
router.post('/reclassify-all', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;

  const { data, error: fetchErr } = await supabase
    .from('subscriptions')
    .select('id, name, website_url, category')
    .eq('user_id', userId)
    .eq('category', 'other');

  if (fetchErr) {
    logger.error('[classification] Failed to fetch subscriptions for bulk reclassify', {
      error: fetchErr.message,
    });
    return res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }

  const subs = (data ?? []) as SubscriptionRow[];
  const results: ReclassifyAllResponse = { processed: 0, updated: 0, errors: [] };

  for (const sub of subs) {
    results.processed++;
    try {
      const classification = await classifyService({
        serviceName: sub.name,
        serviceUrl: sub.website_url ?? '',
        supabase,
      });

      if (classification.category !== 'other') {
        const { error: updateErr } = await supabase
          .from('subscriptions')
          .update({
            category: classification.category,
            updated_at: new Date().toISOString(),
          })
          .eq('id', sub.id)
          .eq('user_id', userId);

        if (updateErr) {
          results.errors.push({ id: sub.id, error: updateErr.message });
        } else {
          results.updated++;
        }
      }
    } catch (err) {
      results.errors.push({
        id: sub.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return res.json(results);
});

export default router;
