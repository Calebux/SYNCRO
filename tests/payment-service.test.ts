// tests/payment-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PaymentService, PaymentConfig } from '../client/lib/payment-service'

// Mock Stripe instance
vi.mock('../client/lib/stripe-config', () => ({
  getStripeInstance: vi.fn(),
}))

// Mock randomUUID for deterministic requestId
vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'test-request-id'),
}))

// Mock supabase client to avoid DB calls
vi.mock('../client/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    from: () => ({
      select: () => ({ single: () => ({ data: null }) }),
      insert: () => ({}),
      update: () => ({}),
    }),
  })),
}))

describe('PaymentService Stripe metadata handling', () => {
  let service: PaymentService
  const mockCreate = vi.fn()

  beforeEach(() => {
    vi.resetAllMocks()
    const { getStripeInstance } = require('../client/lib/stripe-config')
    getStripeInstance.mockReturnValue({
      paymentIntents: { create: mockCreate },
    })
    const config: PaymentConfig = { provider: 'stripe' }
    service = new PaymentService(config)
  })

  it('passes allowed metadata and generates requestId', async () => {
    mockCreate.mockResolvedValue({ status: 'succeeded', id: 'pi_123' })
    const metadata = { userId: 'user-1', planName: 'gold', extra: 'secret' }
    const result = await service.processPayment(10, 'usd', 'pm_abc', metadata)
    expect(result.success).toBe(true)
    expect(mockCreate).toHaveBeenCalledOnce()
    const payload = mockCreate.mock.calls[0][0]
    expect(payload.metadata).toEqual({
      userId: 'user-1',
      planName: 'gold',
      requestId: 'test-request-id',
    })
    expect(payload.metadata).not.toHaveProperty('extra')
  })

  it('uses existing requestId if provided', async () => {
    mockCreate.mockResolvedValue({ status: 'succeeded', id: 'pi_456' })
    const metadata = { userId: 'u2', planName: 'silver', requestId: 'existing-id' }
    await service.processPayment(20, 'usd', 'pm_def', metadata)
    const payload = mockCreate.mock.calls[0][0]
    expect(payload.metadata?.requestId).toBe('existing-id')
  })
})
