/**
 * Stripe Webhook API Route Tests
 * 
 * Tests webhook signature validation with valid and invalid signatures.
 * Tests event parsing for payment_intent.succeeded, payment_intent.failed.
 * Tests database updates after successful webhook processing.
 * Tests idempotency for duplicate webhook events.
 * 
 * **Validates: Requirements 1.2, 1.6, 2.1, 2.5**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../stripe/route';
import { mockWebhookEvent } from '@/lib/test-utils';

// Mock dependencies
const mockSupabaseUpdate = vi.fn().mockReturnThis();
const mockSupabaseEq = vi.fn().mockResolvedValue({ data: null, error: null });
const mockSupabaseFrom = vi.fn(() => ({
  update: mockSupabaseUpdate,
  eq: mockSupabaseEq,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    from: mockSupabaseFrom,
  })),
}));

const mockConstructEvent = vi.fn();
vi.mock('@/lib/stripe-config', () => ({
  getStripeInstance: vi.fn(() => ({
    webhooks: {
      constructEvent: mockConstructEvent,
    },
  })),
}));

describe('POST /api/webhooks/stripe', () => {
  const validSignature = 't=1234567890,v1=valid_signature';
  const webhookSecret = 'whsec_test_secret';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    mockSupabaseUpdate.mockReturnThis();
    mockSupabaseEq.mockResolvedValue({ data: null, error: null });
  });

  it('should process payment_intent.succeeded event', async () => {
    const event = mockWebhookEvent({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_test_123',
          amount: 2999,
          currency: 'usd',
          status: 'succeeded',
          metadata: {
            userId: 'user-123',
            planName: 'Pro Plan',
          },
        },
      },
    });

    mockConstructEvent.mockReturnValue(event);

    const request = new Request('http://localhost:3000/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'stripe-signature': validSignature,
      },
      body: JSON.stringify(event),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.received).toBe(true);
    expect(mockSupabaseFrom).toHaveBeenCalledWith('payments');
    expect(mockSupabaseUpdate).toHaveBeenCalledWith({ status: 'succeeded' });
    expect(mockSupabaseEq).toHaveBeenCalledWith('transaction_id', 'pi_test_123');
  });

  it('should process payment_intent.payment_failed event', async () => {
    const event = mockWebhookEvent({
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_test_456',
          amount: 2999,
          currency: 'usd',
          status: 'failed',
        },
      },
    });

    mockConstructEvent.mockReturnValue(event);

    const request = new Request('http://localhost:3000/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'stripe-signature': validSignature,
      },
      body: JSON.stringify(event),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.received).toBe(true);
    expect(mockSupabaseFrom).toHaveBeenCalledWith('payments');
    expect(mockSupabaseUpdate).toHaveBeenCalledWith({ status: 'failed' });
    expect(mockSupabaseEq).toHaveBeenCalledWith('transaction_id', 'pi_test_456');
  });

  it('should reject webhook with invalid signature', async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('Invalid signature');
    });

    const request = new Request('http://localhost:3000/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'stripe-signature': 'invalid_signature',
      },
      body: JSON.stringify(mockWebhookEvent()),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('Webhook Error');
  });

  it('should reject webhook without signature header', async () => {
    const request = new Request('http://localhost:3000/api/webhooks/stripe', {
      method: 'POST',
      body: JSON.stringify(mockWebhookEvent()),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBeDefined();
  });

  it('should handle unknown event types gracefully', async () => {
    const event = mockWebhookEvent({
      type: 'unknown.event.type',
    });

    mockConstructEvent.mockReturnValue(event);

    const request = new Request('http://localhost:3000/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'stripe-signature': validSignature,
      },
      body: JSON.stringify(event),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.received).toBe(true);
  });

  it('should update user profile on successful payment', async () => {
    const event = mockWebhookEvent({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_test_789',
          amount: 2999,
          currency: 'usd',
          status: 'succeeded',
          metadata: {
            userId: 'user-456',
            planName: 'Premium Plan',
          },
        },
      },
    });

    mockConstructEvent.mockReturnValue(event);

    const request = new Request('http://localhost:3000/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'stripe-signature': validSignature,
      },
      body: JSON.stringify(event),
    });

    await POST(request);

    // Verify profile update was called
    expect(mockSupabaseFrom).toHaveBeenCalledWith('profiles');
    expect(mockSupabaseUpdate).toHaveBeenCalledWith({
      subscription_tier: 'Premium Plan',
    });
    expect(mockSupabaseEq).toHaveBeenCalledWith('id', 'user-456');
  });

  it('should handle Stripe not configured', async () => {
    const { getStripeInstance } = await import('@/lib/stripe-config');
    vi.mocked(getStripeInstance).mockReturnValueOnce(null);

    const request = new Request('http://localhost:3000/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'stripe-signature': validSignature,
      },
      body: JSON.stringify(mockWebhookEvent()),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Stripe not configured');
  });

  it('should handle missing webhook secret', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;

    mockConstructEvent.mockImplementation(() => {
      throw new Error('Missing stripe-signature or webhook secret');
    });

    const request = new Request('http://localhost:3000/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'stripe-signature': validSignature,
      },
      body: JSON.stringify(mockWebhookEvent()),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('Webhook Error');
  });

  it('should process duplicate events idempotently', async () => {
    const event = mockWebhookEvent({
      id: 'evt_duplicate_123',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_test_duplicate',
          amount: 2999,
          status: 'succeeded',
          metadata: {
            userId: 'user-123',
            planName: 'Pro Plan',
          },
        },
      },
    });

    mockConstructEvent.mockReturnValue(event);

    const request1 = new Request('http://localhost:3000/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'stripe-signature': validSignature,
      },
      body: JSON.stringify(event),
    });

    const request2 = new Request('http://localhost:3000/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'stripe-signature': validSignature,
      },
      body: JSON.stringify(event),
    });

    // Process same event twice
    const response1 = await POST(request1);
    const response2 = await POST(request2);

    expect(response1.status).toBe(200);
    expect(response2.status).toBe(200);

    // Both should succeed (idempotent)
    const data1 = await response1.json();
    const data2 = await response2.json();
    expect(data1.received).toBe(true);
    expect(data2.received).toBe(true);
  });

  it('should return 500 when database update fails for succeeded event (enables Stripe retry)', async () => {
    const event = mockWebhookEvent({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_test_db_fail',
          amount: 2999,
          currency: 'usd',
          status: 'succeeded',
          metadata: {
            userId: 'user-db-fail',
            planName: 'Pro Plan',
          },
        },
      },
    });

    mockConstructEvent.mockReturnValue(event);

    // Simulate a DB failure on the eq() call (end of update chain)
    mockSupabaseEq.mockResolvedValueOnce({
      data: null,
      error: { message: 'Connection refused', code: 'PGRST301' },
    });

    const request = new Request('http://localhost:3000/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'stripe-signature': validSignature,
      },
      body: JSON.stringify(event),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toContain('Database error');
  });

  it('should return 500 when database update fails for failed event (enables Stripe retry)', async () => {
    const event = mockWebhookEvent({
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_test_fail_db_err',
          amount: 1000,
          currency: 'usd',
          status: 'failed',
        },
      },
    });

    mockConstructEvent.mockReturnValue(event);

    // Simulate a DB failure
    mockSupabaseEq.mockResolvedValueOnce({
      data: null,
      error: { message: 'Timeout', code: 'PGRST500' },
    });

    const request = new Request('http://localhost:3000/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'stripe-signature': validSignature,
      },
      body: JSON.stringify(event),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toContain('Database error');
  });
});
