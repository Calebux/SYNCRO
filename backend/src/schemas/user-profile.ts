import { z } from 'zod';

export const userProfileUpdateSchema = z.object({
  display_name: z.string().min(1, 'Display name must not be empty').max(200).optional(),
  company_name: z.string().max(200).optional(),
  stealth_meta_address: z.string().max(1024).optional(),
});
