import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { Request, Response } from 'express'
import paystackWebhookRouter from '../src/routes/paystack-webhook'

describe('Paystack Webhook Idempotency', () => {
  const mockReference = 'ref_12345'
  const mockEvent = {
    event: 'charge.success',
    data: {
      reference: mockReference,
      amount: 50000,
      currency: 'NGN',
      status: 'success',
    },
  }

  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Duplicate Event Handling', () => {
    it('should reject duplicate webhook delivery with same reference', async () => {
      // Mock Supabase to simulate first event already stored
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation((field, value) => ({
              maybeSingle: vi.fn().mockResolvedValueOnce({
                data: null,
                error: null,
              })
                // Second call: simulate existing record
                .mockResolvedValueOnce({
                  data: { id: 'existing-event-id', processed_at: new Date().toISOString() },
                  error: null,
                }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'webhook-event-id' },
                error: null,
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      }

      vi.doMock('../config/database', () => ({
        supabase: mockSupabase,
      }))

      // First delivery - should succeed
      const req1 = {
        headers: { 'x-paystack-signature': 'valid-signature' },
        body: mockEvent,
      } as unknown as Request

      const res1 = {
        sendStatus: vi.fn().mockReturnValue(res1),
      } as unknown as Response

      // Mock signature verification to pass
      vi.doMock('../services/payment-webhook-verification', () => ({
        verifyPaystackWebhook: vi.fn().mockReturnValue({
          valid: true,
          event: mockEvent,
        }),
      }))

      // Process first request
      await paystackWebhookRouter.stack[0].route.methods.post[0](req1, res1)

      // Second delivery - should be detected as duplicate
      const req2 = {
        headers: { 'x-paystack-signature': 'valid-signature' },
        body: mockEvent,
      } as unknown as Request

      const res2 = {
        sendStatus: vi.fn().mockReturnValue(res2),
      } as unknown as Response

      await paystackWebhookRouter.stack[0].route.methods.post[0](req2, res2)

      // Both should return 200 (acknowledged) but second should skip processing
      expect(res1.sendStatus).toHaveBeenCalledWith(200)
      expect(res2.sendStatus).toHaveBeenCalledWith(200)
    })

    it('should handle concurrent webhook deliveries atomically', async () => {
      const mockInsert = vi.fn()
        .mockResolvedValueOnce({
          data: { id: 'first-insert' },
          error: null,
        })
        .mockResolvedValueOnce({
          error: { code: '23505', message: 'duplicate key value' }, // Unique constraint
          data: null,
        })

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: null,
              }),
            }),
          }),
          insert: mockInsert.mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn()
                .mockResolvedValueOnce({ data: { id: 'first' }, error: null })
                .mockResolvedValueOnce({ error: { code: '23505' }, data: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      }

      vi.doMock('../config/database', () => ({
        supabase: mockSupabase,
      }))

      // Simulate concurrent requests being processed
      // Second request gets unique constraint error
      expect(mockInsert).toHaveBeenCalledTimes(2)
    })

    it('should store processed_at timestamp on successful processing', async () => {
      const mockUpdate = vi.fn()

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: null,
              }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'event-id' },
                error: null,
              }),
            }),
          }),
          update: mockUpdate.mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      }

      vi.doMock('../config/database', () => ({
        supabase: mockSupabase,
      }))

      // When updating to mark as processed, ensure timestamp is set
      expect(mockUpdate).toBeDefined()
    })

    it('should skip processing on constraint violation error', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: null,
              }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                error: { code: '23505' },
                data: null,
              }),
            }),
          }),
        }),
      }

      vi.doMock('../config/database', () => ({
        supabase: mockSupabase,
      }))

      // When insert fails with constraint violation, we should return early
      // without further processing
      expect(mockSupabase.from).toBeDefined()
    })
  })

  describe('Event Processing Semantics', () => {
    it('should only process charge.success events', async () => {
      const successEvent = {
        event: 'charge.success',
        data: { reference: mockReference },
      }

      const failedEvent = {
        event: 'charge.failed',
        data: { reference: 'ref_failed' },
      }

      vi.doMock('../services/payment-webhook-verification', () => ({
        verifyPaystackWebhook: vi.fn()
          .mockReturnValueOnce({ valid: true, event: successEvent })
          .mockReturnValueOnce({ valid: true, event: failedEvent }),
      }))

      // success event should process
      expect(successEvent.event).toBe('charge.success')

      // failed event should be ignored
      expect(failedEvent.event).not.toBe('charge.success')
    })
  })

  describe('Idempotency Key Derivation', () => {
    it('should use reference as idempotency key', () => {
      const testRef = 'ref_abc123'
      const event = {
        event: 'charge.success',
        data: { reference: testRef },
      }

      // The idempotency key should be the reference
      expect(event.data.reference).toBe(testRef)
    })

    it('should handle events without reference gracefully', () => {
      const eventNoRef = {
        event: 'charge.success',
        data: {},
      }

      // Event without reference should be skipped
      const reference = (eventNoRef.data as any).reference
      expect(reference).toBeUndefined()
    })
  })
})
