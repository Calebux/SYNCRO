import { z } from 'zod';

// ─── User Preferences Schema ────────────────────────────────────────────────

export const userPreferencesUpdateSchema = z.object({
  notification_channels: z
    .array(z.enum(['email', 'push']))
    .min(1, 'At least one notification channel is required')
    .optional(),
  reminder_timing: z
    .array(z.number().int().min(1).max(365))
    .min(1, 'At least one reminder timing is required')
    .max(10, 'Maximum 10 reminder timings allowed')
    .optional(),
  reminder_jitter_level: z.enum(['off', 'low', 'medium', 'high']).optional(),
  email_opt_ins: z
    .object({
      marketing: z.boolean().optional(),
      reminders: z.boolean().optional(),
      updates: z.boolean().optional(),
    })
    .optional(),
  automation_flags: z
    .object({
      auto_renew: z.boolean().optional(),
      auto_retry: z.boolean().optional(),
    })
    .optional(),
  risk_notification_threshold: z
    .enum(['LOW', 'MEDIUM', 'HIGH'])
    .optional(),
  currency: z.string().min(3).max(5).optional(),
  timezone: z.string().optional(),
  locale: z.string().optional(),
  preferred_gift_card_provider: z
    .enum(['atomic_wallet', 'bitrefill', 'coincards'])
    .optional(),
  privacy_mode_enabled: z.boolean().optional(),
  encryption_key: z.string().optional(),
  subscription_priority_order: z
    .array(z.string().uuid('Each subscription ID must be a valid UUID'))
    .max(500, 'Maximum 500 subscriptions in priority order')
    .optional(),
});

// ─── Quiet Hours Schema ─────────────────────────────────────────────────────

export const quietHoursUpdateSchema = z.object({
  quiet_hours_enabled: z.boolean(),
  quiet_hours_start: z
    .string()
    .regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format. Use HH:MM (24-hour format)')
    .optional(),
  quiet_hours_end: z
    .string()
    .regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format. Use HH:MM (24-hour format)')
    .optional(),
  quiet_hours_timezone: z
    .string()
    .min(1, 'Timezone is required')
    .optional(),
  critical_alerts_only: z.boolean().optional(),
}).refine(
  (data) => {
    // If quiet hours are enabled, start and end times are required
    if (data.quiet_hours_enabled) {
      return data.quiet_hours_start && data.quiet_hours_end && data.quiet_hours_timezone;
    }
    return true;
  },
  {
    message: 'When quiet hours are enabled, start time, end time, and timezone are required',
    path: ['quiet_hours_enabled'],
  }
);

// ─── Combined User Preferences Schema ───────────────────────────────────────

export const fullUserPreferencesUpdateSchema = userPreferencesUpdateSchema.merge(quietHoursUpdateSchema);

// ─── Timezone Validation ────────────────────────────────────────────────────

export const timezoneSchema = z.string().refine(
  (tz) => {
    try {
      // Test if timezone is valid by trying to create a date with it
      new Date().toLocaleString('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  {
    message: 'Invalid timezone. Please use a valid IANA timezone identifier (e.g., America/New_York, Europe/London)',
  }
);

// Update the quiet hours schema to use proper timezone validation
export const quietHoursUpdateSchemaWithValidation = quietHoursUpdateSchema.extend({
  quiet_hours_timezone: timezoneSchema.optional(),
});