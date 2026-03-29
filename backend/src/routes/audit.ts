import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { auditService, AuditEntry, AuditEventBatch } from '../services/audit-service';
import { adminAuth } from '../middleware/admin';
import logger from '../config/logger';

// ─── Validation schemas ───────────────────────────────────────────────────────

const auditEventSchema = z.object({
  // Core identity fields
  action: z.string().min(1).max(100, 'action must not exceed 100 characters'),
  resource_type: z.string().min(1).max(100, 'resource_type must not exceed 100 characters'),
  resource_id: z.string().max(255, 'resource_id must not exceed 255 characters').optional(),

  // Actor / session info
  user_id: z.string().max(128, 'user_id must not exceed 128 characters').optional(),
  session_id: z.string().max(128, 'session_id must not exceed 128 characters').optional(),

  // Contextual metadata (free-form but bounded)
  metadata: z.record(z.unknown()).optional(),

  // Status / severity
  status: z.enum(['success', 'failure', 'pending']).optional(),
  severity: z.enum(['info', 'warn', 'error', 'critical']).optional(),

  // Timestamps — caller may supply; enrichment happens server-side
  timestamp: z.string().datetime({ offset: true }).optional(),
});

const auditBatchSchema = z.object({
  events: z
    .array(auditEventSchema)
    .min(1, 'events array must not be empty')
    .max(100, 'maximum 100 events per batch'),
});


const router = Router();

/**
 * POST /api/audit
 * Accept batch of audit events from client
 * Expects: { events: AuditEntry[] }
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const bodyValidation = auditBatchSchema.safeParse(req.body);
    if (!bodyValidation.success) {
      return res.status(400).json({
        error: 'Invalid request: ' + bodyValidation.error.errors.map((e) => e.message).join(', '),
      });
    }

    // Enrich events with request metadata
    const enrichedEvents = bodyValidation.data.events.map((event) => ({
      ...event,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent') || undefined,
    }));

    // Insert batch into database
    const result = await auditService.insertBatch(enrichedEvents as AuditEntry[]);

    if (!result.success) {
      logger.warn(`Audit batch insertion failed: ${result.errors.join(', ')}`);
      return res.status(400).json({
        error: 'Failed to insert audit events',
        details: result.errors,
      });
    }

    // Log success
    logger.info(
      `Audit batch processed: ${result.inserted} inserted, ${result.failed} failed`
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
});


/**
 * GET /api/admin/audit
 * Retrieve audit logs (admin only)
 * Query parameters:
 *   - action: filter by action
 *   - resourceType: filter by resource type
 *   - userId: filter by user ID
 *   - limit: number of results (default: 100, max: 1000)
 *   - offset: pagination offset (default: 0)
 *   - startDate: ISO8601 date string for start of range
 *   - endDate: ISO8601 date string for end of range
 */
router.get('/', adminAuth, async (req: Request, res: Response) => {
  try {
    const {
      action,
      resourceType,
      userId,
      limit = '100',
      offset = '0',
      startDate,
      endDate,
    } = req.query;

    // Validate and parse limit and offset
    let parsedLimit = parseInt(limit as string, 10);
    let parsedOffset = parseInt(offset as string, 10);

    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
      parsedLimit = 100;
    }

    if (isNaN(parsedOffset) || parsedOffset < 0) {
      parsedOffset = 0;
    }

    // Query audit logs
    const logs = await auditService.getAllLogs({
      action: action as string | undefined,
      resourceType: resourceType as string | undefined,
      userId: userId as string | undefined,
      limit: parsedLimit,
      offset: parsedOffset,
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
    });

    // Get total count
    const total = await auditService.getLogsCount({
      action: action as string | undefined,
      resourceType: resourceType as string | undefined,
      userId: userId as string | undefined,
    });

    res.json({
      success: true,
      data: logs,
      pagination: {
        limit: parsedLimit,
        offset: parsedOffset,
        total,
        hasMore: parsedOffset + parsedLimit < total,
      },
    });
  } catch (error) {
    logger.error('Error in GET /api/admin/audit:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
