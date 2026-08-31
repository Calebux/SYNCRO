import { z } from 'zod';

export const auditEventSchema = z.object({
  action: z.string().min(1).max(100, 'action must not exceed 100 characters'),
  resource_type: z.string().min(1).max(100, 'resource_type must not exceed 100 characters'),
  resource_id: z.string().max(255, 'resource_id must not exceed 255 characters').optional(),
  user_id: z.string().max(128, 'user_id must not exceed 128 characters').optional(),
  session_id: z.string().max(128, 'session_id must not exceed 128 characters').optional(),
  metadata: z.record(z.unknown()).optional(),
  status: z.enum(['success', 'failure', 'pending']).optional(),
  severity: z.enum(['info', 'warn', 'error', 'critical']).optional(),
  timestamp: z.string().datetime({ offset: true }).optional(),
});

export const auditBatchSchema = z.object({
  events: z
    .array(auditEventSchema)
    .min(1, 'events array must not be empty')
    .max(100, 'maximum 100 events per batch'),
});

/** Query params for the hash-chain verification endpoint (issue #1081). */
export const auditVerifyQuerySchema = z.object({
  startSequence: z.coerce.number().int().min(1).optional(),
  endSequence: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(10000).default(1000),
});

export const auditQuerySchema = z.object({
  action: z.string().max(100).optional(),
  resourceType: z.string().max(100).optional(),
  userId: z.string().max(128).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
});
