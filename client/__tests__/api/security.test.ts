/**
 * API Security Tests - Issue #493
 * Tests for authentication, authorization, and ownership checks
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createClient } from '@/lib/supabase/server'

// Mock user IDs for testing
const USER_A_ID = 'user-a-uuid'
const USER_B_ID = 'user-b-uuid'

// Helper to create test subscription
async function createTestSubscription(userId: string) {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('subscriptions')
        .insert({
            user_id: userId,
            name: 'Test Subscription',
            category: 'Testing',
            price: 9.99,
            status: 'active',
        })
        .select()
        .single()

    if (error) throw error
    return data
}

// Helper to create test tag
async function createTestTag(userId: string) {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('subscription_tags')
        .insert({
            user_id: userId,
            name: 'Test Tag',
            color: '#6366f1',
        })
        .select()
        .single()

    if (error) throw error
    return data
}

// Helper to create test payment
async function createTestPayment(userId: string) {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('payments')
        .insert({
            user_id: userId,
            transaction_id: `test-txn-${Date.now()}`,
            amount: 100,
            currency: 'USD',
            status: 'succeeded',
        })
        .select()
        .single()

    if (error) throw error
    return data
}

describe('API Security - Authentication', () => {
    describe('Unauthenticated Access', () => {
        it('should reject GET /api/subscriptions without auth', async () => {
            const response = await fetch('/api/subscriptions')
            expect(response.status).toBe(401)
            const data = await response.json()
            expect(data.success).toBe(false)
            expect(data.error.code).toBe('UNAUTHORIZED')
        })

        it('should reject POST /api/subscriptions without auth', async () => {
            const response = await fetch('/api/subscriptions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: 'Netflix',
                    category: 'Streaming',
                    price: 15.99,
                }),
            })
            expect(response.status).toBe(401)
        })

        it('should reject GET /api/tags without auth', async () => {
            const response = await fetch('/api/tags')
            expect(response.status).toBe(401)
        })

        it('should reject GET /api/analytics without auth', async () => {
            const response = await fetch('/api/analytics')
            expect(response.status).toBe(401)
        })

        it('should reject POST /api/payments without auth', async () => {
            const response = await fetch('/api/payments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amount: 100,
                    currency: 'USD',
                    token: 'test-token',
                    planName: 'Pro',
                }),
            })
            expect(response.status).toBe(401)
        })
    })

    describe('Public Endpoints', () => {
        it('should allow GET /api/health without auth', async () => {
            const response = await fetch('/api/health')
            expect(response.status).toBe(200)
            const data = await response.json()
            expect(data.success).toBe(true)
            expect(data.data.status).toBe('healthy')
        })

        it('should allow GET /api/health/live without auth', async () => {
            const response = await fetch('/api/health/live')
            expect(response.status).toBe(200)
        })

        it('should allow GET /api/health/ready without auth', async () => {
            const response = await fetch('/api/health/ready')
            expect(response.status).toBe(200)
        })

        it('should allow POST /api/csp-report without auth', async () => {
            const response = await fetch('/api/csp-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    'csp-report': {
                        'document-uri': 'https://example.com',
                        'violated-directive': 'script-src',
                    },
                }),
            })
            expect(response.status).toBe(200)
        })
    })
})

describe('API Security - Ownership Checks', () => {
    let userASubscription: any
    let userBSubscription: any
    let userATag: any
    let userBTag: any

    beforeEach(async () => {
        // Create test data for both users
        userASubscription = await createTestSubscription(USER_A_ID)
        userBSubscription = await createTestSubscription(USER_B_ID)
        userATag = await createTestTag(USER_A_ID)
        userBTag = await createTestTag(USER_B_ID)
    })

    describe('Subscription Ownership', () => {
        it('should prevent User B from deleting User A subscription', async () => {
            const response = await fetch(`/api/subscriptions/${userASubscription.id}`, {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${getUserBToken()}`,
                },
            })
            expect(response.status).toBe(403)
            const data = await response.json()
            expect(data.error.code).toBe('FORBIDDEN')
        })

        it('should prevent User B from updating User A subscription', async () => {
            const response = await fetch(`/api/subscriptions/${userASubscription.id}`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${getUserBToken()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: 'Hacked Name' }),
            })
            expect(response.status).toBe(403)
        })

        it('should allow User A to delete their own subscription', async () => {
            const response = await fetch(`/api/subscriptions/${userASubscription.id}`, {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${getUserAToken()}`,
                },
            })
            expect(response.status).toBe(200)
        })

        it('should allow User A to update their own subscription', async () => {
            const response = await fetch(`/api/subscriptions/${userASubscription.id}`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${getUserAToken()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: 'Updated Name' }),
            })
            expect(response.status).toBe(200)
        })
    })

    describe('Tag Assignment Ownership - CRITICAL', () => {
        it('should prevent User B from assigning tags to User A subscription', async () => {
            const response = await fetch(`/api/subscriptions/${userASubscription.id}/tags`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${getUserBToken()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ tag_id: userBTag.id }),
            })
            expect(response.status).toBe(403)
            const data = await response.json()
            expect(data.error.code).toBe('FORBIDDEN')
            expect(data.error.message).toContain('do not own')
        })

        it('should prevent User A from assigning User B tag to their subscription', async () => {
            const response = await fetch(`/api/subscriptions/${userASubscription.id}/tags`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${getUserAToken()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ tag_id: userBTag.id }),
            })
            expect(response.status).toBe(403)
            const data = await response.json()
            expect(data.error.message).toContain('do not own')
        })

        it('should allow User A to assign their own tag to their subscription', async () => {
            const response = await fetch(`/api/subscriptions/${userASubscription.id}/tags`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${getUserAToken()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ tag_id: userATag.id }),
            })
            expect(response.status).toBe(200)
        })
    })

    describe('Tag Removal Ownership - CRITICAL', () => {
        beforeEach(async () => {
            // Assign tag to subscription for removal tests
            const supabase = await createClient()
            await supabase
                .from('subscription_tag_assignments')
                .insert({
                    subscription_id: userASubscription.id,
                    tag_id: userATag.id,
                })
        })

        it('should prevent User B from removing tags from User A subscription', async () => {
            const response = await fetch(
                `/api/subscriptions/${userASubscription.id}/tags/${userATag.id}`,
                {
                    method: 'DELETE',
                    headers: {
                        Authorization: `Bearer ${getUserBToken()}`,
                    },
                }
            )
            expect(response.status).toBe(403)
            const data = await response.json()
            expect(data.error.code).toBe('FORBIDDEN')
        })

        it('should allow User A to remove tags from their subscription', async () => {
            const response = await fetch(
                `/api/subscriptions/${userASubscription.id}/tags/${userATag.id}`,
                {
                    method: 'DELETE',
                    headers: {
                        Authorization: `Bearer ${getUserAToken()}`,
                    },
                }
            )
            expect(response.status).toBe(200)
        })
    })

    describe('Notes Update Ownership - CRITICAL', () => {
        it('should prevent User B from updating notes on User A subscription', async () => {
            const response = await fetch(`/api/subscriptions/${userASubscription.id}/notes`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${getUserBToken()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ notes: 'Hacked notes' }),
            })
            expect(response.status).toBe(403)
        })

        it('should allow User A to update notes on their subscription', async () => {
            const response = await fetch(`/api/subscriptions/${userASubscription.id}/notes`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${getUserAToken()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ notes: 'My notes' }),
            })
            expect(response.status).toBe(200)
        })
    })

    describe('Tag Ownership', () => {
        it('should prevent User B from deleting User A tag', async () => {
            const response = await fetch(`/api/tags/${userATag.id}`, {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${getUserBToken()}`,
                },
            })
            expect(response.status).toBe(403)
        })

        it('should allow User A to delete their own tag', async () => {
            const response = await fetch(`/api/tags/${userATag.id}`, {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${getUserAToken()}`,
                },
            })
            expect(response.status).toBe(200)
        })
    })
})

describe('API Security - Payment Refund Ownership - CRITICAL', () => {
    let userAPayment: any
    let userBPayment: any

    beforeEach(async () => {
        userAPayment = await createTestPayment(USER_A_ID)
        userBPayment = await createTestPayment(USER_B_ID)
    })

    it('should prevent User B from refunding User A payment', async () => {
        const response = await fetch('/api/payments/refund', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${getUserBToken()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ transactionId: userAPayment.transaction_id }),
        })
        expect(response.status).toBe(403)
        const data = await response.json()
        expect(data.error.code).toBe('FORBIDDEN')
    })

    it('should allow User A to refund their own payment', async () => {
        const response = await fetch('/api/payments/refund', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${getUserAToken()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ transactionId: userAPayment.transaction_id }),
        })
        expect(response.status).toBe(200)
    })

    it('should prevent refunding already refunded payment', async () => {
        // First refund
        await fetch('/api/payments/refund', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${getUserAToken()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ transactionId: userAPayment.transaction_id }),
        })

        // Attempt second refund
        const response = await fetch('/api/payments/refund', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${getUserAToken()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ transactionId: userAPayment.transaction_id }),
        })
        expect(response.status).toBe(400)
        const data = await response.json()
        expect(data.error.message).toContain('already been refunded')
    })
})

describe('API Security - Rate Limiting', () => {
    it('should rate limit excessive subscription creation', async () => {
        const requests = Array(100).fill(null).map(() =>
            fetch('/api/subscriptions', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${getUserAToken()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: 'Test Sub',
                    category: 'Test',
                    price: 9.99,
                }),
            })
        )

        const responses = await Promise.all(requests)
        const rateLimited = responses.filter(r => r.status === 429)
        expect(rateLimited.length).toBeGreaterThan(0)
    })

    it('should rate limit CSV imports', async () => {
        const csvContent = 'name,price,currency,billing_cycle,next_renewal,category\nTest,9.99,USD,monthly,2025-05-01,Test'
        const blob = new Blob([csvContent], { type: 'text/csv' })
        const formData = new FormData()
        formData.append('file', blob, 'test.csv')

        const requests = Array(10).fill(null).map(() =>
            fetch('/api/subscriptions/import?commit=true', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${getUserAToken()}`,
                },
                body: formData,
            })
        )

        const responses = await Promise.all(requests)
        const rateLimited = responses.filter(r => r.status === 429)
        expect(rateLimited.length).toBeGreaterThan(0)
    })

    it('should rate limit payment refunds', async () => {
        const requests = Array(20).fill(null).map(() =>
            fetch('/api/payments/refund', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${getUserAToken()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ transactionId: 'test-txn' }),
            })
        )

        const responses = await Promise.all(requests)
        const rateLimited = responses.filter(r => r.status === 429)
        expect(rateLimited.length).toBeGreaterThan(0)
    })
})

describe('API Security - Invalid Resource IDs', () => {
    it('should return 404 for non-existent subscription', async () => {
        const response = await fetch('/api/subscriptions/00000000-0000-0000-0000-000000000000', {
            method: 'DELETE',
            headers: {
                Authorization: `Bearer ${getUserAToken()}`,
            },
        })
        expect(response.status).toBe(404)
        const data = await response.json()
        expect(data.error.message).toContain('not found')
    })

    it('should return 404 for non-existent tag', async () => {
        const response = await fetch('/api/tags/00000000-0000-0000-0000-000000000000', {
            method: 'DELETE',
            headers: {
                Authorization: `Bearer ${getUserAToken()}`,
            },
        })
        expect(response.status).toBe(404)
    })

    it('should return 404 for non-existent payment refund', async () => {
        const response = await fetch('/api/payments/refund', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${getUserAToken()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ transactionId: 'non-existent-txn' }),
        })
        expect(response.status).toBe(404)
    })
})

// Helper functions to get mock tokens
function getUserAToken(): string {
    // In real tests, this would return a valid JWT for User A
    return 'mock-user-a-token'
}

function getUserBToken(): string {
    // In real tests, this would return a valid JWT for User B
    return 'mock-user-b-token'
}
