import { z } from 'zod';

const VALID_SCOPES = [
  'subscriptions:read',
  'subscriptions:write',
  'webhooks:write',
  'analytics:read',
] as const;

export const createApiKeySchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must not exceed 100 characters')
    .default('default'),
  scopes: z
    .array(
      z.enum(VALID_SCOPES, {
        errorMap: () => ({ message: `scope must be one of: ${VALID_SCOPES.join(', ')}` }),
      }),
    )
    .min(1, 'At least one valid scope is required')
    .max(4, 'Maximum 4 scopes'),
});

export { VALID_SCOPES };
