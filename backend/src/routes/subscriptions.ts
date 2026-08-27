import { Router, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { subscriptionService } from '../services/subscription-service';
import { idempotencyService } from '../services/idempotency';
import { giftCardService } from '../services/gift-card-service';
import { notificationPreferenceService } from '../services/notification-preference-service';
import { AuthenticatedRequest } from '../middleware/auth';
import { validateSubscriptionOwnership, validateBulkSubscriptionOwnership } from '../middleware/ownership';
import { SUPPORTED_CURRENCIES } from '../constants/currencies';
import logger from '../config/logger';
import { BadRequestError } from '../errors';
import { validateRequest } from '../utils/validation';
import { cursorPaginationSchema, safeUrlSchema } from '../schemas/common';
import { createImportLimiter } from '../middleware/rate-limit-factory';
import type { Subscription } from '../types/subscription';

const SUBSCRIPTION_STATUSES: readonly Subscription['status'][] = [
  'active',
  'cancelled',
  'paused',
  'trial',
  'expired',
];

function parseSubscriptionStatus(value: unknown): Subscription['status'] | undefined {
  return typeof value === 'string' &&
    (SUBSCRIPTION_STATUSES as readonly string[]).includes(value)
    ? (value as Subscription['status'])
    : undefined;
}

const router = Router();

// Configure multer for CSV imports
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024 }, // 1 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are accepted'));
    }
  },
});

// ── Zod schemas ───────────────────────────────────────────────────────────────

const createSubscriptionSchema = z.object({
  name: z.string().min(1),
  price: z.number().min(0),
  billing_cycle: z.enum(['monthly', 'yearly', 'quarterly']),
  currency: z.string()
    .refine(
      (val) => (SUPPORTED_CURRENCIES as readonly string[]).includes(val),
      { message: `Currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}` }
    )
    .optional(),
  renewal_url: safeUrlSchema.optional(),
  website_url: safeUrlSchema.optional(),
  logo_url: safeUrlSchema.optional(),
  category: z.string().optional(),
});

const updateSubscriptionSchema = createSubscriptionSchema.partial().passthrough();

const notificationPreferencesSchema = z.object({
  reminder_days_before: z
    .array(z.number().int().min(1).max(365))
    .min(1)
    .max(10)
    .optional(),
  channels: z
    .array(z.enum(['email', 'push', 'telegram', 'slack']))
    .min(1)
    .optional(),
  muted: z.boolean().optional(),
  muted_until: z.string().datetime({ offset: true }).nullable().optional(),
  custom_message: z.string().max(500).nullable().optional(),
});

const snoozeSchema = z.object({
  until: z.string().datetime({ offset: true }),
});

const pauseSchema = z.object({
  resumeAt: z.string().datetime({ offset: true }).optional(),
  reason: z.string().max(500).optional(),
});

const bulkOperationSchema = z.object({
  operation: z.enum(['delete', 'update']),
  ids: z.array(z.string().uuid()),
  data: z.any().optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractWaitTime(message: string): number {
  const match = message.match(/wait (\d+) seconds/);
  return match ? parseInt(match[1], 10) : 60;
}

// ── Router ────────────────────────────────────────────────────────────────────


/**
 * GET /api/subscriptions
 * List user's subscriptions
 */
router.get('/encryption-summary', async (req: AuthenticatedRequest, res: Response) => {
  const summary = await subscriptionService.getSubscriptionEncryptionSummary(req.user!.id);
  res.json({ success: true, data: summary });
});

router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, category, cursor, encrypted_only } = req.query;
    const pagination = validateRequest(cursorPaginationSchema, {
      limit: req.query.limit,
      cursor: req.query.cursor,
    });

    const result = await subscriptionService.listSubscriptions(req.user!.id, {
      status: parseSubscriptionStatus(status),
      category: category as string,
      encryptedOnly: encrypted_only === 'true',
      limit: pagination.limit,
      cursor: pagination.cursor,
    });

    res.json({
      success: true,
      data: result.subscriptions,
      pagination: {
        total: result.total,
        limit: pagination.limit,
        hasMore: result.hasMore,
        nextCursor: result.nextCursor ?? null,
      },
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'PaginationError') {
      throw new BadRequestError(error.message);
    }
    throw error;
  }
});

