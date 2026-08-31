import { z } from 'zod';

export const pushSubscribeSchema = z.object({
  endpoint: z
    .string()
    .min(1, 'endpoint is required')
    .max(2000, 'endpoint must not exceed 2000 characters')
    .url('Must be a valid URL'),
  keys: z.object({
    p256dh: z
      .string()
      .min(1, 'p256dh key is required')
      .max(500, 'p256dh must not exceed 500 characters'),
    auth: z
      .string()
      .min(1, 'auth key is required')
      .max(500, 'auth must not exceed 500 characters'),
  }),
  userAgent: z.string().max(500, 'userAgent must not exceed 500 characters').optional(),
});
