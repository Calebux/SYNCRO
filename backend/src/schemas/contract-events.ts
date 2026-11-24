import { z } from 'zod';

const contractEventPayloadSchema = z.object({
  schema_version: z.number().int().positive().optional(),
});

export const renewalSuccessSchema = contractEventPayloadSchema.extend({
  sub_id: z.number(),
});

export const renewalFailedSchema = contractEventPayloadSchema.extend({
  sub_id: z.number(),
  failure_count: z.number(),
});

export const stateTransitionSchema = contractEventPayloadSchema.extend({
  sub_id: z.number(),
  new_state: z.enum(['Active', 'Retrying', 'Failed']),
});

export const approvalCreatedSchema = contractEventPayloadSchema.extend({
  sub_id: z.number(),
  approval_id: z.string(),
  max_spend: z.string(),
  expires_at: z.string(),
});

export const approvalRejectedSchema = contractEventPayloadSchema.extend({
  sub_id: z.number(),
  approval_id: z.string(),
  reason: z.string(),
});

export const executorAssignedSchema = contractEventPayloadSchema.extend({
  sub_id: z.number(),
  executor: z.string(),
});

export const executorRemovedSchema = contractEventPayloadSchema.extend({
  sub_id: z.number(),
});

export const duplicateRenewalRejectedSchema = contractEventPayloadSchema.extend({
  sub_id: z.number(),
  cycle_id: z.string(),
});

export const lifecycleTimestampUpdatedSchema = contractEventPayloadSchema.extend({
  sub_id: z.number(),
  event_kind: z.number(),
  timestamp: z.string(),
});

export const contractEventSchema = z.object({
  type: z.string(),
  ledger: z.number(),
  txHash: z.string(),
  contractId: z.string(),
  topics: z.array(z.string()),
  value: z.union([
    renewalSuccessSchema,
    renewalFailedSchema,
    stateTransitionSchema,
    approvalCreatedSchema,
    approvalRejectedSchema,
    executorAssignedSchema,
    executorRemovedSchema,
    duplicateRenewalRejectedSchema,
    lifecycleTimestampUpdatedSchema,
  ]),
});

export const rpcEventResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.number(),
  result: z.object({
    events: z.array(contractEventSchema).optional(),
  }).optional(),
});
