import { z } from 'zod';

// ─── GET /api/subscriptions/suggest ─────────────────────────────────────────
/** Query string for the lightweight category-suggestion endpoint. */
export const suggestCategoryQuerySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Query param "name" is required')
    .max(200, 'name must not exceed 200 characters'),
});

export type SuggestCategoryQuery = z.infer<typeof suggestCategoryQuerySchema>;

// ─── POST /api/subscriptions/:id/reclassify ─────────────────────────────────
/** Body for a single-subscription reclassification. */
export const reclassifyBodySchema = z.object({
  /** Skip the DB classification cache so a fresh LLM call is made. */
  forceRefresh: z.boolean().optional().default(false),
});

export type ReclassifyBody = z.infer<typeof reclassifyBodySchema>;
