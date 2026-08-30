import { z } from 'zod';
import { safeUrlSchema } from './common';

export const createMerchantSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must not exceed 100 characters'),
  description: z.string().max(500, 'Description must not exceed 500 characters').optional(),
  category: z.string().max(50, 'Category must not exceed 50 characters').optional(),
  website_url: safeUrlSchema.optional(),
  logo_url: safeUrlSchema.optional(),
  support_email: z
    .string()
    .email('Must be a valid email')
    .max(254, 'Email must not exceed 254 characters')
    .optional(),
  country: z.string().max(2, 'Country must be a 2-letter ISO code').optional(),
});

export const updateMerchantSchema = createMerchantSchema.partial();

export const merchantQuerySchema = z.object({
  category: z.string().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
