import { z } from 'zod';

export const deleteAccountSchema = z.object({
  reason: z.string().max(1000, 'Reason must not exceed 1000 characters').optional(),
});

const KNOWN_OPT_IN_KEYS = ['reminders', 'marketing', 'updates', 'digests'] as const;

export const emailPreferencesSchema = z
  .object({
    reminders: z.boolean().optional(),
    marketing: z.boolean().optional(),
    updates: z.boolean().optional(),
    digests: z.boolean().optional(),
    token: z.string().max(500).optional(),
  })
  .refine(
    (data) => {
      // At least one opt-in key must be present (token alone is not enough)
      return KNOWN_OPT_IN_KEYS.some((key) => data[key] !== undefined);
    },
    {
      message: `At least one preference key is required: ${KNOWN_OPT_IN_KEYS.join(', ')}`,
    },
  );

export { KNOWN_OPT_IN_KEYS };
