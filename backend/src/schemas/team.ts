import { z } from 'zod';

const VALID_ROLES = ['admin', 'member', 'viewer'] as const;

export const inviteTeamSchema = z.object({
  email: z
    .string()
    .email('Must be a valid email address')
    .max(254, 'Email must not exceed 254 characters'),
  role: z
    .enum(VALID_ROLES, {
      errorMap: () => ({ message: `role must be one of: ${VALID_ROLES.join(', ')}` }),
    })
    .default('member'),
});

export const updateRoleSchema = z.object({
  role: z.enum(VALID_ROLES, {
    errorMap: () => ({ message: `role must be one of: ${VALID_ROLES.join(', ')}` }),
  }),
});
