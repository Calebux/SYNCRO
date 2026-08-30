/**
 * subscription-creation.ts
 *
 * Drop-in replacement for the POST /api/subscriptions handler.
 * Adds automatic category classification via the hybrid classifier
 * when the user leaves category blank or sets it to "other".
 *
 * Usage (in your router file):
 *
 *   import { handleCreateSubscription } from './subscription-creation';
 *   router.post('/', handleCreateSubscription);
 */

import type { Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DatabaseRepository } from '../repositories/database.repository';
import { classifyService, type Confidence, type ClassificationSource } from './subscription-classifier';
import logger from '../config/logger';

/**
 * Request augmented by the auth middleware, which attaches the per-request
 * Supabase client and the authenticated user.
 */
interface SubscriptionRequest extends Request {
  supabase: SupabaseClient;
  user?: { id?: string };
}

interface AutoTagMeta {
  autoTagged: true;
  confidence: Confidence;
  source: ClassificationSource;
}

/**
 * POST /api/subscriptions
 *
 * Extended body fields:
 *   name          {string}  required
 *   price         {number}  required
 *   billing_cycle {string}  required
 *   category      {string}  optional — auto-classified if absent or "other"
 *   website_url   {string}  optional — passed to classifier for better accuracy
 *   ...all other existing fields remain unchanged
 */
export async function handleCreateSubscription(
  req: SubscriptionRequest,
  res: Response,
): Promise<Response> {
  const supabase = req.supabase;
  const userId = req.user?.id;

  // ── Validate required fields ─────────────────────────────────────────────
  const { name, price, billing_cycle } = req.body;
  if (!name || price === undefined || !billing_cycle) {
    return res.status(400).json({
      error: 'Missing required fields: name, price, billing_cycle',
    });
  }

  // ── Determine category ────────────────────────────────────────────────────
  let category: string = req.body.category || '';
  let autoTagMeta: AutoTagMeta | null = null;

  if (!category || category === 'other') {
    const result = await classifyService({
      serviceName: name,
      serviceUrl: req.body.website_url || '',
      supabase,
    });

    category = result.category;
    autoTagMeta = {
      autoTagged: true,
      confidence: result.confidence,
      source: result.source,
    };
  }

  // ── Insert subscription ───────────────────────────────────────────────────
  const { data: subscription, error } = await new DatabaseRepository(req.supabase)
    .from('subscriptions')
    .insert({
      user_id: userId,
      name: req.body.name,
      provider: req.body.provider || req.body.name,
      price: req.body.price,
      billing_cycle: req.body.billing_cycle,
      status: req.body.status || 'active',
      next_billing_date: req.body.next_billing_date || null,
      category,
      logo_url: req.body.logo_url || null,
      website_url: req.body.website_url || null,
      renewal_url: req.body.renewal_url || null,
      notes: req.body.notes || null,
      tags: req.body.tags || [],
      email_account_id: req.body.email_account_id || null,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    logger.error('[subscriptions] create error', { error: error.message });
    return res.status(500).json({ error: 'Failed to create subscription' });
  }

  return res.status(201).json({
    success: true,
    data: subscription,
    ...(autoTagMeta && { classification: autoTagMeta }),
  });
}
