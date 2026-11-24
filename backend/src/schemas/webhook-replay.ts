import { z } from 'zod';

const providerSchema = z.enum(['stripe', 'paypal', 'paystack', 'telegram']);

/**
 * Identify the stored event either by its row id, or by the provider's own
 * (provider, event id) pair — which is what an operator reading a provider
 * dashboard actually has to hand.
 */
export const replayWebhookBodySchema = z
  .object({
    recordId: z.string().uuid().optional(),
    provider: providerSchema.optional(),
    eventId: z.string().min(1).max(255).optional(),
    reason: z.string().max(500).optional(),
  })
  .refine(
    (value) => Boolean(value.recordId) || Boolean(value.provider && value.eventId),
    { message: 'Provide either recordId, or both provider and eventId' },
  );

export type ReplayWebhookBody = z.infer<typeof replayWebhookBodySchema>;

export const listWebhookEventsQuerySchema = z.object({
  provider: providerSchema.optional(),
  status: z.enum(['pending', 'processing', 'processed', 'failed', 'dead_letter']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type ListWebhookEventsQuery = z.infer<typeof listWebhookEventsQuerySchema>;
