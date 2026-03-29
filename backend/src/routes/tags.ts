/**
 * Tags API Routes
 *
 * GET    /api/tags                           — list user's custom tags
 * POST   /api/tags                           — create a new tag
 * DELETE /api/tags/:id                       — delete a tag (cascade removes assignments)
 * POST   /api/subscriptions/:id/tags         — assign tag to subscription
 * DELETE /api/subscriptions/:id/tags/:tagId  — remove tag from subscription
 * PATCH  /api/subscriptions/:id/notes        — update subscription notes
 */

import express, { Response } from 'express';
import { z } from 'zod';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { supabase } from '../config/database';
import logger from '../config/logger';

const router = express.Router();
router.use(authenticate);

// ─── Validation ─────────────────────────────────────────────────────────────

const createTagSchema = z.object({
  name: z.string().min(1).max(50),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex colour')
    .default('#6366f1'),
});

const notesSchema = z.object({
  notes: z.string().max(5000),
});

const addTagSchema = z.object({
  tag_id: z.string().uuid(),
});

// ─── Tag CRUD ────────────────────────────────────────────────────────────────

/**
 * GET /api/tags
 * List all custom tags for the authenticated user.
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('subscription_tags')
      .select('id, name, color')
      .eq('user_id', userId)
      .order('name');

    if (error) throw error;

    return res.status(200).json({ success: true, data: { tags: data ?? [] } });
  } catch (error) {
    logger.error('Error fetching tags:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/tags
 * Create a new custom tag.
 */
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const parsed = createTagSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const { name, color } = parsed.data;

    const { data, error } = await supabase
      .from('subscription_tags')
      .insert({ user_id: userId, name: name.trim(), color })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ success: false, error: 'A tag with that name already exists' });
      }
      throw error;
    }

    return res.status(201).json({ success: true, data: { tag: data } });
  } catch (error) {
    logger.error('Error creating tag:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * DELETE /api/tags/:id
 * Delete a tag and all its assignments (handled by ON DELETE CASCADE).
 */
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { id } = req.params;

    const { error } = await supabase
      .from('subscription_tags')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw error;

    return res.status(200).json({ success: true, data: { deleted: true } });
  } catch (error) {
    logger.error('Error deleting tag:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─── Subscription tag assignments ────────────────────────────────────────────

/**
 * POST /api/subscriptions/:id/tags
 * Assign a tag to a subscription.
 */
router.post('/subscriptions/:id/tags', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const parsed = addTagSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const { id: subscriptionId } = req.params;
    const { tag_id } = parsed.data;

    // Verify ownership of the subscription
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('user_id')
      .eq('id', subscriptionId)
      .single();

    if (!sub || sub.user_id !== userId) {
      return res.status(404).json({ success: false, error: 'Subscription not found' });
    }

    // Verify tag belongs to user
    const { data: tag } = await supabase
      .from('subscription_tags')
      .select('id')
      .eq('id', tag_id)
      .eq('user_id', userId)
      .single();

    if (!tag) {
      return res.status(404).json({ success: false, error: 'Tag not found' });
    }

    const { error } = await supabase
      .from('subscription_tag_assignments')
      .upsert({ subscription_id: subscriptionId, tag_id });

    if (error) throw error;

    return res.status(200).json({ success: true, data: { assigned: true } });
  } catch (error) {
    logger.error('Error assigning tag:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * DELETE /api/subscriptions/:id/tags/:tagId
 * Remove a tag from a subscription.
 */
router.delete('/subscriptions/:id/tags/:tagId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { id: subscriptionId, tagId } = req.params;

    // Verify subscription ownership
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('user_id')
      .eq('id', subscriptionId)
      .single();

    if (!sub || sub.user_id !== userId) {
      return res.status(404).json({ success: false, error: 'Subscription not found' });
    }

    const { error } = await supabase
      .from('subscription_tag_assignments')
      .delete()
      .eq('subscription_id', subscriptionId)
      .eq('tag_id', tagId);

    if (error) throw error;

    return res.status(200).json({ success: true, data: { removed: true } });
  } catch (error) {
    logger.error('Error removing tag:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─── Subscription notes ──────────────────────────────────────────────────────

/**
 * PATCH /api/subscriptions/:id/notes
 * Update the free-text notes on a subscription.
 */
router.patch('/subscriptions/:id/notes', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const parsed = notesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const { id: subscriptionId } = req.params;
    const { notes } = parsed.data;

    const { error } = await supabase
      .from('subscriptions')
      .update({ notes })
      .eq('id', subscriptionId)
      .eq('user_id', userId);

    if (error) throw error;

    return res.status(200).json({ success: true, data: { updated: true } });
  } catch (error) {
    logger.error('Error updating notes:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
