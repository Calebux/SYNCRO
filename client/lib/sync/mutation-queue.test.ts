import { describe, it, expect } from 'vitest'
import {
  createQueuedMutation,
  isExpired,
  canRetry,
  getQueueConfig,
} from './mutation-queue'
import type { MutationOperation } from './mutation-queue'

describe('mutation-queue', () => {
  describe('createQueuedMutation', () => {
    it('creates a queued mutation with required metadata', () => {
      const operation: MutationOperation = {
        operation: 'create',
        resource: 'subscription',
        payload: { name: 'Netflix', price: 15.99 },
      }

      const mutation = createQueuedMutation(operation)

      expect(mutation.id).toBeTruthy()
      expect(mutation.operation).toEqual(operation)
      expect(mutation.status).toBe('pending')
      expect(mutation.attempts).toBe(0)
      expect(mutation.maxAttempts).toBe(5)
      expect(new Date(mutation.queuedAt)).toBeInstanceOf(Date)
      expect(new Date(mutation.expiresAt)).toBeInstanceOf(Date)
      expect(mutation.conflictResolution).toBe('last-write-wins')
    })

    it('sets expiration to 7 days by default', () => {
      const operation: MutationOperation = {
        operation: 'create',
        resource: 'subscription',
        payload: { name: 'Netflix' },
      }

      const mutation = createQueuedMutation(operation)
      const queuedTime = new Date(mutation.queuedAt).getTime()
      const expireTime = new Date(mutation.expiresAt).getTime()
      const ttlMs = expireTime - queuedTime

      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
      expect(Math.abs(ttlMs - sevenDaysMs)).toBeLessThan(1000) // Allow 1s variance
    })

    it('accepts custom conflict resolution strategy', () => {
      const operation: MutationOperation = {
        operation: 'update',
        resource: 'subscription',
        id: 'sub-123',
        payload: { price: 20 },
      }

      const mutation = createQueuedMutation(operation, 'user-prompt')

      expect(mutation.conflictResolution).toBe('user-prompt')
    })
  })

  describe('isExpired', () => {
    it('returns false for newly created mutations', () => {
      const operation: MutationOperation = {
        operation: 'create',
        resource: 'subscription',
        payload: { name: 'Test' },
      }

      const mutation = createQueuedMutation(operation)
      expect(isExpired(mutation)).toBe(false)
    })

    it('returns true for mutations past expiration date', () => {
      const operation: MutationOperation = {
        operation: 'delete',
        resource: 'subscription',
        id: 'sub-123',
      }

      const mutation = createQueuedMutation(operation)

      // Manually set expiration to past
      mutation.expiresAt = new Date(Date.now() - 1000).toISOString()

      expect(isExpired(mutation)).toBe(true)
    })
  })

  describe('canRetry', () => {
    it('returns false for pending mutations', () => {
      const operation: MutationOperation = {
        operation: 'create',
        resource: 'subscription',
        payload: { name: 'Test' },
      }

      const mutation = createQueuedMutation(operation)
      expect(canRetry(mutation)).toBe(false)
    })

    it('returns true for failed mutations within retry limit', () => {
      const operation: MutationOperation = {
        operation: 'update',
        resource: 'subscription',
        id: 'sub-123',
        payload: { price: 25 },
      }

      const mutation = createQueuedMutation(operation)
      mutation.status = 'failed'
      mutation.attempts = 2
      mutation.maxAttempts = 5

      expect(canRetry(mutation)).toBe(true)
    })

    it('returns false for mutations exceeding max retries', () => {
      const operation: MutationOperation = {
        operation: 'create',
        resource: 'subscription',
        payload: { name: 'Test' },
      }

      const mutation = createQueuedMutation(operation)
      mutation.status = 'failed'
      mutation.attempts = 5
      mutation.maxAttempts = 5

      expect(canRetry(mutation)).toBe(false)
    })

    it('returns false for expired mutations even if under retry limit', () => {
      const operation: MutationOperation = {
        operation: 'create',
        resource: 'subscription',
        payload: { name: 'Test' },
      }

      const mutation = createQueuedMutation(operation)
      mutation.status = 'failed'
      mutation.attempts = 2
      mutation.maxAttempts = 5
      mutation.expiresAt = new Date(Date.now() - 1000).toISOString()

      expect(canRetry(mutation)).toBe(false)
    })
  })

  describe('getQueueConfig', () => {
    it('returns config for known operations', () => {
      const operation: MutationOperation = {
        operation: 'create',
        resource: 'subscription',
        payload: {},
      }

      const config = getQueueConfig(operation)

      expect(config.maxAttempts).toBe(5)
      expect(config.ttlMs).toBe(7 * 24 * 60 * 60 * 1000) // 7 days
      expect(config.conflictResolution).toBe('last-write-wins')
    })

    it('returns same config for all operation types', () => {
      const operations: MutationOperation[] = [
        {
          operation: 'create',
          resource: 'subscription',
          payload: { name: 'Test' },
        },
        {
          operation: 'update',
          resource: 'subscription',
          id: 'sub-123',
          payload: { price: 20 },
        },
        {
          operation: 'delete',
          resource: 'subscription',
          id: 'sub-123',
        },
      ]

      operations.forEach((op) => {
        const config = getQueueConfig(op)
        expect(config.maxAttempts).toBe(5)
        expect(config.conflictResolution).toBe('last-write-wins')
      })
    })
  })
})
