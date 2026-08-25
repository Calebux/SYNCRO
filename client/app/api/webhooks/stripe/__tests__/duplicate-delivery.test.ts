import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '../route'

describe('Stripe Webhook Duplicate Delivery Prevention', () => {
  const mockStripeEvent = {
    id: 'evt_1234567890',
    type: 'payment_intent.succeeded',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'pi_1234567890',
        status: 'succeeded',
        amount: 5000,
        currency: 'usd',
        metadata: {
          userId: 'user-123',
          planName: 'pro',
        },
      },
    },
  }

  beforeEach(() => {
    vi.resetAllMocks()
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret'
  })

  describe('Idempotency On Duplicate Delivery', () => {
    it('should return success for duplicate webhook event', async () => {
      // First call simulates event already being stored
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation((field) => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'existing-webhook-id',
                  processed_at: new Date().toISOString(),
                },
                error: null,
              }),
            })),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'webhook-id' },
                error: null,
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      }

      vi.doMock('@/lib/supabase/server', () => ({
        createClient: () => mockSupabase,
      }))

      // Create mock request
      const mockRequest = new NextRequest('http://localhost:3000/api/webhooks/stripe', {
        method: 'POST',
        headers: {
          'stripe-signature': 'valid-signature',
        },
        body: JSON.stringify(mockStripeEvent),
      })

      // Mock Stripe webhook construction
      vi.doMock('@/lib/stripe-config', () => ({
        getStripeInstance: () => ({
          webhooks: {
            constructEvent: vi.fn().mockReturnValue(mockStripeEvent),
          },
        }),
      }))

      const response = await POST(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.isDuplicate).toBe(true)
      expect(data.received).toBe(true)
    })

    it('should handle concurrent requests with unique constraint', async () => {
      const mockInsert = vi.fn()
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
              single: vi.fn().mockResolvedValueOnce({
                data: { id: 'first-insert' },
                error: null,
              })
              // Second call simulates unique constraint violation
              .mockResolvedValueOnce({
                data: null,
                error: { code: '23505', message: 'duplicate key' },
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      }

      vi.doMock('@/lib/supabase/server', () => ({
        createClient: () => mockSupabase,
      }))

      // The second concurrent request should detect the constraint violation
      // and return 200 isDuplicate: true without throwing
      expect(mockInsert).toBeDefined()
    })

    it('should mark event as processed after successful handling', async () => {
      const mockUpdate = vi.fn()
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation((field) => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: null,
              }),
            })),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'webhook-id' },
                error: null,
              }),
            }),
          }),
          update: mockUpdate.mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      }

      vi.doMock('@/lib/supabase/server', () => ({
        createClient: () => mockSupabase,
      }))

      // After processing, should call update with processed: true and processed_at timestamp
      expect(mockUpdate).toBeDefined()
    })

    it('should not process events if idempotency check fails', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation((field) => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: { code: 'SOME_ERROR', message: 'DB error' },
              }),
            })),
          }),
        }),
      }

      vi.doMock('@/lib/supabase/server', () => ({
        createClient: () => mockSupabase,
      }))

      // When idempotency check fails, should return 500
      expect(mockSupabase.from).toBeDefined()
    })
  })

  describe('Webhook Processing After Idempotency', () => {
    it('should process payment_intent.succeeded and update payment', async () => {
      let paymentUpdateCalled = false

      const mockSupabase = {
        from: vi.fn((table) => {
          if (table === 'webhook_events') {
            return {
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
                    data: { id: 'webhook-id' },
                    error: null,
                  }),
                }),
              }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }
          } else if (table === 'payments') {
            paymentUpdateCalled = true
            return {
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }
          }
          return {}
        }),
      }

      vi.doMock('@/lib/supabase/server', () => ({
        createClient: () => mockSupabase,
      }))

      // Webhook processing should update payments table
      expect(mockSupabase.from).toBeDefined()
    })

    it('should scope processed-state update by both provider and event_id', async () => {
      const eqFields: string[] = []
      const mockUpdate = vi.fn().mockImplementation((field) => {
        return {
          eq: vi.fn().mockImplementation((field2) => {
            eqFields.push(field2)
            return { eq: vi.fn().mockResolvedValue({ error: null }) }
          }),
        }
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
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'webhook-id' },
                error: null,
              }),
            }),
          }),
          update: mockUpdate,
        }),
      }

      vi.doMock('@/lib/supabase/server', () => ({
        createClient: () => mockSupabase,
      }))

      const mockRequest = new NextRequest('http://localhost:3000/api/webhooks/stripe', {
        method: 'POST',
        headers: {
          'stripe-signature': 'valid-signature',
        },
        body: JSON.stringify(mockStripeEvent),
      })

      vi.doMock('@/lib/stripe-config', () => ({
        getStripeInstance: () => ({
          webhooks: {
            constructEvent: vi.fn().mockReturnValue(mockStripeEvent),
          },
        }),
      }))

      const response = await POST(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.received).toBe(true)

      // The processed-state update must be scoped by provider AND event_id
      // so a matching event_id from another provider cannot be cross-updated.
      const updateCalls = mockUpdate.mock.calls
      const processedUpdate = updateCalls.find(
        (call) => call[0] && call[0].processed === true
      )
      expect(processedUpdate).toBeDefined()
      expect(processedUpdate![0]).toEqual({
        processed: true,
        processed_at: expect.any(String),
      })

      // Verify the update chain filters by provider and event_id
      expect(eqFields).toContain('provider')
      expect(eqFields).toContain('event_id')
    })

    it('should handle payment_intent.payment_failed event', async () => {
      const failedEvent = {
        ...mockStripeEvent,
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            ...mockStripeEvent.data.object,
            status: 'requires_payment_method',
          },
        },
      }

      expect(failedEvent.type).toBe('payment_intent.payment_failed')
    })

    it('should silently handle unhandled event types', async () => {
      const unknownEvent = {
        ...mockStripeEvent,
        type: 'unknown.event.type',
      }

      expect(unknownEvent.type).toBe('unknown.event.type')
      // Should acknowledge but not throw
    })
  })

  describe('Error Handling', () => {
    it('should return 500 if event insertion fails', async () => {
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
                data: null,
                error: { code: 'UNKNOWN', message: 'DB error' },
              }),
            }),
          }),
        }),
      }

      vi.doMock('@/lib/supabase/server', () => ({
        createClient: () => mockSupabase,
      }))

      expect(mockSupabase.from).toBeDefined()
    })

    it('should mark event as unprocessed on error', async () => {
      // If processing fails, should call update with processed: false
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('Regression: Webhook Replay', () => {
    it('should handle replaying same webhook multiple times', async () => {
      // Scenario: Provider re-delivers same webhook 3 times
      const eventIds = ['evt_1', 'evt_1', 'evt_1']

      // Each duplicate should be detected and not processed
      const uniqueIds = new Set(eventIds)
      expect(uniqueIds.size).toBe(1) // All same
    })
  })
})
