import { Router, Request, Response } from 'express';
import { supabase } from '../config/database';
import logger from '../config/logger';
import { adminAuth } from '../middleware/admin';
import { createAdminLimiter } from '../middleware/rate-limit-factory';
import { complianceService } from '../services/compliance-service';
import { executeGdprDeletionPipeline } from '../services/gdpr-deletion-pipeline';

const router: Router = Router();

router.use(createAdminLimiter());
router.use(adminAuth);

/**
 * GET /api/admin/deletions
 * List deletion requests with optional status filter.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    let query = supabase
      .from('account_deletions')
      .select('id, user_id, status, requested_at, scheduled_deletion_at, cancelled_at, completed_at, reason')
      .order('requested_at', { ascending: false })
      .limit(100);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json({ success: true, data });
  } catch (error) {
    logger.error('Admin list deletions error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list deletions',
    });
  }
});

/**
 * GET /api/admin/deletions/:id
 * Get a deletion request with its audit trail (metadata only).
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { data: deletion, error: deletionError } = await supabase
      .from('account_deletions')
      .select('id, user_id, status, requested_at, scheduled_deletion_at, cancelled_at, completed_at, reason')
      .eq('id', id)
      .single();

    if (deletionError || !deletion) {
      return res.status(404).json({ success: false, error: 'Deletion request not found' });
    }

    const { data: auditTrail, error: auditError } = await supabase
      .from('deletion_audit_trail')
      .select('id, step, status, metadata, created_at')
      .eq('deletion_id', id)
      .order('created_at', { ascending: true });

    if (auditError) throw auditError;

    res.json({ success: true, data: { ...deletion, auditTrail: auditTrail ?? [] } });
  } catch (error) {
    logger.error('Admin get deletion error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get deletion',
    });
  }
});

/**
 * POST /api/admin/deletions/:id/process
 * Force-process a pending deletion immediately (bypasses grace period).
 */
router.post('/:id/process', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { data: deletion, error } = await supabase
      .from('account_deletions')
      .select('*')
      .eq('id', id)
      .eq('status', 'pending')
      .single();

    if (error || !deletion) {
      return res.status(404).json({ success: false, error: 'Pending deletion not found' });
    }

    const pipelineResult = await executeGdprDeletionPipeline(deletion.user_id, deletion.id);
    if (!pipelineResult.success) {
      return res.status(500).json({ success: false, error: pipelineResult.error });
    }

    const count = await complianceService.processHardDeleteForUser(deletion.user_id, deletion.id);
    if (count === 0) {
      return res.status(500).json({ success: false, error: 'Auth user deletion failed' });
    }

    res.json({ success: true, data: { stepsCompleted: pipelineResult.stepsCompleted } });
  } catch (error) {
    logger.error('Admin process deletion error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process deletion',
    });
  }
});

/**
 * POST /api/admin/deletions/:id/cancel
 * Admin-cancel a pending deletion request.
 */
router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('account_deletions')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'pending')
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, error: 'Pending deletion not found' });
    }

    await supabase.from('deletion_audit_trail').insert({
      deletion_id: id,
      step: 'admin_cancelled',
      status: 'completed',
      metadata: { cancelledBy: 'admin' },
    });

    res.json({ success: true, data });
  } catch (error) {
    logger.error('Admin cancel deletion error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to cancel deletion',
    });
  }
});

export default router;