router.post('/encrypt-all', async (req: AuthenticatedRequest, res: Response) => {
  const result = await subscriptionService.encryptAllUnencryptedSubscriptions(req.user!.id);
  res.json({ success: true, data: { encryptedCount: result.count } });
});

/**
 * POST /api/subscriptions
 * Create new subscription with idempotency support
 */
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const idempotencyKey = req.headers['idempotency-key'] as string;
  const validatedData = validateRequest(createSubscriptionSchema, req.body);

  const result = await subscriptionService.createSubscription(
    req.user!.id,
    validatedData,
    idempotencyKey
  );

  const statusCode = result.syncStatus === 'failed' ? 207 : 201;
  res.status(statusCode).json({
    success: true,
    data: result.subscription,
    blockchain: {
      synced: result.syncStatus === 'synced',
      transactionHash: result.blockchainResult?.transactionHash,
      error: result.blockchainResult?.error,
    },
  });
});

/**
 * GET /api/subscriptions/:id
 * Get single subscription
 */
router.get('/:id', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  const subscription = await subscriptionService.getSubscription(req.user!.id, req.params.id);
  res.json({ success: true, data: subscription });
});

/**
 * PATCH /api/subscriptions/:id
 * Update subscription with optimistic locking
 */
router.patch('/:id', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  const expectedVersion = req.headers['if-match'] as string;
  const validatedData = validateRequest(updateSubscriptionSchema, req.body);

  const result = await subscriptionService.updateSubscription(
    req.user!.id,
    req.params.id,
    validatedData,
    expectedVersion ? parseInt(expectedVersion, 10) : undefined
  );

  const statusCode = result.syncStatus === 'failed' ? 207 : 200;
  res.status(statusCode).json({
    success: true,
    data: result.subscription,
    blockchain: {
      synced: result.syncStatus === 'synced',
      transactionHash: result.blockchainResult?.transactionHash,
      error: result.blockchainResult?.error,
    },
  });
});

/**
 * DELETE /api/subscriptions/:id
 * Delete subscription
 */
router.delete('/:id', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  const result = await subscriptionService.deleteSubscription(req.user!.id, req.params.id);

  const statusCode = result.syncStatus === 'failed' ? 207 : 200;
  res.status(statusCode).json({
    success: true,
    message: 'Subscription deleted',
    blockchain: {
      synced: result.syncStatus === 'synced',
      transactionHash: result.blockchainResult?.transactionHash,
      error: result.blockchainResult?.error,
    },
  });
});

/**
 * POST /api/subscriptions/:id/restore
 * Restore a soft-deleted subscription
 */
router.post('/:id/restore', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  const result = await subscriptionService.restoreSubscription(req.user!.id, req.params.id);

  const statusCode = result.syncStatus === 'failed' ? 207 : 200;
  res.status(statusCode).json({
    success: true,
    message: 'Subscription restored',
    data: result.subscription,
    blockchain: {
      synced: result.syncStatus === 'synced',
      transactionHash: result.blockchainResult?.transactionHash,
      error: result.blockchainResult?.error,
    },
  });
});

/**
 * GET /api/subscriptions/:id/price-history
 */
router.get('/:id/price-history', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  const history = await subscriptionService.getPriceHistory(req.user!.id, req.params.id);
  res.json({ success: true, data: history });
});

/**
 * POST /api/subscriptions/:id/attach-gift-card
 */
