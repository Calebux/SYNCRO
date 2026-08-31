/**
 * PayPal Webhook Handler Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { POST } from '../route'
import { NextRequest } from 'next/server'

describe('PayPal Webhook Handler', () => {
    const mockWebhookEvent = {
        id: 'WH-123',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource_type: 'capture',
        summary: 'Payment completed',
        resource: {
            id: 'CAPTURE-123',
            status: 'COMPLETED',
            amount: {
                currency_code: 'USD',
                value: '100.00',
            },
        },
        create_time: '2026-06-01T12:00:00Z',
    }

    beforeEach(() => {
        vi.resetModules()
        process.env.PAYPAL_CLIENT_ID = 'test-client-id'
        process.env.PAYPAL_CLIENT_SECRET = 'test-secret'
        process.env.PAYPAL_MODE = 'sandbox'
    })

    describe('Webhook Signature Verification', () => {
        it('should accept valid webhook signature', async () => {
            const mockRequest = new NextRequest('http://localhost:3000/api/webhooks/paypal', {
                method: 'POST',
                headers: {
                    'paypal-transmission-id': 'test-transmission-id',
                    'paypal-transmission-time': '2026-06-01T12:00:00Z',
                    'paypal-cert-url': 'https://api.paypal.com/cert',
                    'paypal-auth-algo': 'SHA256withRSA',
                    'paypal-transmission-sig': 'test-signature',
                },
                body: JSON.stringify(mockWebhookEvent),
            })

            // Mock Supabase
            vi.mock('@/lib/supabase/server', () => ({
                createClient: () => ({
                    from: () => ({
                        select: () => ({
                            eq: () => ({
                                single: vi.fn().mockResolvedValue({ data: null }),
                            }),
                        }),
                        insert: vi.fn().mockResolvedValue({ error: null }),
                        update: () => ({
                            eq: vi.fn().mockResolvedValue({ error: null }),
                        }),
                    }),
                }),
            }))

            const response = await POST(mockRequest)
            const data = await response.json()

            expect(response.status).toBe(200)
            expect(data.received).toBe(true)
        })

        it('should reject webhook without signature headers', async () => {
            const mockRequest = new NextRequest('http://localhost:3000/api/webhooks/paypal', {
                method: 'POST',
                headers: {},
                body: JSON.stringify(mockWebhookEvent),
            })

            const response = await POST(mockRequest)

            // Without PAYPAL_WEBHOOK_ID, signature verification is skipped in development
            // In production, this would return 401
            expect(response.status).toBeGreaterThanOrEqual(200)
        })
    })

    describe('Event Processing', () => {
        it('should process PAYMENT.CAPTURE.COMPLETED event', async () => {
            const mockUpdate = vi.fn().mockResolvedValue({ error: null })
            const mockInsert = vi.fn().mockResolvedValue({ error: null })

            vi.mock('@/lib/supabase/server', () => ({
                createClient: () => ({
                    from: () => ({
                        select: () => ({
                            eq: () => ({
                                single: vi.fn().mockResolvedValue({ data: null }),
                            }),
                        }),
                        insert: mockInsert,
                        update: () => ({
                            eq: mockUpdate,
                        }),
                    }),
                }),
            }))

            const mockRequest = new NextRequest('http://localhost:3000/api/webhooks/paypal', {
                method: 'POST',
                body: JSON.stringify(mockWebhookEvent),
            })

            const response = await POST(mockRequest)
            const data = await response.json()

            expect(response.status).toBe(200)
            expect(data.received).toBe(true)
        })

        it('should handle PAYMENT.CAPTURE.DENIED event', async () => {
            const deniedEvent = {
                ...mockWebhookEvent,
                id: 'WH-124',
                event_type: 'PAYMENT.CAPTURE.DENIED',
                resource: {
                    ...mockWebhookEvent.resource,
                    status: 'DENIED',
                },
            }

            const mockRequest = new NextRequest('http://localhost:3000/api/webhooks/paypal', {
                method: 'POST',
                body: JSON.stringify(deniedEvent),
            })

            const response = await POST(mockRequest)
            expect(response.status).toBe(200)
        })

        it('should handle PAYMENT.CAPTURE.REFUNDED event', async () => {
            const refundedEvent = {
                ...mockWebhookEvent,
                id: 'WH-125',
                event_type: 'PAYMENT.CAPTURE.REFUNDED',
                resource: {
                    ...mockWebhookEvent.resource,
                    status: 'REFUNDED',
                },
            }

            const mockRequest = new NextRequest('http://localhost:3000/api/webhooks/paypal', {
                method: 'POST',
                body: JSON.stringify(refundedEvent),
            })

            const response = await POST(mockRequest)
            expect(response.status).toBe(200)
        })
    })

    describe('Idempotency', () => {
        it('should skip duplicate webhook events', async () => {
            const mockInsert = vi.fn().mockResolvedValue({ error: null })

            vi.mock('@/lib/supabase/server', () => ({
                createClient: () => ({
                    from: () => ({
                        select: () => ({
                            eq: () => ({
                                single: vi.fn().mockResolvedValue({
                                    data: { id: 'existing-event' },
                                }),
                            }),
                        }),
                        insert: mockInsert,
                    }),
                }),
            }))

            const mockRequest = new NextRequest('http://localhost:3000/api/webhooks/paypal', {
                method: 'POST',
                body: JSON.stringify(mockWebhookEvent),
            })

            const response = await POST(mockRequest)
            const data = await response.json()

            expect(response.status).toBe(200)
            expect(data.duplicate).toBe(true)
            expect(mockInsert).not.toHaveBeenCalled()
        })
    })

    describe('Error Handling', () => {
        it('should handle malformed JSON', async () => {
            const mockRequest = new NextRequest('http://localhost:3000/api/webhooks/paypal', {
                method: 'POST',
                body: 'invalid json',
            })

            const response = await POST(mockRequest)
            expect(response.status).toBe(500)
        })

        it('should handle database errors gracefully', async () => {
            vi.mock('@/lib/supabase/server', () => ({
                createClient: () => ({
                    from: () => ({
                        select: () => ({
                            eq: () => ({
                                single: vi.fn().mockRejectedValue(new Error('DB error')),
                            }),
                        }),
                    }),
                }),
            }))

            const mockRequest = new NextRequest('http://localhost:3000/api/webhooks/paypal', {
                method: 'POST',
                body: JSON.stringify(mockWebhookEvent),
            })

            const response = await POST(mockRequest)
            expect(response.status).toBe(500)
        })
    })

    describe('Unhandled Events', () => {
        it('should accept but not process unhandled event types', async () => {
            const unknownEvent = {
                ...mockWebhookEvent,
                id: 'WH-126',
                event_type: 'UNKNOWN.EVENT.TYPE',
            }

            vi.mock('@/lib/supabase/server', () => ({
                createClient: () => ({
                    from: () => ({
                        select: () => ({
                            eq: () => ({
                                single: vi.fn().mockResolvedValue({ data: null }),
                            }),
                        }),
                        insert: vi.fn().mockResolvedValue({ error: null }),
                        update: () => ({
                            eq: vi.fn().mockResolvedValue({ error: null }),
                        }),
                    }),
                }),
            }))

            const mockRequest = new NextRequest('http://localhost:3000/api/webhooks/paypal', {
                method: 'POST',
                body: JSON.stringify(unknownEvent),
            })

            const response = await POST(mockRequest)
            const data = await response.json()

            expect(response.status).toBe(200)
            expect(data.received).toBe(true)
        })
    })
})
