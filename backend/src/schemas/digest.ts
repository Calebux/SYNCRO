import { z } from 'zod';

export const updateDigestPreferencesSchema = z.object({
  digestEnabled: z.boolean().optional(),
  digestDay: z.number().int().min(1, 'digestDay must be at least 1').max(28, 'digestDay must not exceed 28').optional(),
  includeYearToDate: z.boolean().optional(),
});
