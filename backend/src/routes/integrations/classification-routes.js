'use strict';

/**
 * classification-routes.js
 *
 * Mounts on: /api/subscriptions
 *
 * Routes added:
 *   GET  /suggest                  – lightweight category suggestion chips
 *   POST /:id/reclassify           – reclassify a single subscription
 *   POST /reclassify-all           – reclassify all "other"-labelled subscriptions
 */

const express = require('express');
const { classifyService, suggestCategory } = require('../../services/subscription-classifier');

const router = express.Router();

// ─── Middleware: auth guard ───────────────────────────────────────────────────
// Assumes the authenticate middleware attaches req.user and req.supabase
// (matching the existing pattern in the codebase).
const { authenticate } = require('../../middleware/auth');

router.use(authenticate);

// ─── GET /api/subscriptions/suggest ──────────────────────────────────────────
/**
 * Return a lightweight category suggestion for a service name.
 * Only uses the static lookup table — no DB or LLM call.
 *
 * Query params:
 *   name {string} – service name to classify
 *
 * Response:
 *   { suggestedCategory: "productivity" | null, source: "rule_lookup" }
 */
router.get('/suggest', (req, res) => {
  const { name } = req.query;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Query param "name" is required' });
  }
  const result = suggestCategory(name);
  return res.json(result);
});

// ─── POST /api/subscriptions/:id/reclassify ───────────────────────────────────
/**
 * Re-run the full classification pipeline for a single subscription,
 * bypassing the DB cache so a fresh LLM call is made if needed.
 *
 * Body (optional):
 *   { forceRefresh: true }  – also skip the LLM cache
 *
 * Response:
 *   { subscriptionId, name, oldCategory, newCategory, confidence, source }
 */
router.post('/:id/reclassify', async (req, res) => {
  const { id }           = req.params;
  const forceRefresh     = req.body?.forceRefresh === true;
  const supabase         = req.supabase; // injected by auth middleware
  const userId           = req.user?.id;

  // Fetch the subscription (ownership check)
  const { data: sub, error: fetchErr } = await supabase
    .from('subscriptions')
    .select('id, name, website_url, category')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (fetchErr || !sub) {
    return res.status(404).json({ error: 'Subscription not found' });
  }

  const result = await classifyService({
    serviceName: sub.name,
    serviceUrl:  sub.website_url || '',
    supabase,
    skipCache:   forceRefresh,
  });

  // Persist the new category
  const { error: updateErr } = await supabase
    .from('subscriptions')
    .update({ category: result.category, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId);

  if (updateErr) {
    return res.status(500).json({ error: 'Failed to update subscription category' });
  }

  return res.json({
    subscriptionId: id,
    name:           sub.name,
    oldCategory:    sub.category,
    newCategory:    result.category,
    confidence:     result.confidence,
    source:         result.source,
  });
});

// ─── POST /api/subscriptions/reclassify-all ──────────────────────────────────
/**
 * Reclassify every subscription currently labelled "other" for the user.
 * Processes items sequentially to avoid rate-limiting the LLM API.
 *
 * Response:
 *   { processed, updated, errors }
 */
router.post('/reclassify-all', async (req, res) => {
  const supabase = req.supabase;
  const userId   = req.user?.id;

  const { data: subs, error: fetchErr } = await supabase
    .from('subscriptions')
    .select('id, name, website_url, category')
    .eq('user_id', userId)
    .eq('category', 'other');

  if (fetchErr) {
    return res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }

  const results = { processed: 0, updated: 0, errors: [] };

  for (const sub of (subs || [])) {
    results.processed++;
    try {
      const classification = await classifyService({
        serviceName: sub.name,
        serviceUrl:  sub.website_url || '',
        supabase,
      });

      if (classification.category !== 'other') {
        const { error: updateErr } = await supabase
          .from('subscriptions')
          .update({ category: classification.category, updated_at: new Date().toISOString() })
          .eq('id', sub.id)
          .eq('user_id', userId);

        if (updateErr) {
          results.errors.push({ id: sub.id, error: updateErr.message });
        } else {
          results.updated++;
        }
      }
    } catch (err) {
      results.errors.push({ id: sub.id, error: err.message });
    }
  }

  return res.json(results);
});

module.exports = router;