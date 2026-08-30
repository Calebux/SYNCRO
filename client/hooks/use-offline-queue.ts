/**
 * useOfflineQueue Hook
 * 
 * Manages the durable offline mutation queue, exposing queue state
 * and operations for UI integration.
 */

'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  type QueuedMutation,
  type MutationOperation,
  createQueuedMutation,
  isExpired,
} from '@/lib/sync/mutation-queue'
import {
  initQueueStore,
  queueMutation,
  getPendingMutations,
  getAllQueuedMutations,
  updateQueuedMutation,
  removeQueuedMutation,
  clearExpiredMutations,
} from '@/lib/sync/queue-store'
import {
  processAllQueuedMutations,
  resolveConflict,
} from '@/lib/sync/queue-processor'
import { useApi } from './use-api'

export interface UseOfflineQueueResult {
  // State
  isOnline: boolean
  isProcessing: boolean
  pendingMutations: QueuedMutation[]
  allMutations: QueuedMutation[]
  conflictMutations: QueuedMutation[]
  expiredMutations: QueuedMutation[]
  
  // Operations
  queueOperation: (operation: MutationOperation) => Promise<string | null>
  processPendingQueue: () => Promise<void>
  discardMutation: (id: string) => Promise<void>
  resolveConflictMutation: (id: string, action: 'accept-server' | 'retry' | 'discard') => Promise<void>
  clearExpired: () => Promise<void>
  
  // Diagnostics
  getQueueStats: () => {
    total: number
    pending: number
    inFlight: number
    resolved: number
    conflict: number
    failed: number
    expired: number
  }
}

const PROCESS_QUEUE_INTERVAL = 30 * 1000 // Try every 30 seconds when online
const CLEANUP_INTERVAL = 5 * 60 * 1000 // Clean up expired mutations every 5 minutes

