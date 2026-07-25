import { z } from 'zod';

export const createShareInviteSchema = z.object({
  expiry: z.enum(['1h', '24h', '7d', '30d']).default('7d'),
  maxUses: z.union([z.literal(1), z.literal(-1)]).default(1),
  permissionLevel: z.enum(['view-only', 'can-renew', 'full-access']).default('view-only'),
});

export const acceptShareInviteSchema = z.object({});

export type CreateShareInviteInput = z.infer<typeof createShareInviteSchema>;
