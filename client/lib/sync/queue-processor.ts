/**
 * Mutation Queue Processor
 * 
 * Replays queued mutations through the normal API client,
 * ensuring all auth, validation, and middleware apply.
 */

import type { QueuedMutation, MutationOperation } from './mutation-queue'
import { isExpired, canRetry } from './mutation-queue'
import {
  updateQueuedMutation,
  removeQueuedMutation,
} from './queue-store'

interface ProcessResult {
  success: boolean
  mutation: QueuedMutation
  error?: string
}

type ApiClient = {
  post: (path: string, data: Record<string, unknown>) => Promise<{ status: number; data: unknown; error?: string }>
  put: (path: string, data: Record<string, unknown>) => Promise<{ status: number; data: unknown; error?: string }>
  delete: (path: string) => Promise<{ status: number; data: unknown; error?: string }>
}

/**
 * Build API call from queued mutation operation
 */
function buildApiCall(operation: MutationOperation): {
  method: 'post' | 'put' | 'delete'
  path: string
  body?: Record<string, unknown>
} {
  switch (operation.operation) {
    case 'create':
      return {
        method: 'post',
        path: `/api/subscriptions`,
        body: operation.payload,
      }
    
    case 'update':
      return {
        method: 'put',
        path: `/api/subscriptions/${operation.id}`,
        body: operation.payload,
      }
    
    case 'delete':
      return {
        method: 'delete',
        path: `/api/subscriptions/${operation.id}`,
      }
  }
}

/**
 * Process a single queued mutation
 * Replays it through the normal API client
 */
export async function processQueuedMutation(
  mutation: QueuedMutation,
  apiClient: ApiClient
): Promise<ProcessResult> {
  // Check if mutation has expired
  if (isExpired(mutation)) {
    const expired = { ...mutation, status: 'expired' as const }
    await updateQueuedMutation(expired)
    return {
      success: false,
      mutation: expired,
      error: 'Mutation expired',
    }
  }

  // Check if we can still retry
  if (mutation.status === 'failed' && !canRetry(mutation)) {
    return {
      success: false,
      mutation,
      error: 'Max retries exceeded',
    }
  }

  // Build API call from operation
  const apiCall = buildApiCall(mutation.operation)
  
  // Update status to in-flight
  const inFlight = {
    ...mutation,
    status: 'in-flight' as const,
    attempts: mutation.attempts + 1,
  }
  await updateQueuedMutation(inFlight)

  try {
    let response: Awaited<ReturnType<ApiClient['post'] | ApiClient['put'] | ApiClient['delete']>>
    
    switch (apiCall.method) {
      case 'post':
        response = await apiClient.post(apiCall.path, apiCall.body!)
        break
      case 'put':
        response = await apiClient.put(apiCall.path, apiCall.body!)
        break
      case 'delete':
        response = await apiClient.delete(apiCall.path)
        break
    }

    // Handle different response statuses
    if (response.status >= 200 && response.status < 300) {
      // Success
      const resolved = {
        ...mutation,
        status: 'resolved' as const,
        result: {
          status: response.status,
          data: response.data as Record<string, unknown>,
        },
      }
      await updateQueuedMutation(resolved)
      return { success: true, mutation: resolved }
    } else if (response.status === 409) {
      // Conflict - user needs to decide
      const conflict = {
        ...mutation,
        status: 'conflict' as const,
        result: {
          status: response.status,
          error: 'Conflict detected',
        },
        conflictDetails: (response.data as any)?.details,
      }
      await updateQueuedMutation(conflict)
      return {
        success: false,
        mutation: conflict,
        error: 'Conflict detected - user intervention required',
      }
    } else if (response.status >= 400 && response.status < 500) {
      // Client error - permanent failure
      const failed = {
        ...mutation,
        status: 'failed' as const,
        result: {
          status: response.status,
          error: response.error || `HTTP ${response.status}`,
        },
      }
      await updateQueuedMutation(failed)
      return {
        success: false,
        mutation: failed,
        error: `Client error: ${response.error || response.status}`,
      }
    } else {
      // Server error - retry
      const failed = {
        ...mutation,
        status: 'failed' as const,
        result: {
          status: response.status,
          error: response.error || `HTTP ${response.status}`,
        },
      }
      await updateQueuedMutation(failed)
      return {
        success: false,
        mutation: failed,
        error: `Server error: ${response.error || response.status}`,
      }
    }
  } catch (err) {
    // Network or other error - retry
    const failed = {
      ...mutation,
      status: 'failed' as const,
      result: {
        status: 0,
        error: err instanceof Error ? err.message : 'Unknown error',
      },
    }
    await updateQueuedMutation(failed)
    return {
      success: false,
      mutation: failed,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

/**
 * Process all pending mutations from the queue
 */
export async function processAllQueuedMutations(
  mutations: QueuedMutation[],
  apiClient: ApiClient
): Promise<ProcessResult[]> {
  const results: ProcessResult[] = []
  
  // Process mutations in order (FIFO)
  for (const mutation of mutations) {
    const result = await processQueuedMutation(mutation, apiClient)
    results.push(result)
    
    // Continue processing on conflict or permanent failure,
    // but allow early exit on network errors
    if (!result.success && result.error?.includes('Unknown error')) {
      break
    }
  }

  return results
}

/**
 * Handle conflict resolution
 */
export async function resolveConflict(
  mutation: QueuedMutation,
  action: 'accept-server' | 'retry' | 'discard'
): Promise<QueuedMutation> {
  switch (action) {
    case 'accept-server':
      // Drop this mutation, server state is authoritative
      return {
        ...mutation,
        status: 'resolved',
        result: {
          status: 200,
          error: 'Discarded due to server conflict',
        },
      }
    
    case 'retry':
      // Reset to pending for retry
      return {
        ...mutation,
        status: 'pending',
        attempts: 0,
      }
    
    case 'discard':
      // Permanently discard
      return {
        ...mutation,
        status: 'failed',
        result: {
          status: 409,
          error: 'User discarded conflicting mutation',
        },
      }
  }
}
