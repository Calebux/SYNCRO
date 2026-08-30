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
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { supabase } from '../config/database';
import logger from '../config/logger';
import { createTagSchema, notesSchema, addTagSchema } from '../schemas/tag';
import { uuidParamSchema } from '../schemas/common';
import { parseDbError } from '../utils/db-constraint-errors';

const router: express.Router = express.Router();
router.use(authenticate);

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
router.post('/', validate(createTagSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { name, color } = req.body;

    const { data, error } = await supabase
      .from('subscription_tags')
      .insert({ user_id: userId, name: name.trim(), color })
      .select()
      .single();

    if (error) {
      const appError = parseDbError(error);
      if (appError) {
        return res.status(appError.status).json({ success: false, error: appError.message, field: appError.field });
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
router.delete('/:id', validate(uuidParamSchema, 'params'), async (req: AuthenticatedRequest, res: Response) => {
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
router.post(
  '/subscriptions/:id/tags',
  validate(addTagSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

      const { id: subscriptionId } = req.params;
      const { tag_id } = req.body;

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
        .from('subscription_tags')
        .insert({ subscription_id: subscriptionId, tag_id });

      if (error) {
        const appError = parseDbError(error);
        if (appError) {
          return res.status(appError.status).json({ success: false, error: appError.message, field: appError.field });
        }
        throw error;
      }

      return res.status(200).json({ success: true, data: { assigned: true } });
    } catch (error) {
      logger.error('Error assigning tag:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  },
);

/**
 * DELETE /api/subscriptions/:id/tags/:tagId
 * Remove a tag from a subscription.
 */
router.delete('/subscriptions/:id/tags/:tagId', validate(uuidParamSchema, 'params'), async (req: AuthenticatedRequest, res: Response) => {
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
      .from('subscription_tags')
      .delete()
      .eq('subscription_id', subscriptionId)
      .eq('tag_id', tagId);

    if (error) {
      const appError = parseDbError(error);
      if (appError) {
        return res.status(appError.status).json({ success: false, error: appError.message, field: appError.field });
      }
      throw error;
    }

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
router.patch(
  '/subscriptions/:id/notes',
  validate(notesSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

      const { id: subscriptionId } = req.params;
      const { notes } = req.body;

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
  },
);

export default router;
