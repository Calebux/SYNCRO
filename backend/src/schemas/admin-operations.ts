import { z } from 'zod';

export const mfaCodeSchema = z.object({
  mfaCode: z.string().min(6, 'MFA code must be at least 6 characters').max(32),
});

export const confirmTokenSchema = z.object({
  confirmToken: z.string().min(32, 'Confirm token is invalid').max(256),
});

export const settlementFlushScopeSchema = z.enum([
  'all_pending',
  'single_user',
  'single_channel',
]);

export const settlementFlushConfirmSchema = z.object({
  scope: settlementFlushScopeSchema,
  userId: z.string().uuid().optional(),
  channelId: z.string().uuid().optional(),
});

export const settlementFlushExecuteSchema = settlementFlushConfirmSchema.merge(confirmTokenSchema).merge(mfaCodeSchema);

export const channelCloseConfirmSchema = z.object({
  channelId: z.string().uuid(),
  unilateral: z.boolean().default(false),
  reason: z.string().max(500).optional(),
});

export const channelCloseExecuteSchema = channelCloseConfirmSchema.merge(confirmTokenSchema).merge(mfaCodeSchema);

export const reservationInspectSchema = z.object({
  reservationId: z.string().uuid(),
  mfaCode: z.string().min(6).max(32),
});

export const deadLetterReplayConfirmSchema = z.object({
  deadLetterId: z.string().uuid(),
});

export const deadLetterReplayExecuteSchema = deadLetterReplayConfirmSchema.merge(confirmTokenSchema).merge(mfaCodeSchema);

export const degradedProviderSchema = z.enum([
  'database',
  'redis',
  'rpc_horizon',
  'providers',
  'fx_provider',
  'queue',
  'scheduler',
]);

export const degradedModeToggleConfirmSchema = z.object({
  provider: degradedProviderSchema,
  forcedStatus: z.enum(['healthy', 'degraded', 'unhealthy']),
  ttlHours: z.coerce.number().int().min(1).max(168).default(24),
});

export const degradedModeToggleExecuteSchema = degradedModeToggleConfirmSchema.merge(confirmTokenSchema).merge(mfaCodeSchema);