router.post('/:id/attach-gift-card', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  const { giftCardHash, provider } = req.body;
  if (!giftCardHash || !provider) {
    throw new BadRequestError('Missing required fields: giftCardHash, provider');
  }

  const result = await giftCardService.attachGiftCard(
    req.user!.id,
    req.params.id,
    giftCardHash,
    provider
  );

  if (!result.success) {
    throw new BadRequestError(result.error || 'Failed to attach gift card');
  }

  res.status(201).json({
    success: true,
    data: result.data,
    blockchain: {
      transactionHash: result.blockchainResult?.transactionHash,
      error: result.blockchainResult?.error,
    },
  });
});

/**
 * POST /api/subscriptions/:id/retry-sync
 */
router.post('/:id/retry-sync', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await subscriptionService.retryBlockchainSync(req.user!.id, req.params.id);
    res.json({
      success: result.success,
      transactionHash: result.transactionHash,
      error: result.error,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message?.includes('Cooldown period active')) {
      res.status(429).json({
        success: false,
        error: error.message,
        retryAfter: extractWaitTime(error.message),
      });
      return;
    }
    throw error;
  }
});

/**
 * GET /api/subscriptions/:id/cooldown-status
 */
router.get('/:id/cooldown-status', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  const cooldownStatus = await subscriptionService.checkRenewalCooldown(req.params.id);
  res.json({ success: true, ...cooldownStatus });
});

/**
 * POST /api/subscriptions/:id/cancel
 * Stop billing but keep record
 */
router.post('/:id/cancel', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  const result = await subscriptionService.cancelSubscription(req.user!.id, req.params.id);

  const statusCode = result.syncStatus === 'failed' ? 207 : 200;
  res.status(statusCode).json({
    success: true,
    data: result.subscription,
    blockchain: {
      synced: result.syncStatus === 'synced',
      transactionHash: result.blockchainResult?.transactionHash,
      error: result.blockchainResult?.error,
    },
  });
});

/**
 * POST /api/subscriptions/:id/pause
 */
router.post('/:id/pause', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  const { resumeAt, reason } = validateRequest(pauseSchema, req.body);

  if (resumeAt && new Date(resumeAt) <= new Date()) {
    throw new BadRequestError('resumeAt must be a future date');
  }

  const result = await subscriptionService.pauseSubscription(
    req.user!.id,
    req.params.id,
    resumeAt,
    reason
  );

  const statusCode = result.syncStatus === 'failed' ? 207 : 200;
  res.status(statusCode).json({
    success: true,
    data: result.subscription,
    blockchain: {
      synced: result.syncStatus === 'synced',
      transactionHash: result.blockchainResult?.transactionHash,
      error: result.blockchainResult?.error,
    },
  });
});

/**
 * POST /api/subscriptions/:id/resume
 */
router.post('/:id/resume', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  const result = await subscriptionService.resumeSubscription(req.user!.id, req.params.id);

  const statusCode = result.syncStatus === 'failed' ? 207 : 200;
  res.status(statusCode).json({
    success: true,
    data: result.subscription,
    blockchain: {
      synced: result.syncStatus === 'synced',
      transactionHash: result.blockchainResult?.transactionHash,
      error: result.blockchainResult?.error,
    },
  });
});

/**
 * POST /api/subscriptions/bulk
 */
