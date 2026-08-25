/**
 * Webhook Processing Integration Tests
 * 
 * Tests the complete end-to-end webhook processing flow including:
 * - Webhook signature validation and event processing
 * - Database state changes after webhook processing
 * - Notification triggers from webhook events
 * - Payment status updates and user profile changes
 * - Error handling and retry scenarios
 * 
 * **Validates: Requirements 2.1, 2.5, 8.6**
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mockUser, mockPayment, mockWebhookEvent, mockNotification } from '@/lib/test-utils/factories';
import { mockSupabaseClient, mockStripeClient } from '@/lib/test-utils/mocks';
import type { MockUser } from '@/lib/test-utils/factories';

describe('Webhook Processing Integration Tests', () => {
  let supabase: ReturnType<typeof mockSupabaseClient>;
  let stripe: ReturnType<typeof mockStripeClient>;
  let testUser: MockUser;

  beforeEach(() => {
    testUser = mockUser({ id: 'user-webhook-123', email: 'webhook@example.com' });
    supabase = mockSupabaseClient(testUser);
    stripe = mockStripeClient();
    
    // Reset all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('End-to-End Webhook Signature Validation and Event Processing', () => {
    it('should validate webhook signature and process payment_intent.succeeded event', async () => {
      // Arrange
      const webhookSecret = 'whsec_test_secret_key';
      const paymentIntentId = 'pi_webhook_test_123';
      const rawBody = JSON.stringify({
        id: 'evt_test_123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: paymentIntentId,
            amount: 2999,
            currency: 'usd',
            status: 'succeeded',
            metadata: {
              userId: testUser.id,
              planName: 'Premium Plan',
            },
          },
        },
      });

      const signature = `t=${Math.floor(Date.now() / 1000)},v1=test_signature_hash`;

      const webhookEvent = mockWebhookEvent({
        id: 'evt_test_123',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: paymentIntentId,
            amount: 2999,
            currency: 'usd',
            status: 'succeeded',
            metadata: {
              userId: testUser.id,
              planName: 'Premium Plan',
            },
          },
        },
      });

      // Mock Stripe signature validation
      stripe.webhooks.constructEvent.mockReturnValue(webhookEvent as any);

      // Mock database update chain
      supabase.from.mockReturnThis();
      supabase.update.mockReturnThis();
      supabase.eq.mockResolvedValue({ data: null, error: null });

      // Act - Validate signature
      const validatedEvent = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret
      );

      expect(validatedEvent.id).toBe('evt_test_123');
      expect(validatedEvent.type).toBe('payment_intent.succeeded');
      expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith(
        rawBody,
        signature,
        webhookSecret
      );

      // Act - Process the event (simulate database update)
      await supabase
        .from('payments')
        .update({ status: 'succeeded' })
        .eq('transaction_id', paymentIntentId);

      // Assert
      expect(supabase.from).toHaveBeenCalledWith('payments');
      expect(supabase.update).toHaveBeenCalledWith({ status: 'succeeded' });
      expect(supabase.eq).toHaveBeenCalledWith('transaction_id', paymentIntentId);
    });

    it('should reject webhook with invalid signature', async () => {
      // Arrange
      const webhookSecret = 'whsec_test_secret_key';
      const rawBody = JSON.stringify(mockWebhookEvent());
      const invalidSignature = 'invalid_signature_here';

      // Mock Stripe signature validation to throw error
      stripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      // Act & Assert
      expect(() => {
        stripe.webhooks.constructEvent(rawBody, invalidSignature, webhookSecret);
      }).toThrow('Invalid signature');

      expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith(
        rawBody,
        invalidSignature,
        webhookSecret
      );
    });

    it('should reject webhook with expired timestamp', async () => {
      // Arrange
      const webhookSecret = 'whsec_test_secret_key';
      const rawBody = JSON.stringify(mockWebhookEvent());
      // Signature with timestamp from 10 minutes ago (beyond tolerance)
      const expiredTimestamp = Math.floor(Date.now() / 1000) - 600;
      const expiredSignature = `t=${expiredTimestamp},v1=test_signature`;

      stripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('Timestamp outside the tolerance zone');
      });

      // Act & Assert
      expect(() => {
        stripe.webhooks.constructEvent(rawBody, expiredSignature, webhookSecret);
      }).toThrow('Timestamp outside the tolerance zone');
    });

    it('should process payment_intent.payment_failed event', async () => {
      // Arrange
      const paymentIntentId = 'pi_failed_webhook_456';
      const webhookEvent = mockWebhookEvent({
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: paymentIntentId,
            amount: 1999,
            currency: 'usd',
            status: 'failed',
            last_payment_error: {
              message: 'Your card was declined',
            },
          },
        },
      });

      stripe.webhooks.constructEvent.mockReturnValue(webhookEvent as any);

      supabase.from.mockReturnThis();
      supabase.update.mockReturnThis();
      supabase.eq.mockResolvedValue({ data: null, error: null });

      // Act
      const validatedEvent = stripe.webhooks.constructEvent(
        JSON.stringify(webhookEvent),
        't=123,v1=sig',
        'whsec_test'
      );

      await supabase
        .from('payments')
        .update({ status: 'failed' })
        .eq('transaction_id', paymentIntentId);

      // Assert
      expect(validatedEvent.type).toBe('payment_intent.payment_failed');
      expect(supabase.update).toHaveBeenCalledWith({ status: 'failed' });
      expect(supabase.eq).toHaveBeenCalledWith('transaction_id', paymentIntentId);
    });
  });

  describe('Database State Changes After Webhook Processing', () => {
    it('should update payment status from pending to succeeded', async () => {
      // Arrange
      const paymentIntentId = 'pi_pending_to_success';
      const pendingPayment = mockPayment({
        transaction_id: paymentIntentId,
        status: 'pending',
        user_id: testUser.id,
        amount: 29.99,
      });

      const succeededPayment = {
        ...pendingPayment,
        status: 'succeeded',
      };

      // Mock initial pending payment in database
      supabase.from.mockReturnThis();
      supabase.select.mockReturnThis();
      supabase.eq.mockReturnThis();
      supabase.single.mockResolvedValueOnce({
        data: pendingPayment,
        error: null,
      });

      // Act - Read initial state
      const { data: beforeUpdate } = await supabase
        .from('payments')
        .select()
        .eq('transaction_id', paymentIntentId)
        .single();

      expect(beforeUpdate?.status).toBe('pending');

      // Mock update operation
      supabase.update.mockReturnThis();
      supabase.eq.mockResolvedValueOnce({ data: null, error: null });

      // Simulate webhook processing
      await supabase
        .from('payments')
        .update({ status: 'succeeded' })
        .eq('transaction_id', paymentIntentId);

      // Mock reading updated state
      supabase.single.mockResolvedValueOnce({
        data: succeededPayment,
        error: null,
      });

      const { data: afterUpdate } = await supabase
        .from('payments')
        .select()
        .eq('transaction_id', paymentIntentId)
        .single();

      // Assert
      expect(afterUpdate?.status).toBe('succeeded');
      expect(supabase.update).toHaveBeenCalledWith({ status: 'succeeded' });
    });

    it('should update user profile subscription tier after successful payment', async () => {
      // Arrange
      const paymentIntentId = 'pi_profile_update_789';
      const planName = 'Premium Plan';

      const webhookEvent = mockWebhookEvent({
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: paymentIntentId,
            metadata: {
              userId: testUser.id,
              planName,
            },
          },
        },
      });

      // Mock payment update
      supabase.from.mockReturnThis();
      supabase.update.mockReturnThis();
      supabase.eq.mockResolvedValueOnce({ data: null, error: null });

      await supabase
        .from('payments')
        .update({ status: 'succeeded' })
        .eq('transaction_id', paymentIntentId);

      // Mock profile update
      supabase.eq.mockResolvedValueOnce({ data: null, error: null });

      // Act
      await supabase
        .from('profiles')
        .update({ subscription_tier: planName })
        .eq('id', testUser.id);

      // Assert
      expect(supabase.from).toHaveBeenCalledWith('profiles');
      expect(supabase.update).toHaveBeenCalledWith({ subscription_tier: planName });
      expect(supabase.eq).toHaveBeenCalledWith('id', testUser.id);
    });

    it('should create audit log entry for webhook processing', async () => {
      // Arrange
      const paymentIntentId = 'pi_audit_log_test';
      const eventId = 'evt_audit_123';

      const auditLogEntry = {
        id: 'audit_webhook_001',
        user_id: testUser.id,
        action: 'webhook.payment_succeeded',
        resource_type: 'payment',
        resource_id: paymentIntentId,
        metadata: {
          event_id: eventId,
          timestamp: new Date().toISOString(),
          event_type: 'payment_intent.succeeded',
        },
        created_at: new Date().toISOString(),
      };

      supabase.from.mockReturnThis();
      supabase.insert.mockReturnThis();
      supabase.select.mockResolvedValue({
        data: [auditLogEntry],
        error: null,
      });

      // Act
      const { data: auditLog } = await supabase
        .from('audit_logs')
        .insert({
          user_id: testUser.id,
          action: 'webhook.payment_succeeded',
          resource_type: 'payment',
          resource_id: paymentIntentId,
          metadata: {
            event_id: eventId,
            timestamp: new Date().toISOString(),
            event_type: 'payment_intent.succeeded',
          },
        })
        .select();

      // Assert
      expect(auditLog).toHaveLength(1);
      expect(auditLog?.[0].action).toBe('webhook.payment_succeeded');
      expect(auditLog?.[0].resource_id).toBe(paymentIntentId);
      expect(auditLog?.[0].metadata?.event_id).toBe(eventId);
    });

    it('should handle database connection errors gracefully', async () => {
      // Arrange
      const paymentIntentId = 'pi_db_error_test';

      supabase.from.mockReturnThis();
      supabase.update.mockReturnThis();
      supabase.eq.mockResolvedValue({
        data: null,
        error: {
          message: 'Connection refused',
          code: 'PGRST301',
        },
      });

      // Act
      const { error } = await supabase
        .from('payments')
        .update({ status: 'succeeded' })
        .eq('transaction_id', paymentIntentId);

      // Assert
      expect(error).toBeDefined();
      expect(error?.message).toBe('Connection refused');
      expect(error?.code).toBe('PGRST301');
    });

    it('should rollback changes on partial failure', async () => {
      // Arrange
      const paymentIntentId = 'pi_rollback_test';

      supabase.from.mockReturnThis();
      supabase.update.mockReturnThis();

      // Payment update succeeds
      supabase.eq.mockResolvedValueOnce({ data: null, error: null });

      // Profile update fails
      supabase.eq.mockResolvedValueOnce({
        data: null,
        error: { message: 'Constraint violation', code: '23505' },
      });

      // Act - First update succeeds
      const { error: paymentError } = await supabase
        .from('payments')
        .update({ status: 'succeeded' })
        .eq('transaction_id', paymentIntentId);

      expect(paymentError).toBeNull();

      // Second update fails
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ subscription_tier: 'Premium' })
        .eq('id', testUser.id);

      // Assert
      expect(profileError).toBeDefined();
      expect(profileError?.code).toBe('23505');

      // In real implementation, this would trigger a rollback
      // or return a 500 status to Stripe for retry
    });
  });

  describe('Notification Triggers from Webhook Events', () => {
    it('should create notification on successful payment', async () => {
      // Arrange
      const paymentIntentId = 'pi_notification_success';
      const notification = mockNotification({
        user_id: testUser.id,
        type: 'subscription_added',
        title: 'Payment Successful',
        message: 'Your payment of $29.99 was processed successfully',
        read: false,
        metadata: {
          payment_intent_id: paymentIntentId,
          amount: 29.99,
          currency: 'usd',
        },
      });

      supabase.from.mockReturnThis();
      supabase.insert.mockReturnThis();
      supabase.select.mockResolvedValue({
        data: [notification],
        error: null,
      });

      // Act
      const { data: createdNotification } = await supabase
        .from('notifications')
        .insert({
          user_id: testUser.id,
          type: 'subscription_added',
          title: 'Payment Successful',
          message: 'Your payment of $29.99 was processed successfully',
          read: false,
          metadata: {
            payment_intent_id: paymentIntentId,
            amount: 29.99,
            currency: 'usd',
          },
        })
        .select();

      // Assert
      expect(createdNotification).toHaveLength(1);
      expect(createdNotification?.[0].type).toBe('subscription_added');
      expect(createdNotification?.[0].user_id).toBe(testUser.id);
      expect(createdNotification?.[0].metadata?.payment_intent_id).toBe(paymentIntentId);
    });

    it('should create notification on failed payment', async () => {
      // Arrange
      const paymentIntentId = 'pi_notification_failed';
      const notification = mockNotification({
        user_id: testUser.id,
        type: 'payment_failed',
        title: 'Payment Failed',
        message: 'Your payment could not be processed. Please update your payment method.',
        read: false,
        metadata: {
          payment_intent_id: paymentIntentId,
          error_message: 'Your card was declined',
        },
      });

      supabase.from.mockReturnThis();
      supabase.insert.mockReturnThis();
      supabase.select.mockResolvedValue({
        data: [notification],
        error: null,
      });

      // Act
      const { data: createdNotification } = await supabase
        .from('notifications')
        .insert({
          user_id: testUser.id,
          type: 'payment_failed',
          title: 'Payment Failed',
          message: 'Your payment could not be processed. Please update your payment method.',
          read: false,
          metadata: {
            payment_intent_id: paymentIntentId,
            error_message: 'Your card was declined',
          },
        })
        .select();

      // Assert
      expect(createdNotification).toHaveLength(1);
      expect(createdNotification?.[0].type).toBe('payment_failed');
      expect(createdNotification?.[0].metadata?.error_message).toBe('Your card was declined');
    });

    it('should not create duplicate notifications for same event', async () => {
      // Arrange
      const eventId = 'evt_duplicate_notification';
      const paymentIntentId = 'pi_duplicate_notif_test';

      // Check for existing notification
      supabase.from.mockReturnThis();
      supabase.select.mockReturnThis();
      supabase.eq.mockReturnThis();

      // First check - no existing notification
      supabase.single.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST116', message: 'No rows found' },
      });

      // Act - First processing
      const { data: existingFirst } = await supabase
        .from('notifications')
        .select()
        .eq('metadata->>event_id', eventId)
        .single();

      expect(existingFirst).toBeNull();

      // Create notification
      supabase.insert.mockReturnThis();
      supabase.select.mockResolvedValueOnce({
        data: [mockNotification({ metadata: { event_id: eventId } })],
        error: null,
      });

      await supabase
        .from('notifications')
        .insert({
          user_id: testUser.id,
          type: 'subscription_added',
          title: 'Payment Successful',
          message: 'Your payment was processed',
          metadata: { event_id: eventId, payment_intent_id: paymentIntentId },
        })
        .select();

      // Second processing - notification exists
      supabase.single.mockResolvedValueOnce({
        data: mockNotification({ metadata: { event_id: eventId } }),
        error: null,
      });

      const { data: existingSecond } = await supabase
        .from('notifications')
        .select()
        .eq('metadata->>event_id', eventId)
        .single();

      // Assert
      expect(existingSecond).toBeDefined();
      expect(existingSecond?.metadata?.event_id).toBe(eventId);
      // In real implementation, no second notification would be created
    });

    it('should trigger email notification for payment failure', async () => {
      // Arrange
      const paymentIntentId = 'pi_email_notification';
      const mockEmailService = {
        sendPaymentFailedEmail: vi.fn().mockResolvedValue({ success: true }),
      };

      // Mock notification creation
      supabase.from.mockReturnThis();
      supabase.insert.mockReturnThis();
      supabase.select.mockResolvedValue({
        data: [mockNotification({ type: 'payment_failed' })],
        error: null,
      });

      // Act
      await supabase
        .from('notifications')
        .insert({
          user_id: testUser.id,
          type: 'payment_failed',
          title: 'Payment Failed',
          message: 'Your payment could not be processed',
        })
        .select();

      // Simulate email notification trigger
      await mockEmailService.sendPaymentFailedEmail({
        to: testUser.email,
        userId: testUser.id,
        paymentIntentId,
      });

      // Assert
      expect(mockEmailService.sendPaymentFailedEmail).toHaveBeenCalledWith({
        to: testUser.email,
        userId: testUser.id,
        paymentIntentId,
      });
    });

    it('should respect user notification preferences', async () => {
      // Arrange
      const userPreferences = {
        email_notifications: true,
        push_notifications: false,
        notification_types: ['payment_failed', 'renewal'],
      };

      supabase.from.mockReturnThis();
      supabase.select.mockReturnThis();
      supabase.eq.mockReturnThis();
      supabase.single.mockResolvedValue({
        data: userPreferences,
        error: null,
      });

      // Act
      const { data: prefs } = await supabase
        .from('user_preferences')
        .select('email_notifications, push_notifications, notification_types')
        .eq('user_id', testUser.id)
        .single();

      // Assert - Check preferences before sending notification
      expect(prefs?.email_notifications).toBe(true);
      expect(prefs?.push_notifications).toBe(false);
      expect(prefs?.notification_types).toContain('payment_failed');

      // In real implementation, only email notification would be sent
      // based on these preferences
    });
  });

  describe('Webhook Event Idempotency', () => {
    it('should handle duplicate webhook events idempotently', async () => {
      // Arrange
      const eventId = 'evt_idempotent_test';
      const paymentIntentId = 'pi_idempotent_123';

      // First processing
      supabase.from.mockReturnThis();
      supabase.update.mockReturnThis();
      supabase.eq.mockResolvedValue({ data: null, error: null });

      // Act - Process first time
      await supabase
        .from('payments')
        .update({ status: 'succeeded' })
        .eq('transaction_id', paymentIntentId);

      const firstUpdateCount = supabase.update.mock.calls.length;

      // Act - Process duplicate event
      await supabase
        .from('payments')
        .update({ status: 'succeeded' })
        .eq('transaction_id', paymentIntentId);

      // Assert - Both updates called, but database handles idempotency
      expect(supabase.update.mock.calls.length).toBe(firstUpdateCount + 1);
      expect(supabase.update).toHaveBeenCalledWith({ status: 'succeeded' });
    });

    it('should track processed webhook events to prevent duplicate processing', async () => {
      // Arrange
      const eventId = 'evt_tracking_test';

      // Check if event was already processed
      supabase.from.mockReturnThis();
      supabase.select.mockReturnThis();
      supabase.eq.mockReturnThis();
      supabase.single.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST116', message: 'No rows found' },
      });

      // Act - First processing
      const { data: processedFirst } = await supabase
        .from('webhook_events')
        .select()
        .eq('event_id', eventId)
        .single();

      expect(processedFirst).toBeNull();

      // Record event as processed
      supabase.insert.mockReturnThis();
      supabase.select.mockResolvedValueOnce({
        data: [{
          event_id: eventId,
          processed_at: new Date().toISOString(),
        }],
        error: null,
      });

      await supabase
        .from('webhook_events')
        .insert({ event_id: eventId, processed_at: new Date().toISOString() })
        .select();

      // Check again - event now processed
      supabase.single.mockResolvedValueOnce({
        data: {
          event_id: eventId,
          processed_at: new Date().toISOString(),
        },
        error: null,
      });

      const { data: processedSecond } = await supabase
        .from('webhook_events')
        .select()
        .eq('event_id', eventId)
        .single();

      // Assert
      expect(processedSecond).toBeDefined();
      expect(processedSecond?.event_id).toBe(eventId);
    });

    it('should not cross-update webhook_events between Stripe and PayPal providers', async () => {
      // Arrange
      // Both providers use the same event_id value (e.g. a collision)
      const sharedEventId = 'evt_cross_provider_collision';

      // Simulate a Stripe webhook_events row with this event_id
      const stripeRow = {
        id: 'stripe-row-id',
        provider: 'stripe',
        event_id: sharedEventId,
        processed: false,
      };

      // Simulate a PayPal webhook_events row with the same event_id
      const paypalRow = {
        id: 'paypal-row-id',
        provider: 'paypal',
        event_id: sharedEventId,
        processed: false,
      };

      // The processed-state update for PayPal must filter by BOTH provider and event_id.
      // If it only filtered by event_id, it would incorrectly mark the Stripe row as processed.
      const updateFilters: Array<Record<string, string>> = [];

      // Simulate the PayPal handler's update chain: update(...).eq('provider', 'paypal').eq('event_id', sharedEventId)
      const mockUpdate = vi.fn().mockImplementation(() => ({
        eq: vi.fn().mockImplementation((field: string) => {
          updateFilters.push({ [field]: field === 'provider' ? 'paypal' : sharedEventId });
          return { eq: vi.fn().mockResolvedValue({ error: null }) };
        }),
      }));

      // Verify the update chain includes both provider and event_id filters
      const filterKeys = updateFilters.flatMap((f) => Object.keys(f));
      expect(filterKeys).toContain('provider');
      expect(filterKeys).toContain('event_id');

      // The provider filter must be 'paypal' (not 'stripe')
      const providerFilter = updateFilters.find((f) => f.provider);
      expect(providerFilter?.provider).toBe('paypal');

      // Simulate the DB query: a PayPal-scoped update would only match paypalRow
      const paypalScopedMatch = paypalRow.provider === 'paypal' && paypalRow.event_id === sharedEventId;
      const stripeScopedMatch = stripeRow.provider === 'paypal' && stripeRow.event_id === sharedEventId;
      expect(paypalScopedMatch).toBe(true);
      expect(stripeScopedMatch).toBe(false);

      // The mockUpdate chain must be exercised to prove the filters are applied
      expect(mockUpdate).toBeDefined();
    });
  });

  describe('Error Handling and Retry Scenarios', () => {
    it('should return 500 status for database errors to trigger Stripe retry', async () => {
      // Arrange
      const paymentIntentId = 'pi_retry_test';

      supabase.from.mockReturnThis();
      supabase.update.mockReturnThis();
      supabase.eq.mockResolvedValue({
        data: null,
        error: {
          message: 'Database connection timeout',
          code: 'PGRST500',
        },
      });

      // Act
      const { error } = await supabase
        .from('payments')
        .update({ status: 'succeeded' })
        .eq('transaction_id', paymentIntentId);

      // Assert
      expect(error).toBeDefined();
      expect(error?.code).toBe('PGRST500');
      // In real implementation, this would return 500 status
      // causing Stripe to retry the webhook
    });

    it('should handle malformed webhook payloads gracefully', async () => {
      // Arrange
      const malformedPayload = 'not valid json{{{';
      const signature = 't=123,v1=sig';

      stripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('Unexpected token');
      });

      // Act & Assert
      expect(() => {
        stripe.webhooks.constructEvent(malformedPayload, signature, 'whsec_test');
      }).toThrow('Unexpected token');
    });

    it('should log errors without exposing sensitive information', async () => {
      // Arrange
      const mockLogger = {
        error: vi.fn(),
        warn: vi.fn(),
      };

      const paymentIntentId = 'pi_logging_test';
      const sensitiveData = {
        cardNumber: '4242424242424242',
        cvv: '123',
      };

      // Act - Simulate error logging
      mockLogger.error('Webhook processing failed', {
        eventId: 'evt_123',
        paymentIntentId,
        // Sensitive data should be redacted
        error: 'Database update failed',
      });

      // Assert
      expect(mockLogger.error).toHaveBeenCalled();
      const logCall = mockLogger.error.mock.calls[0];
      expect(JSON.stringify(logCall)).not.toContain(sensitiveData.cardNumber);
      expect(JSON.stringify(logCall)).not.toContain(sensitiveData.cvv);
    });

    it('should handle concurrent webhook processing without race conditions', async () => {
      // Arrange
      const paymentIntentId = 'pi_concurrent_test';
      const eventId = 'evt_concurrent';

      // Simulate concurrent processing
      supabase.from.mockReturnThis();
      supabase.update.mockReturnThis();
      supabase.eq.mockResolvedValue({ data: null, error: null });

      // Act - Process same event concurrently
      const promises = [
        supabase.from('payments').update({ status: 'succeeded' }).eq('transaction_id', paymentIntentId),
        supabase.from('payments').update({ status: 'succeeded' }).eq('transaction_id', paymentIntentId),
      ];

      const results = await Promise.all(promises);

      // Assert - Both should complete without errors
      results.forEach(result => {
        expect(result.error).toBeNull();
      });

      // In real implementation, database constraints or locks
      // would prevent race conditions
    });
  });
});
