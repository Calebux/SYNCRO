import { z } from 'zod';

export const simulationQuerySchema = z.object({
  days: z.coerce
    .number()
    .int('Days must be an integer')
    .min(1, 'Days must be at least 1')
    .max(365, 'Days must not exceed 365')
    .default(30),
  balance: z.coerce.number().optional(),
});
