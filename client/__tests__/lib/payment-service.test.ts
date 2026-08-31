/**
 * Payment Service Tests
 * Tests for Stripe, PayPal, and Mock payment processing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PaymentService } from '@/lib/payment-service'

// Mock environment variables
const originalEnv = process.env

beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
})

afterEach(() => {
    process.env = originalEnv
})

describe('PaymentService', () => {
    describe('Feature Flag Validation', () => {
        it('should reject disabled payment providers', async () => {
            // Disable all providers
            process.env.STRIPE_SECRET_KEY = ''
            process.env.PAYPAL_CLIENT_ID = ''
            process.env.PAYPAL_CLIENT_SECRET = ''
            process.env.NODE_ENV = 'production'
            process.env.ENABLE_MOCK_PAYMENTS = 'false'

            const service = new PaymentService({ provider: 'stripe' })
            const result = await service.processPayment(100, 'USD', 'test-token', {
                userId: 'user-123',
                planName: 'Pro',
            })

            expect(result.success).toBe(false)
            expect(result.error).toContain('not enabled')
        })

        it('should allow mock payments in development', async () => {
            process.env.NODE_ENV = 'development'

            const service = new PaymentService({ provider: 'mock' })
            const result = await service.processPayment(100, 'USD', 'test-token', {
                userId: 'user-123',
                planName: 'Pro',
            })

            expect(result.success).toBe(true)
            expect(result.transactionId).toMatch(/^mock_/)
        })

        it('should reject mock payments in production without explicit flag', async () => {
            process.env.NODE_ENV = 'production'
            process.env.ENABLE_MOCK_PAYMENTS = 'false'

            const service = new PaymentService({ provider: 'mock' })
            const result = await service.processPayment(100, 'USD', 'test-token', {
                userId: 'user-123',
                planName: 'Pro',
            })

            expect(result.success).toBe(false)
            expect(result.error).toContain('not enabled')
        })

        it('should reject mock payments in production even when ENABLE_MOCK_PAYMENTS=true', async () => {
            // Production builds must NEVER allow mock mode regardless of env var
            process.env.NODE_ENV = 'production'
            process.env.ENABLE_MOCK_PAYMENTS = 'true'

            const service = new PaymentService({ provider: 'mock' })
            const result = await service.processPayment(100, 'USD', 'test-token', {
                userId: 'user-123',
                planName: 'Pro',
            })

            expect(result.success).toBe(false)
            expect(result.error).toContain('not enabled')
        })

        it('should allow mock payments in test environment', async () => {
            process.env.NODE_ENV = 'test'
            process.env.ENABLE_MOCK_PAYMENTS = 'false'

            const service = new PaymentService({ provider: 'mock' })
            const result = await service.processPayment(100, 'USD', 'test-token', {
                userId: 'user-123',
                planName: 'Pro',
            })

            expect(result.success).toBe(true)
            expect(result.transactionId).toMatch(/^mock_/)
        })
    })

    describe('Stripe Payment Processing', () => {
        it('should process successful Stripe payment', async () => {
            process.env.STRIPE_SECRET_KEY = 'sk_test_123'

            // Mock Stripe
            const mockStripe = {
                paymentIntents: {
                    create: vi.fn().mockResolvedValue({
                        id: 'pi_123',
                        status: 'succeeded',
                    }),
                },
            }

            const service = new PaymentService({ provider: 'stripe' })
            // @ts-ignore - Mock stripe instance
            service['stripe'] = mockStripe

            const result = await service.processPayment(100, 'USD', 'pm_test_123', {
                userId: 'user-123',
                planName: 'Pro',
            })

            expect(result.success).toBe(true)
            expect(result.transactionId).toBe('pi_123')
            expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    amount: 10000, // $100 in cents
                    currency: 'USD',
                    payment_method: 'pm_test_123',
                })
            )
        })

        it('should handle Stripe payment failure', async () => {
            process.env.STRIPE_SECRET_KEY = 'sk_test_123'

            const mockStripe = {
                paymentIntents: {
                    create: vi.fn().mockRejectedValue(new Error('Card declined')),
                },
            }

            const service = new PaymentService({ provider: 'stripe' })
            // @ts-ignore
            service['stripe'] = mockStripe

            const result = await service.processPayment(100, 'USD', 'pm_test_123', {
                userId: 'user-123',
                planName: 'Pro',
            })

            expect(result.success).toBe(false)
            expect(result.error).toBe('Card declined')
        })
    })

    describe('PayPal Payment Processing', () => {
        it('should create PayPal order and return approval URL', async () => {
            process.env.PAYPAL_CLIENT_ID = 'test-client-id'
            process.env.PAYPAL_CLIENT_SECRET = 'test-secret'
            process.env.PAYPAL_MODE = 'sandbox'

            // Mock PayPal service
            vi.mock('@/lib/paypal-service', () => ({
                getPayPalService: () => ({
                    createOrder: vi.fn().mockResolvedValue({
                        id: 'ORDER-123',
                        status: 'CREATED',
                        links: [
                            { rel: 'approve', href: 'https://paypal.com/approve/ORDER-123' },
                        ],
                    }),
                }),
            }))

            const service = new PaymentService({ provider: 'paypal' })
            const result = await service.processPayment(100, 'USD', 'new-order', {
                userId: 'user-123',
                planName: 'Pro',
            })

            expect(result.success).toBe(true)
            expect(result.requiresAction).toBe(true)
            expect(result.actionUrl).toContain('paypal.com')
            expect(result.transactionId).toBe('ORDER-123')
        })

        it('should capture approved PayPal order', async () => {
            process.env.PAYPAL_CLIENT_ID = 'test-client-id'
            process.env.PAYPAL_CLIENT_SECRET = 'test-secret'

            vi.mock('@/lib/paypal-service', () => ({
                getPayPalService: () => ({
                    captureOrder: vi.fn().mockResolvedValue({
                        id: 'ORDER-123',
                        status: 'COMPLETED',
                        purchase_units: [
                            {
                                payments: {
                                    captures: [
                                        {
                                            id: 'CAPTURE-123',
                                            status: 'COMPLETED',
                                            amount: { currency_code: 'USD', value: '100.00' },
                                        },
                                    ],
                                },
                            },
                        ],
                    }),
                }),
            }))

            const service = new PaymentService({ provider: 'paypal' })
            const result = await service.processPayment(100, 'USD', 'order_ORDER-123', {
                userId: 'user-123',
                planName: 'Pro',
            })

            expect(result.success).toBe(true)
            expect(result.transactionId).toBe('CAPTURE-123')
            expect(result.requiresAction).toBeUndefined()
        })

        it('should handle PayPal configuration missing', async () => {
            process.env.PAYPAL_CLIENT_ID = ''
            process.env.PAYPAL_CLIENT_SECRET = ''

            const service = new PaymentService({ provider: 'paypal' })
            const result = await service.processPayment(100, 'USD', 'test-token', {
                userId: 'user-123',
                planName: 'Pro',
            })

            expect(result.success).toBe(false)
            expect(result.error).toContain('not configured')
        })
    })

    describe('Refund Processing', () => {
        it('should process Stripe refund', async () => {
            process.env.STRIPE_SECRET_KEY = 'sk_test_123'

            const mockStripe = {
                refunds: {
                    create: vi.fn().mockResolvedValue({
                        id: 're_123',
                        status: 'succeeded',
                    }),
                },
            }

            const service = new PaymentService({ provider: 'stripe' })
            // @ts-ignore
            service['stripe'] = mockStripe

            const result = await service.refundPayment('pi_123')

            expect(result.success).toBe(true)
            expect(result.transactionId).toBe('re_123')
        })

        it('should process PayPal refund', async () => {
            process.env.PAYPAL_CLIENT_ID = 'test-client-id'
            process.env.PAYPAL_CLIENT_SECRET = 'test-secret'

            vi.mock('@/lib/paypal-service', () => ({
                getPayPalService: () => ({
                    refundCapture: vi.fn().mockResolvedValue({
                        id: 'REFUND-123',
                        status: 'COMPLETED',
                    }),
                }),
            }))

            const service = new PaymentService({ provider: 'paypal' })
            const result = await service.refundPayment('CAPTURE-123')

            expect(result.success).toBe(true)
            expect(result.transactionId).toBe('REFUND-123')
        })

        it('should reject mock refunds in production', async () => {
            process.env.NODE_ENV = 'production'
            process.env.ENABLE_MOCK_PAYMENTS = 'false'

            const service = new PaymentService({ provider: 'mock' })
            const result = await service.refundPayment('mock_123')

            expect(result.success).toBe(false)
            expect(result.error).toContain('not enabled')
        })
    })

    describe('Database Integration', () => {
        it('should save successful payment to database', async () => {
            process.env.NODE_ENV = 'development'

            // Mock Supabase
            const mockInsert = vi.fn().mockResolvedValue({ error: null })
            vi.mock('@/lib/supabase/server', () => ({
                createClient: () => ({
                    from: () => ({
                        insert: mockInsert,
                    }),
                }),
            }))

            const service = new PaymentService({ provider: 'mock' })
            await service.processPayment(100, 'USD', 'test-token', {
                userId: 'user-123',
                planName: 'Pro',
            })

            // Database save is called asynchronously
            await new Promise(resolve => setTimeout(resolve, 100))

            expect(mockInsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    amount: 100,
                    currency: 'USD',
                    status: 'succeeded',
                    provider: 'mock',
                    user_id: 'user-123',
                    plan_name: 'Pro',
                })
            )
        })

        it('should save pending PayPal order to database', async () => {
            process.env.PAYPAL_CLIENT_ID = 'test-client-id'
            process.env.PAYPAL_CLIENT_SECRET = 'test-secret'

            const mockInsert = vi.fn().mockResolvedValue({ error: null })
            vi.mock('@/lib/supabase/server', () => ({
                createClient: () => ({
                    from: () => ({
                        insert: mockInsert,
                    }),
                }),
            }))

            vi.mock('@/lib/paypal-service', () => ({
                getPayPalService: () => ({
                    createOrder: vi.fn().mockResolvedValue({
                        id: 'ORDER-123',
                        links: [{ rel: 'approve', href: 'https://paypal.com/approve' }],
                    }),
                }),
            }))

            const service = new PaymentService({ provider: 'paypal' })
            await service.processPayment(100, 'USD', 'new-order', {
                userId: 'user-123',
                planName: 'Pro',
            })

            await new Promise(resolve => setTimeout(resolve, 100))

            expect(mockInsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'pending',
                    provider: 'paypal',
                })
            )
        })
    })

    describe('Error Handling', () => {
        it('should handle unknown provider gracefully', async () => {
            const service = new PaymentService({ provider: 'unknown' as any })
            const result = await service.processPayment(100, 'USD', 'test-token', {
                userId: 'user-123',
                planName: 'Pro',
            })

            expect(result.success).toBe(false)
            expect(result.error).toContain('Unknown payment provider')
        })

        it('should not fail payment if database save fails', async () => {
            process.env.NODE_ENV = 'development'

            vi.mock('@/lib/supabase/server', () => ({
                createClient: () => ({
                    from: () => ({
                        insert: vi.fn().mockResolvedValue({ error: new Error('DB error') }),
                    }),
                }),
            }))

            const service = new PaymentService({ provider: 'mock' })
            const result = await service.processPayment(100, 'USD', 'test-token', {
                userId: 'user-123',
                planName: 'Pro',
            })

            // Payment should still succeed even if DB save fails
            expect(result.success).toBe(true)
        })
    })
})
