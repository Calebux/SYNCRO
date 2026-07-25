import { Router, Request, Response } from 'express';
import { auditService, AuditEntry } from '../services/audit-service';
import { adminAuth } from '../middleware/admin';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import logger from '../config/logger';
import { auditBatchSchema, auditQuerySchema, auditVerifyQuerySchema } from '../schemas/audit';
import { PaginationError } from '../utils/pagination';

const router: Router = Router();

/**
 * POST /api/audit
 * Submit a batch of audit events (authenticated users only)
 */
router.post(
  '/',
  authenticate,
  requireRole('owner', 'admin', 'member', 'viewer'),
  validate(auditBatchSchema),
  async (req: AuthenticatedRequest, res: Response) => {
  try {
    const enrichedEvents = req.body.events.map((event: Record<string, unknown>): AuditEntry => ({
      userId: req.user!.id,
      action: event.action as string,
      resourceType: (event.resource_type ?? event.resourceType) as string,
      resourceId: (event.resource_id ?? event.resourceId) as string | undefined,
      metadata: event.metadata as Record<string, unknown> | undefined,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.get('user-agent') || undefined,
    }));

    const result = await auditService.insertBatch(enrichedEvents as AuditEntry[]);

    if (!result.success) {
      logger.warn(`Audit batch insertion failed: ${result.errors.join(', ')}`);
      return res.status(400).json({
        error: 'Failed to insert audit events',
        details: result.errors,
      });
    }

    logger.info(
      `Audit batch processed: ${result.inserted} inserted, ${result.failed} failed`,
    );

    res.status(201).json({
      success: true,
      inserted: result.inserted,
      failed: result.failed,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (error) {
    logger.error('Error in POST /api/audit:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
},
);

/**
 * GET /api/audit
 * Retrieve audit logs (admin only)
 */
router.get(
  '/',
  adminAuth,
  validate(auditQuerySchema, 'query'),
  async (req: Request, res: Response) => {
    try {
      const { action, resourceType, userId, limit, offset, startDate, endDate } = req.query as any;

      const logs = await auditService.getAllLogs({
        action,
        resourceType,
        userId,
        limit,
        offset,
        startDate,
        endDate,
      });

      const total = await auditService.getLogsCount({
        action,
        resourceType,
        userId,
      });

      res.json({
        success: true,
        data: logs,
        pagination: {
          limit,
          offset,
          total,
          hasMore: offset + limit < total,
        },
      });
    } catch (error: any) {
      if (error.name === 'PaginationError') {
        res.status(400).json({
          success: false,
          error: error.message,
          code: error.code,
        });
        return;
      }
      logger.error('Error in GET /api/admin/audit:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      });
    }
  },
);

/**
 * GET /api/audit/verify
 * Verify the tamper-evidence hash chain (admin only, issue #1081).
 *
 * Always responds 200 with the verification result — monitoring should alert on
 * `valid === false`, which means an entry was edited, deleted or re-signed.
 */
router.get(
  '/verify',
  adminAuth,
  validate(auditVerifyQuerySchema, 'query'),
  async (req: Request, res: Response) => {
    try {
      const { startSequence, endSequence, limit } = req.query as unknown as {
        startSequence?: number;
        endSequence?: number;
        limit: number;
      };

      const result = await auditService.verifyChain({ startSequence, endSequence, limit });

      if (!result.valid) {
        logger.error('Audit chain verification detected tampering', {
          issues: result.issues.length,
          entriesChecked: result.entriesChecked,
        });
      }

      res.json({ success: true, ...result });
    } catch (error) {
      logger.error('Error in GET /api/audit/verify:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
);

export default router;