export function useOfflineQueue(): UseOfflineQueueResult {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )
  const [isProcessing, setIsProcessing] = useState(false)
  const [allMutations, setAllMutations] = useState<QueuedMutation[]>([])
  const processIntervalRef = useRef<NodeJS.Timeout>()
  const cleanupIntervalRef = useRef<NodeJS.Timeout>()
  const { post, put, delete: deleteApi } = useApi()

  // Initialize queue store on mount
  useEffect(() => {
    initQueueStore().catch(console.error)

    const loadMutations = async () => {
      const result = await getAllQueuedMutations()
      if (result.success && result.data) {
        setAllMutations(result.data)
      }
    }

    loadMutations()
  }, [])

  // Handle online/offline transitions
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      // Trigger queue processing when coming back online
      processPendingQueue()
    }

    const handleOffline = () => {
      setIsOnline(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // Auto-process queue periodically when online
  useEffect(() => {
    if (isOnline && !isProcessing) {
      // Process immediately
      processPendingQueue()

      // Then set up periodic processing
      processIntervalRef.current = setInterval(() => {
        processPendingQueue()
      }, PROCESS_QUEUE_INTERVAL)
    }

    return () => {
      if (processIntervalRef.current) {
        clearInterval(processIntervalRef.current)
      }
    }
  }, [isOnline, isProcessing])

  // Periodic cleanup of expired mutations
  useEffect(() => {
    cleanupIntervalRef.current = setInterval(() => {
      clearExpired()
    }, CLEANUP_INTERVAL)

    return () => {
      if (cleanupIntervalRef.current) {
        clearInterval(cleanupIntervalRef.current)
      }
    }
  }, [])

  // Queue a new operation
  const queueOperation = useCallback(
    async (operation: MutationOperation): Promise<string | null> => {
      try {
        const mutation = createQueuedMutation(operation)
        const result = await queueMutation(mutation)

        if (result.success) {
          // Update local state
          setAllMutations((prev) => [...prev, mutation])
          return mutation.id
        }

        console.error('Failed to queue mutation:', result.error)
        return null
      } catch (error) {
        console.error('Error queuing mutation:', error)
        return null
      }
    },
    []
  )

  // Process all pending mutations
  const processPendingQueue = useCallback(async () => {
    if (isProcessing || !isOnline) return

    setIsProcessing(true)

    try {
      const result = await getPendingMutations()
      const pending = result.success ? result.data || [] : []

      if (pending.length === 0) {
        setIsProcessing(false)
        return
      }

      // Build API client object
      const apiClient = {
        post: async (path: string, data: Record<string, unknown>) => {
          try {
            const response = await post(path, data)
            return response
          } catch (error) {
            return {
              status: 500,
              data: null,
              error: error instanceof Error ? error.message : 'Unknown error',
            }
          }
        },
        put: async (path: string, data: Record<string, unknown>) => {
          try {
            const response = await put(path, data)
            return response
          } catch (error) {
            return {
              status: 500,
              data: null,
              error: error instanceof Error ? error.message : 'Unknown error',
            }
          }
        },
        delete: async (path: string) => {
          try {
            const response = await deleteApi(path)
            return response
          } catch (error) {
            return {
              status: 500,
              data: null,
              error: error instanceof Error ? error.message : 'Unknown error',
            }
          }
        },
      }

      // Process all pending mutations
      await processAllQueuedMutations(pending, apiClient)

      // Reload all mutations to update state
      const reloadResult = await getAllQueuedMutations()
      if (reloadResult.success && reloadResult.data) {
        setAllMutations(reloadResult.data)
      }
    } catch (error) {
      console.error('Error processing queue:', error)
    } finally {
      setIsProcessing(false)
    }
  }, [isOnline, isProcessing, post, put, deleteApi])

  // Discard a mutation
  const discardMutation = useCallback(async (id: string) => {
    try {
      await removeQueuedMutation(id)
      setAllMutations((prev) => prev.filter((m) => m.id !== id))
    } catch (error) {
      console.error('Error discarding mutation:', error)
    }
  }, [])

  // Resolve a conflict
  const resolveConflictMutation = useCallback(
    async (id: string, action: 'accept-server' | 'retry' | 'discard') => {
      try {
        const mutation = allMutations.find((m) => m.id === id)
        if (!mutation) return

        const resolved = await resolveConflict(mutation, action)
        await updateQueuedMutation(resolved)
        setAllMutations((prev) =>
          prev.map((m) => (m.id === id ? resolved : m))
        )

        // If retry, process queue again
        if (action === 'retry' && isOnline) {
          processPendingQueue()
        }
      } catch (error) {
        console.error('Error resolving conflict:', error)
      }
    },
    [allMutations, isOnline, processPendingQueue]
  )

  // Clear expired mutations
  const clearExpired = useCallback(async () => {
    try {
      await clearExpiredMutations()
      const result = await getAllQueuedMutations()
      if (result.success && result.data) {
        setAllMutations(result.data)
      }
    } catch (error) {
      console.error('Error clearing expired mutations:', error)
    }
  }, [])

  // Computed state
  const pendingMutations = allMutations.filter((m) => m.status === 'pending')
  const conflictMutations = allMutations.filter((m) => m.status === 'conflict')
  const expiredMutations = allMutations.filter((m) => isExpired(m))

  const getQueueStats = useCallback(() => {
    return {
      total: allMutations.length,
      pending: allMutations.filter((m) => m.status === 'pending').length,
      inFlight: allMutations.filter((m) => m.status === 'in-flight').length,
      resolved: allMutations.filter((m) => m.status === 'resolved').length,
      conflict: allMutations.filter((m) => m.status === 'conflict').length,
      failed: allMutations.filter((m) => m.status === 'failed').length,
      expired: expiredMutations.length,
    }
  }, [allMutations])

  return {
    isOnline,
    isProcessing,
    pendingMutations,
    allMutations,
    conflictMutations,
    expiredMutations,
    queueOperation,
    processPendingQueue,
    discardMutation,
    resolveConflictMutation,
    clearExpired,
    getQueueStats,
  }
}