router.post('/bulk', validateBulkSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  const { operation, ids, data } = validateRequest(bulkOperationSchema, req.body);

  const results = [];
  const errors = [];

  for (const id of ids) {
    try {
      let result;
      if (operation === 'delete') {
        result = await subscriptionService.deleteSubscription(req.user!.id, id);
      } else {
        if (!data) throw new BadRequestError('Update data required');
        result = await subscriptionService.updateSubscription(req.user!.id, id, data);
      }
      results.push({ id, success: true, result });
    } catch (error: unknown) {
      errors.push({
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  res.json({
    success: errors.length === 0,
    results,
    errors: errors.length > 0 ? errors : undefined,
  });
});

/**
 * PATCH /api/subscriptions/:id/notification-preferences
 */
router.patch('/:id/notification-preferences', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  const validatedData = validateRequest(notificationPreferencesSchema, req.body);

  const preferences = await notificationPreferenceService.upsertPreferences(
    req.params.id,
    validatedData
  );

  res.json({ success: true, data: preferences });
});

/**
 * POST /api/subscriptions/:id/snooze
 */
router.post('/:id/snooze', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  const { until } = validateRequest(snoozeSchema, req.body);

  const preferences = await notificationPreferenceService.snooze(req.params.id, until);

  res.json({
    success: true,
    data: preferences,
    message: `Reminders snoozed until ${until}`,
  });
});

/**
 * Trial conversion routes
 */
router.post('/:id/trial/convert', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  const result = await subscriptionService.convertTrial(req.user!.id, req.params.id);
  res.json({ success: true, message: 'Trial converted successfully', data: result });
});

router.post('/:id/trial/cancel', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  const { acted_on_reminder_days } = req.body;
  const result = await subscriptionService.cancelTrial(req.user!.id, req.params.id, acted_on_reminder_days);
  res.json({ success: true, message: 'Trial cancelled successfully', data: result });
});

router.get('/trials/saved-metric', async (req: AuthenticatedRequest, res: Response) => {
  const count = await subscriptionService.getSavedTrialsCount(req.user!.id);
  res.json({ success: true, savedCount: count });
});

// CSV Import Routes
router.post('/import/preview', createImportLimiter(), upload.single('file'), async (req: AuthenticatedRequest, res: Response) => {
  if (!req.file) throw new BadRequestError('No file uploaded');
  const preview = await subscriptionService.previewImport(req.user!.id, req.file.buffer);
  res.json({ success: true, data: preview });
});

router.post('/import/commit', createImportLimiter(), async (req: AuthenticatedRequest, res: Response) => {
  const { importId } = req.body;
  if (!importId) throw new BadRequestError('Import ID required');
  const result = await subscriptionService.commitImport(req.user!.id, importId);
  res.json({ success: true, data: result });
});

// POST /api/subscriptions/check-duplicates
router.post('/check-duplicates', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, price, billing_cycle } = req.body;
    if (!name || price === undefined || !billing_cycle) {
      return res.status(400).json({ success: false, error: 'name, price, and billing_cycle are required' });
    }
    const result = await idempotencyService.findPotentialDuplicates(req.user!.id, { name, price, billing_cycle });
    return res.json({ success: true, ...result });
  } catch (error) {
    logger.error('check-duplicates error:', error);
    return res.status(500).json({ success: false, error: 'Failed to check duplicates' });
  }
});

// GET /api/subscriptions/auto-tag?name=<name>
router.get('/auto-tag', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const name = req.query.name as string;
    if (!name) {
      return res.status(400).json({ success: false, error: 'name query parameter is required' });
    }
    const category = subscriptionService.autoTag(name);
    return res.json({ success: true, category });
  } catch (error) {
    logger.error('auto-tag error:', error);
    return res.status(500).json({ success: false, error: 'Failed to auto-tag subscription' });
  }
});

// POST /api/subscriptions/:id/track-interaction
// Called when user clicks "Open Site" to log last_interaction_at
router.post('/:id/track-interaction', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const subscriptionId = req.params.id;
    const now = new Date().toISOString();

    const { error } = await (await import('../config/database')).supabase
      .from('subscriptions')
      .update({ last_interaction_at: now, updated_at: now })
      .eq('id', subscriptionId)
      .eq('user_id', req.user!.id);

    if (error) {
      logger.error('track-interaction update error:', error);
      return res.status(500).json({ success: false, error: 'Failed to log interaction' });
    }

    return res.json({ success: true, last_interaction_at: now });
  } catch (error) {
    logger.error('track-interaction error:', error);
    return res.status(500).json({ success: false, error: 'Failed to log interaction' });
  }
});

export default router;
