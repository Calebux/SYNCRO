import { z } from 'zod';
import { safeUrlSchema } from './common';

// ─── Create ─────────────────────────────────────────────────────────────────

export const createSubscriptionSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must not exceed 100 characters'),
  price: z.number().nonnegative('Price must be zero or positive').max(100000, 'Price must not exceed 100 000'),
  billing_cycle: z.enum(['monthly', 'yearly', 'quarterly', 'weekly', 'annual'], {
    errorMap: () => ({ message: 'billing_cycle must be one of: monthly, yearly, quarterly, weekly, annual' }),
  }),
  currency: z.string().max(10, 'Currency must not exceed 10 characters').optional(),
  next_billing_date: z.string().datetime({ offset: true }).optional(),
  renewal_url: safeUrlSchema.optional(),
  website_url: safeUrlSchema.optional(),
  logo_url: safeUrlSchema.optional(),
  category: z.string().max(50, 'Category must not exceed 50 characters').optional(),
  notes: z.string().max(5000, 'Notes must not exceed 5000 characters').optional(),
  is_trial: z.boolean().optional(),
  trial_end_date: z.string().datetime({ offset: true }).optional(),
  trial_converts_to_price: z.number().nonnegative().max(100000).optional(),
  price_after_trial: z.number().nonnegative().max(100000).optional(),
  credit_card_required: z.boolean().optional(),
  status: z.enum(['active', 'cancelled', 'expired', 'paused', 'trial']).optional(),
});

// ─── Update ─────────────────────────────────────────────────────────────────

export const updateSubscriptionSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    price: z.number().nonnegative().max(100000).optional(),
    billing_cycle: z
      .enum(['monthly', 'yearly', 'quarterly', 'weekly', 'annual'])
      .optional(),
    currency: z.string().max(10).optional(),
    next_billing_date: z.string().datetime({ offset: true }).optional(),
    renewal_url: safeUrlSchema.optional(),
    website_url: safeUrlSchema.optional(),
    logo_url: safeUrlSchema.optional(),
    category: z.string().max(50).optional(),
    notes: z.string().max(5000).optional(),
    status: z.enum(['active', 'cancelled', 'expired', 'paused', 'trial']).optional(),
  })
  .passthrough();

// ─── List query ─────────────────────────────────────────────────────────────

export const listSubscriptionsQuerySchema = z.object({
  status: z.enum(['active', 'cancelled', 'expired', 'paused', 'trial']).optional(),
  category: z.string().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  cursor: z.string().max(500).optional(),
});

// ─── Bulk operations ────────────────────────────────────────────────────────

export const bulkOperationSchema = z.object({
  operation: z.enum(['delete', 'update'], {
    errorMap: () => ({ message: "operation must be 'delete' or 'update'" }),
  }),
  ids: z
    .array(z.string().uuid())
    .min(1, 'At least one id is required')
    .max(100, 'Maximum 100 ids per batch'),
  data: z.record(z.unknown()).optional(),
});

// ─── Pause / Resume ─────────────────────────────────────────────────────────

export const pauseSubscriptionSchema = z.object({
  resumeAt: z.string().datetime({ offset: true }).optional(),
  reason: z.string().max(500, 'Reason must not exceed 500 characters').optional(),
});

// ─── Snooze ─────────────────────────────────────────────────────────────────

export const snoozeSchema = z.object({
  until: z.string().datetime({ offset: true }),
});

// ─── Notification preferences ───────────────────────────────────────────────

export const notificationPreferencesSchema = z.object({
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

// ─── Attach gift card ───────────────────────────────────────────────────────

export const attachGiftCardSchema = z.object({
  giftCardHash: z.string().min(1, 'giftCardHash is required').max(255, 'giftCardHash must not exceed 255 characters'),
  provider: z.string().min(1, 'provider is required').max(100, 'provider must not exceed 100 characters'),
});

// ─── Trial actions ──────────────────────────────────────────────────────────

export const trialCancelSchema = z.object({
  acted_on_reminder_days: z.number().int().min(0).max(365).optional(),
});
