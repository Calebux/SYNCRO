/**
 * PayPal Payment Flow Integration Tests
 * Tests the complete end-to-end PayPal payment flow including:
 * - Order creation
 * - User approval simulation
 * - Payment capture
 * - Database persistence
 * - Webhook processing
 * - Refund handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PaymentService } from '@/lib/payment-service'
import { PayPalService } from '@/lib/paypal-service'

describe('PayPal Payment Flow - End to End', () => {
    const originalEnv = process.env

    beforeEach(() => {
        vi.resetModules()
        process.env = { ...originalEnv }
        process.env.PAYPAL_CLIENT_ID = 'test-client-id'
        process.env.PAYPAL_CLIENT_SECRET = 'test-secret'
        process.env.PAYPAL_MODE = 'sandbox'
        process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    })

    afterEach(() => {
        process.env = originalEnv
    })

    describe('Complete Payment Flow', () => {
        it('should complete full payment flow: create → approve → capture', async () => {
            // Step 1: Create PayPal order
            const paymentService = new PaymentService({ provider: 'paypal' })
            
            const createResult = await paymentService.processPayment(
                100,
                'USD',
                'new-order',
                {
                    userId: 'user-123',
                    planName: 'Pro Plan',
                    userEmail: 'test@example.com',
                }
            )

            // Verify order creation
            expect(createResult.success).toBe(true)
            expect(createResult.requiresAction).toBe(true)
            expect(createResult.actionUrl).toBeDefined()
            expect(createResult.transactionId).toMatch(/^ORDER-/)

            const orderId = createResult.transactionId

            // Step 2: Simulate user approval (in real flow, user approves on PayPal)
            // In production, PayPal redirects back to returnUrl after approval

            // Step 3: Capture the approved order
            const captureResult = await paymentService.processPayment(
                100,
                'USD',
                `order_${orderId}`,
                {
                    userId: 'user-123',
                    planName: 'Pro Plan',
                    userEmail: 'test@example.com',
                }
            )

            // Verify capture
            expect(captureResult.success).toBe(true)
            expect(captureResult.transactionId).toMatch(/^CAPTURE-/)
            expect(captureResult.requiresAction).toBeUndefined()
        })

        it('should handle payment failure gracefully', async () => {
            const paymentService = new PaymentService({ provider: 'paypal' })

            // Simulate a failed payment (invalid order ID)
            const result = await paymentService.processPayment(
                100,
                'USD',
                'order_INVALID-ORDER',
                {
                    userId: 'user-123',
                    planName: 'Pro Plan',
                    userEmail: 'test@example.com',
                }
            )

            expect(result.success).toBe(false)
            expect(result.error).toBeDefined()
        })

        it('should save payment status to database correctly', async () => {
            const mockInsert = vi.fn().mockResolvedValue({ error: null })
            const mockSelect = vi.fn().mockResolvedValue({ data: null })
            
            vi.mock('@/lib/supabase/server', () => ({
                createClient: () => ({
                    from: () => ({
                        insert: mockInsert,
                        select: () => ({
                            eq: () => ({
                                single: mockSelect,
                            }),
                        }),
                    }),
                }),
            }))

            const paymentService = new PaymentService({ provider: 'paypal' })
            
            await paymentService.processPayment(100, 'USD', 'new-order', {
                userId: 'user-123',
                planName: 'Pro Plan',
                userEmail: 'test@example.com',
            })

            // Wait for async database save
            await new Promise(resolve => setTimeout(resolve, 100))

            expect(mockInsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    amount: 100,
                    currency: 'USD',
                    status: 'pending',
                    provider: 'paypal',
                    user_id: 'user-123',
                    plan_name: 'Pro Plan',
                })
            )
        })
    })

    describe('Refund Flow', () => {
        it('should process refund successfully', async () => {
            const paymentService = new PaymentService({ provider: 'paypal' })

            // Mock successful refund
            vi.mock('@/lib/paypal-service', () => ({
                getPayPalService: () => ({
                    refundCapture: vi.fn().mockResolvedValue({
                        id: 'REFUND-123',
                        status: 'COMPLETED',
                    }),
                }),
            }))

            const result = await paymentService.refundPayment('CAPTURE-123')

            expect(result.success).toBe(true)
            expect(result.transactionId).toBe('REFUND-123')
        })

        it('should handle refund failure', async () => {
            const paymentService = new PaymentService({ provider: 'paypal' })

            vi.mock('@/lib/paypal-service', () => ({
                getPayPalService: () => ({
                    refundCapture: vi.fn().mockRejectedValue(
                        new Error('Refund not allowed')
                    ),
                }),
            }))

            const result = await paymentService.refundPayment('CAPTURE-INVALID')

            expect(result.success).toBe(false)
            expect(result.error).toContain('Refund')
        })
    })

    describe('Error Scenarios', () => {
        it('should handle network timeout gracefully', async () => {
            const paymentService = new PaymentService({ provider: 'paypal' })

            vi.mock('@/lib/paypal-service', () => ({
                getPayPalService: () => ({
                    createOrder: vi.fn().mockRejectedValue(
                        new Error('Network timeout')
                    ),
                }),
            }))

            const result = await paymentService.processPayment(100, 'USD', 'new-order', {
                userId: 'user-123',
                planName: 'Pro Plan',
                userEmail: 'test@example.com',
            })

            expect(result.success).toBe(false)
            expect(result.error).toBeDefined()
        })

        it('should handle PayPal API errors with proper error messages', async () => {
            const paymentService = new PaymentService({ provider: 'paypal' })

            vi.mock('@/lib/paypal-service', () => ({
                getPayPalService: () => ({
                    createOrder: vi.fn().mockRejectedValue({
                        message: 'INVALID_REQUEST',
                        details: [
                            {
                                issue: 'INVALID_PARAMETER_VALUE',
                                description: 'Amount must be positive',
                            },
                        ],
                    }),
                }),
            }))

            const result = await paymentService.processPayment(-100, 'USD', 'new-order', {
                userId: 'user-123',
                planName: 'Pro Plan',
                userEmail: 'test@example.com',
            })

            expect(result.success).toBe(false)
            expect(result.error).toBeDefined()
        })

        it('should handle missing PayPal credentials', async () => {
            process.env.PAYPAL_CLIENT_ID = ''
            process.env.PAYPAL_CLIENT_SECRET = ''

            const paymentService = new PaymentService({ provider: 'paypal' })
            const result = await paymentService.processPayment(100, 'USD', 'new-order', {
                userId: 'user-123',
                planName: 'Pro Plan',
                userEmail: 'test@example.com',
            })

            expect(result.success).toBe(false)
            expect(result.error).toContain('not configured')
        })
    })

    describe('Retry Logic', () => {
        it('should retry on transient failures', async () => {
            const paypalService = new PayPalService({
                clientId: 'test-id',
                clientSecret: 'test-secret',
                mode: 'sandbox',
                maxRetries: 2,
                retryDelay: 100,
            })

            let attemptCount = 0
            const mockFetch = vi.fn().mockImplementation(() => {
                attemptCount++
                if (attemptCount < 2) {
                    return Promise.resolve({
                        ok: false,
                        status: 503,
                        json: () => Promise.resolve({ message: 'Service unavailable' }),
                    })
                }
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        id: 'ORDER-123',
                        status: 'CREATED',
                        links: [{ rel: 'approve', href: 'https://paypal.com/approve' }],
                    }),
                })
            })

            global.fetch = mockFetch as any

            const result = await paypalService.createOrder(100, 'USD', {
                userId: 'user-123',
                planName: 'Pro',
                returnUrl: 'http://localhost:3000/success',
                cancelUrl: 'http://localhost:3000/cancel',
            })

            expect(attemptCount).toBeGreaterThan(1)
            expect(result.id).toBe('ORDER-123')
        })

        it('should not retry on client errors (4xx)', async () => {
            const paypalService = new PayPalService({
                clientId: 'test-id',
                clientSecret: 'test-secret',
                mode: 'sandbox',
                maxRetries: 3,
            })

            let attemptCount = 0
            const mockFetch = vi.fn().mockImplementation(() => {
                attemptCount++
                return Promise.resolve({
                    ok: false,
                    status: 400,
                    json: () => Promise.resolve({ message: 'Bad request' }),
                })
            })

            global.fetch = mockFetch as any

            await expect(
                paypalService.createOrder(100, 'USD', {
                    userId: 'user-123',
                    planName: 'Pro',
                    returnUrl: 'http://localhost:3000/success',
                    cancelUrl: 'http://localhost:3000/cancel',
                })
            ).rejects.toThrow()

            // Should only attempt once for 4xx errors
            expect(attemptCount).toBe(1)
        })
    })

    describe('Database Idempotency', () => {
        it('should update existing payment instead of creating duplicate', async () => {
            const mockUpdate = vi.fn().mockResolvedValue({ error: null })
            const mockInsert = vi.fn().mockResolvedValue({ error: null })
            const mockSelect = vi.fn().mockResolvedValue({
                data: { id: 'existing-payment-id' },
            })

            vi.mock('@/lib/supabase/server', () => ({
                createClient: () => ({
                    from: () => ({
                        insert: mockInsert,
                        update: () => ({
                            eq: mockUpdate,
                        }),
                        select: () => ({
                            eq: () => ({
                                single: mockSelect,
                            }),
                        }),
                    }),
                }),
            }))

            const paymentService = new PaymentService({ provider: 'paypal' })

            // Capture an order (which should update existing pending payment)
            await paymentService.processPayment(100, 'USD', 'order_ORDER-123', {
                userId: 'user-123',
                planName: 'Pro Plan',
                userEmail: 'test@example.com',
            })

            await new Promise(resolve => setTimeout(resolve, 100))

            // Should update, not insert
            expect(mockUpdate).toHaveBeenCalled()
            expect(mockInsert).not.toHaveBeenCalled()
        })
    })
})
