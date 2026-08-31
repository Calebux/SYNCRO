import { z } from 'zod';

export const verifyRecoveryCodeSchema = z.object({
  code: z
    .string()
    .min(1, 'code is required')
    .max(50, 'code must not exceed 50 characters'),
});

export const mfaNotifySchema = z.object({
  event: z.enum(['enrolled', 'disabled'], {
    errorMap: () => ({ message: "event must be 'enrolled' or 'disabled'" }),
  }),
});

export const requireTwoFaSchema = z.object({
  required: z.boolean({
    required_error: 'required (boolean) is required',
    invalid_type_error: 'required must be a boolean',
  }),
});
