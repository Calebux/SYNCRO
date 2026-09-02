import { Request, Response } from 'express';
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
import {
  createDescriptor,
  auth,
  rateLimit,
  validate,
  audit,
} from '../router/descriptors';

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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are accepted'));
    }
  },
});

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

const checkDuplicatesSchema = z.object({
  name: z.string().min(1),
  price: z.number(),
  billing_cycle: z.enum(['monthly', 'yearly', 'quarterly']),
});

const autoTagSchema = z.object({
  name: z.string().min(1),
});

const importPreviewSchema = z.object({
  file: z.instanceof(Buffer),
});

const importCommitSchema = z.object({
  importId: z.string().uuid(),
});

const retrySyncSchema = z.object({}).passthrough();

const attachGiftCardSchema = z.object({
  giftCardHash: z.string().min(1),
  provider: z.string().min(1),
});

const cancelTrialSchema = z.object({
  acted_on_reminder_days: z.number().optional(),
}).passthrough();

const trackInteractionSchema = z.object({}).passthrough();

function extractWaitTime(message: string): number {
  const match = message.match(/wait (\d+) seconds/);
  return match ? parseInt(match[1], 10) : 60;
}

const listQuerySchema = z.object({
  status: z.string().optional(),
  category: z.string().optional(),
  cursor: z.string().optional(),
  encrypted_only: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const subscriptionRoutes = [
  createDescriptor({
    method: 'get',
    path: '/subscriptions/encryption-summary',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
      const summary = await subscriptionService.getSubscriptionEncryptionSummary(req.user!.id);
      res.json({ success: true, data: summary });
    },
    auth: auth.user(),
    summary: 'Get encryption summary for user subscriptions',
    tags: ['Subscriptions'],
    audit: audit.read('subscription_encryption_summary'),
  }),

  createDescriptor({
    method: 'get',
    path: '/subscriptions',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
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
    },
    auth: auth.user(),
    validation: [validate.query(listQuerySchema)],
    summary: 'List user subscriptions',
    tags: ['Subscriptions'],
    audit: audit.list('subscriptions'),
  }),

  createDescriptor({
    method: 'post',
    path: '/subscriptions/encrypt-all',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
      const result = await subscriptionService.encryptAllUnencryptedSubscriptions(req.user!.id);
      res.json({ success: true, data: { encryptedCount: result.count } });
    },
    auth: auth.user(),
    summary: 'Encrypt all unencrypted subscriptions',
    tags: ['Subscriptions'],
    audit: audit.update('subscription_encrypt_all', { severity: 'medium' }),
  }),

  createDescriptor({
    method: 'post',
    path: '/subscriptions',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
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
    },
    auth: auth.user(),
    validation: [validate.body(createSubscriptionSchema)],
    summary: 'Create new subscription',
    tags: ['Subscriptions'],
    audit: audit.create('subscription', { includeRequestBody: true, includeResponseBody: true }),
  }),

  createDescriptor({
    method: 'get',
    path: '/subscriptions/:id',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
      const subscription = await subscriptionService.getSubscription(req.user!.id, req.params.id);
      res.json({ success: true, data: subscription });
    },
    auth: auth.user(),
    validation: [validate.params(z.object({ id: z.string().uuid() }))],
    summary: 'Get single subscription',
    tags: ['Subscriptions'],
    audit: audit.read('subscription'),
  }),

  createDescriptor({
    method: 'patch',
    path: '/subscriptions/:id',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
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
    },
    auth: auth.user(),
    validation: [
      validate.params(z.object({ id: z.string().uuid() })),
      validate.body(updateSubscriptionSchema),
    ],
    summary: 'Update subscription',
    tags: ['Subscriptions'],
    audit: audit.update('subscription', { includeRequestBody: true, includeResponseBody: true }),
  }),

  createDescriptor({
    method: 'delete',
    path: '/subscriptions/:id',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
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
    },
    auth: auth.user(),
    validation: [validate.params(z.object({ id: z.string().uuid() }))],
    summary: 'Delete subscription',
    tags: ['Subscriptions'],
    audit: audit.delete('subscription'),
  }),

  createDescriptor({
    method: 'post',
    path: '/subscriptions/:id/restore',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
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
    },
    auth: auth.user(),
    validation: [validate.params(z.object({ id: z.string().uuid() }))],
    summary: 'Restore soft-deleted subscription',
    tags: ['Subscriptions'],
    audit: audit.update('subscription_restore', { includeResponseBody: true }),
  }),

  createDescriptor({
    method: 'get',
    path: '/subscriptions/:id/price-history',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
      const history = await subscriptionService.getPriceHistory(req.user!.id, req.params.id);
      res.json({ success: true, data: history });
    },
    auth: auth.user(),
    validation: [validate.params(z.object({ id: z.string().uuid() }))],
    summary: 'Get subscription price history',
    tags: ['Subscriptions'],
    audit: audit.read('subscription_price_history'),
  }),

  createDescriptor({
    method: 'post',
    path: '/subscriptions/:id/attach-gift-card',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
      const { giftCardHash, provider } = validateRequest(attachGiftCardSchema, req.body);

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
    },
    auth: auth.user(),
    validation: [
      validate.params(z.object({ id: z.string().uuid() })),
      validate.body(attachGiftCardSchema),
    ],
    summary: 'Attach gift card to subscription',
    tags: ['Subscriptions'],
    audit: audit.create('subscription_gift_card', { includeRequestBody: true }),
  }),

  createDescriptor({
    method: 'post',
    path: '/subscriptions/:id/retry-sync',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
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
    },
    auth: auth.user(),
    validation: [
      validate.params(z.object({ id: z.string().uuid() })),
      validate.body(retrySyncSchema),
    ],
    summary: 'Retry blockchain sync for subscription',
    tags: ['Subscriptions'],
    audit: audit.update('subscription_retry_sync', { severity: 'medium' }),
  }),

  createDescriptor({
    method: 'get',
    path: '/subscriptions/:id/cooldown-status',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
      const cooldownStatus = await subscriptionService.checkRenewalCooldown(req.params.id);
      res.json({ success: true, ...cooldownStatus });
    },
    auth: auth.user(),
    validation: [validate.params(z.object({ id: z.string().uuid() }))],
    summary: 'Get subscription cooldown status',
    tags: ['Subscriptions'],
    audit: audit.read('subscription_cooldown_status'),
  }),

  createDescriptor({
    method: 'post',
    path: '/subscriptions/:id/cancel',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
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
    },
    auth: auth.user(),
    validation: [validate.params(z.object({ id: z.string().uuid() }))],
    summary: 'Cancel subscription (stop billing)',
    tags: ['Subscriptions'],
    audit: audit.update('subscription_cancel', { severity: 'medium' }),
  }),

  createDescriptor({
    method: 'post',
    path: '/subscriptions/:id/pause',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
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
    },
    auth: auth.user(),
    validation: [
      validate.params(z.object({ id: z.string().uuid() })),
      validate.body(pauseSchema),
    ],
    summary: 'Pause subscription',
    tags: ['Subscriptions'],
    audit: audit.update('subscription_pause', { includeRequestBody: true }),
  }),

  createDescriptor({
    method: 'post',
    path: '/subscriptions/:id/resume',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
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
    },
    auth: auth.user(),
    validation: [validate.params(z.object({ id: z.string().uuid() }))],
    summary: 'Resume paused subscription',
    tags: ['Subscriptions'],
    audit: audit.update('subscription_resume'),
  }),

  createDescriptor({
    method: 'post',
    path: '/subscriptions/bulk',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
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
    },
    auth: auth.user(),
    validation: [validate.body(bulkOperationSchema)],
    summary: 'Bulk delete or update subscriptions',
    tags: ['Subscriptions'],
    audit: audit.update('subscription_bulk', { includeRequestBody: true, severity: 'medium' }),
  }),

  createDescriptor({
    method: 'patch',
    path: '/subscriptions/:id/notification-preferences',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
      const validatedData = validateRequest(notificationPreferencesSchema, req.body);

      const preferences = await notificationPreferenceService.upsertPreferences(
        req.params.id,
        validatedData
      );

      res.json({ success: true, data: preferences });
    },
    auth: auth.user(),
    validation: [
      validate.params(z.object({ id: z.string().uuid() })),
      validate.body(notificationPreferencesSchema),
    ],
    summary: 'Update notification preferences for subscription',
    tags: ['Subscriptions'],
    audit: audit.update('subscription_notification_preferences', { includeRequestBody: true }),
  }),

  createDescriptor({
    method: 'post',
    path: '/subscriptions/:id/snooze',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
      const { until } = validateRequest(snoozeSchema, req.body);

      const preferences = await notificationPreferenceService.snooze(req.params.id, until);

      res.json({
        success: true,
        data: preferences,
        message: `Reminders snoozed until ${until}`,
      });
    },
    auth: auth.user(),
    validation: [
      validate.params(z.object({ id: z.string().uuid() })),
      validate.body(snoozeSchema),
    ],
    summary: 'Snooze subscription reminders',
    tags: ['Subscriptions'],
    audit: audit.update('subscription_snooze', { includeRequestBody: true }),
  }),

  createDescriptor({
    method: 'post',
    path: '/subscriptions/:id/trial/convert',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
      const result = await subscriptionService.convertTrial(req.user!.id, req.params.id);
      res.json({ success: true, message: 'Trial converted successfully', data: result });
    },
    auth: auth.user(),
    validation: [validate.params(z.object({ id: z.string().uuid() }))],
    summary: 'Convert trial to paid subscription',
    tags: ['Subscriptions'],
    audit: audit.update('subscription_trial_convert', { severity: 'medium' }),
  }),

  createDescriptor({
    method: 'post',
    path: '/subscriptions/:id/trial/cancel',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
      const { acted_on_reminder_days } = validateRequest(cancelTrialSchema, req.body);
      const result = await subscriptionService.cancelTrial(req.user!.id, req.params.id, acted_on_reminder_days);
      res.json({ success: true, message: 'Trial cancelled successfully', data: result });
    },
    auth: auth.user(),
    validation: [
      validate.params(z.object({ id: z.string().uuid() })),
      validate.body(cancelTrialSchema),
    ],
    summary: 'Cancel trial subscription',
    tags: ['Subscriptions'],
    audit: audit.update('subscription_trial_cancel', { severity: 'medium' }),
  }),

  createDescriptor({
    method: 'get',
    path: '/subscriptions/trials/saved-metric',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
      const count = await subscriptionService.getSavedTrialsCount(req.user!.id);
      res.json({ success: true, savedCount: count });
    },
    auth: auth.user(),
    summary: 'Get saved trials count',
    tags: ['Subscriptions'],
    audit: audit.read('subscription_saved_trials_count'),
  }),

  createDescriptor({
    method: 'post',
    path: '/subscriptions/import/preview',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
      if (!req.file) throw new BadRequestError('No file uploaded');
      const preview = await subscriptionService.previewImport(req.user!.id, req.file.buffer);
      res.json({ success: true, data: preview });
    },
    auth: auth.user(),
    rateLimit: rateLimit.standard('createImportLimiter'),
    summary: 'Preview CSV import',
    tags: ['Subscriptions'],
    audit: audit.create('subscription_import_preview', { severity: 'medium' }),
  }),

  createDescriptor({
    method: 'post',
    path: '/subscriptions/import/commit',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
      const { importId } = validateRequest(importCommitSchema, req.body);
      const result = await subscriptionService.commitImport(req.user!.id, importId);
      res.json({ success: true, data: result });
    },
    auth: auth.user(),
    rateLimit: rateLimit.standard('createImportLimiter'),
    validation: [validate.body(importCommitSchema)],
    summary: 'Commit CSV import',
    tags: ['Subscriptions'],
    audit: audit.create('subscription_import_commit', { includeRequestBody: true, severity: 'medium' }),
  }),

  createDescriptor({
    method: 'post',
    path: '/subscriptions/check-duplicates',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { name, price, billing_cycle } = validateRequest(checkDuplicatesSchema, req.body);
        const result = await idempotencyService.findPotentialDuplicates(req.user!.id, { name, price, billing_cycle });
        return res.json({ success: true, ...result });
      } catch (error) {
        logger.error('check-duplicates error:', error);
        return res.status(500).json({ success: false, error: 'Failed to check duplicates' });
      }
    },
    auth: auth.user(),
    validation: [validate.body(checkDuplicatesSchema)],
    summary: 'Check for duplicate subscriptions',
    tags: ['Subscriptions'],
    audit: audit.read('subscription_check_duplicates'),
  }),

  createDescriptor({
    method: 'get',
    path: '/subscriptions/auto-tag',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
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
    },
    auth: auth.user(),
    validation: [validate.query(autoTagSchema)],
    summary: 'Auto-tag subscription by name',
    tags: ['Subscriptions'],
    audit: audit.read('subscription_auto_tag'),
  }),

  createDescriptor({
    method: 'post',
    path: '/subscriptions/:id/track-interaction',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
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
    },
    auth: auth.user(),
    validation: [
      validate.params(z.object({ id: z.string().uuid() })),
      validate.body(trackInteractionSchema),
    ],
    summary: 'Track user interaction with subscription',
    tags: ['Subscriptions'],
    audit: audit.update('subscription_track_interaction'),
  }),
];