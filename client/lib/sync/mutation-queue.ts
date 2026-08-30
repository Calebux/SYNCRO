/**
 * Durable Mutation Queue
 * 
 * Replays offline mutations through the same API client as online mutations,
 * ensuring all auth, validation, and middleware apply identically.
 * 
 * Operations are queued durably in IndexedDB with explicit conflict resolution
 * and user-visible status tracking.
 */

import { z } from 'zod'

export type MutationStatus = 'pending' | 'in-flight' | 'resolved' | 'conflict' | 'failed' | 'expired'
export type ConflictResolution = 'last-write-wins' | 'merge' | 'user-prompt'

/**
 * Mutation operation - same typed structure as normal API calls
 */
export const mutationOperationSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('create'),
    resource: z.literal('subscription'),
    payload: z.record(z.string(), z.unknown()),
  }),
  z.object({
    operation: z.literal('update'),
    resource: z.literal('subscription'),
    id: z.string().min(1),
    version: z.number().int().nonnegative().optional(),
    payload: z.record(z.string(), z.unknown()),
  }),
  z.object({
    operation: z.literal('delete'),
    resource: z.literal('subscription'),
    id: z.string().min(1),
  }),
])

export type MutationOperation = z.infer<typeof mutationOperationSchema>

/**
 * Queued mutation with metadata for replay and conflict resolution
 */
export interface QueuedMutation {
  id: string
  operation: MutationOperation
  status: MutationStatus
  
  // Metadata
  queuedAt: string
  expiresAt: string
  attempts: number
  maxAttempts: number
  
  // Conflict tracking
  conflictDetails?: {
    serverVersion?: number
    clientVersion?: number
    serverData?: Record<string, unknown>
    resolvedData?: Record<string, unknown>
  }
  conflictResolution: ConflictResolution
  
  // Results
  result?: {
    status: number
    data?: Record<string, unknown>
    error?: string
  }
}

/**
 * Queue configuration for different operation types
 */
export const QUEUE_CONFIG: Record<string, {
  maxAttempts: number
  ttlMs: number
  conflictResolution: ConflictResolution
}> = {
  'create:subscription': {
    maxAttempts: 5,
    ttlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
    conflictResolution: 'last-write-wins',
  },
  'update:subscription': {
    maxAttempts: 5,
    ttlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
    conflictResolution: 'last-write-wins',
  },
  'delete:subscription': {
    maxAttempts: 5,
    ttlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
    conflictResolution: 'last-write-wins',
  },
}

export function getQueueConfig(operation: MutationOperation) {
  const key = `${operation.operation}:${operation.resource}`
  return QUEUE_CONFIG[key] || QUEUE_CONFIG['create:subscription']
}

export function createQueuedMutation(
  operation: MutationOperation,
  conflictResolution: ConflictResolution = 'last-write-wins'
): QueuedMutation {
  const config = getQueueConfig(operation)
  const now = new Date()
  
  return {
    id: crypto.randomUUID(),
    operation,
    status: 'pending',
    queuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + config.ttlMs).toISOString(),
    attempts: 0,
    maxAttempts: config.maxAttempts,
    conflictResolution,
  }
}

export function isExpired(mutation: QueuedMutation): boolean {
  return new Date(mutation.expiresAt) < new Date()
}

export function canRetry(mutation: QueuedMutation): boolean {
  return mutation.status === 'failed' && mutation.attempts < mutation.maxAttempts && !isExpired(mutation)
}
