import { z } from 'zod';

export const deleteAccountSchema = z.object({
  reason: z.string().max(1000, 'Reason must not exceed 1000 characters').optional(),
});
