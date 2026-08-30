import { z } from 'zod';

/**
 * Validates data against a Zod schema and throws a ValidationError if invalid.
 * Optional location parameter indicates where the data came from (e.g. 'body', 'query').
 */
export function validateRequest<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  
  if (!result.success) {
    throw result.error;
  }
  
  return result.data;
}

