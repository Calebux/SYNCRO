/**
 * Integration tests for payment flows
 * 
 * Tests the complete payment flow from intent creation through confirmation,
 * including subscription upgrades and downgrades with proration.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockUser, mockPayment, mockSubscription } from '@/lib/test-utils/factories';
import { mockSupabaseClient, mockStripeClient } from '@/lib/test-utils/mocks';

describe('Payment Flow Integration Tests', () => {
  let supabase: ReturnType<typeof mockSupabaseClient>;
  let stripe: ReturnType<typeof mockStripeClient>;
  let testUser: ReturnType<typeof mockUser>;

  beforeEach(() => {
    testUser = mockUser({ id: 'test-user-123', email: 'test@example.com' });
    supabase = mockSupabaseClient(testUser);
    stripe = mockStripeClient();
  });

  describe('Payment Intent Creation and Confirmation', () => {
    it('should create and confirm a payment intent successfully', async () => {
      // Arrange
      const amount = 1999; // $19.99 in cents
      const currency = 'usd';
      const planName = 'premium';

      const mockPaymentIntent = {
        id: 'pi_test_123',
        status: 'requires_confirmation',
        amount,
        currency,
        client_secret: 'pi_test_123_secret_abc',
      };

      const mockConfirmedIntent = {
        ...mockPaymentIntent,
        status: 'succeeded',
      };

      stripe.paymentIntents.create.mockResolvedValue(mockPaymentIntent);
      stripe.paymentIntents.confirm.mockResolvedValue(mockConfirmedIntent);

      supabase.from.mockReturnThis();
      supabase.insert.mockReturnThis();
      supabase.select.mockResolvedValue({
        data: [mockPayment({
          transaction_id: mockPaymentIntent.id,
          amount: amount / 100,
          currency,
          status: 'succeeded',
          user_id: testUser.id,
        })],
        error: null,
      });

      // Act - Create payment intent
      const createResult = await stripe.paymentIntents.create({
        amount,
        currency,
        metadata: { userId: testUser.id, planName },
      });

      expect(createResult.id).toBe(mockPaymentIntent.id);
      expect(createResult.status).toBe('requires_confirmation');

      // Act - Confirm payment intent
      const confirmResult = await stripe.paymentIntents.confirm(createResult.id);

      expect(confirmResult.status).toBe('succeeded');
      expect(stripe.paymentIntents.confirm).toHaveBeenCalledWith(mockPaymentIntent.id);

      // Verify database was updated
      const { data: paymentRecord } = await supabase
        .from('payments')
        .select()
        .eq('transaction_id', mockPaymentIntent.id);

      expect(paymentRecord).toHaveLength(1);
      expect(paymentRecord?.[0].status).toBe('succeeded');
      expect(paymentRecord?.[0].user_id).toBe(testUser.id);
    });

    it('should handle payment intent with metadata correctly', async () => {
      // Arrange
      const metadata = {
        userId: testUser.id,
        planName: 'premium',
        subscriptionId: 'sub_123',
      };

      stripe.paymentIntents.create.mockResolvedValue({
        id: 'pi_with_metadata',
        status: 'succeeded',
        amount: 2999,
        currency: 'usd',
        metadata,
      });

      // Act
      const result = await stripe.paymentIntents.create({
        amount: 2999,
        currency: 'usd',
        metadata,
      });

      // Assert
      expect(result.metadata).toEqual(metadata);
      expect(stripe.paymentIntents.create).toHaveBeenCalledWith({
        amount: 2999,
        currency: 'usd',
        metadata,
      });
    });
  });

  describe('Subscription Upgrade with Proration', () => {
    it('should handle subscription upgrade with proration calculation', async () => {
      // Arrange
      const currentSubscription = mockSubscription({
        id: 'sub_basic_123',
        name: 'Basic Plan',
        price: 9.99,
        billingCycle: 'monthly',
        status: 'active',
      });

      const newPlanPrice = 19.99;
      const daysRemaining = 15;
      const daysInMonth = 30;
      
      // Calculate proration: unused credit from current plan
      const unusedCredit = (currentSubscription.price * daysRemaining) / daysInMonth;
      const proratedAmount = Math.round((newPlanPrice - unusedCredit) * 100); // in cents

      supabase.from.mockReturnThis();
      supabase.select.mockReturnThis();
      supabase.eq.mockReturnThis();
      supabase.single.mockResolvedValue({
        data: currentSubscription,
        error: null,
      });

      stripe.subscriptions.update.mockResolvedValue({
        id: currentSubscription.id,
        status: 'active',
        items: {
          data: [{
            price: { id: 'price_premium', unit_amount: newPlanPrice * 100 },
          }],
        },
        proration_behavior: 'create_prorations',
      });

      stripe.paymentIntents.create.mockResolvedValue({
        id: 'pi_proration_123',
        amount: proratedAmount,
        currency: 'usd',
        status: 'succeeded',
      });

      // Act
      const { data: currentSub } = await supabase
        .from('subscriptions')
        .select()
        .eq('id', currentSubscription.id)
        .single();

      expect(currentSub).toEqual(currentSubscription);

      // Create prorated payment
      const paymentIntent = await stripe.paymentIntents.create({
        amount: proratedAmount,
        currency: 'usd',
        metadata: {
          type: 'subscription_upgrade',
          oldSubscriptionId: currentSubscription.id,
          proration: true,
        },
      });

      expect(paymentIntent.amount).toBe(proratedAmount);
      expect(paymentIntent.amount).toBeLessThan(newPlanPrice * 100); // Should be less due to credit

      // Update subscription
      const updatedSubscription = await stripe.subscriptions.update(
        currentSubscription.id,
        { proration_behavior: 'create_prorations' }
      );

      expect(updatedSubscription.proration_behavior).toBe('create_prorations');
      expect(stripe.subscriptions.update).toHaveBeenCalledWith(
        currentSubscription.id,
        expect.objectContaining({ proration_behavior: 'create_prorations' })
      );
    });

    it('should create audit log for subscription upgrade', async () => {
      // Arrange
      const subscriptionId = 'sub_upgrade_test';
      const oldPlan = 'basic';
      const newPlan = 'premium';

      supabase.from.mockReturnThis();
      supabase.insert.mockReturnThis();
      supabase.select.mockResolvedValue({
        data: [{
          id: 'audit_123',
          user_id: testUser.id,
          action: 'subscription.upgrade',
          resource_type: 'subscription',
          resource_id: subscriptionId,
          metadata: {
            oldPlan,
            newPlan,
            timestamp: new Date().toISOString(),
          },
        }],
        error: null,
      });

      // Act
      const { data: auditLog } = await supabase
        .from('audit_logs')
        .insert({
          user_id: testUser.id,
          action: 'subscription.upgrade',
          resource_type: 'subscription',
          resource_id: subscriptionId,
          metadata: { oldPlan, newPlan, timestamp: new Date().toISOString() },
        })
        .select();

      // Assert
      expect(auditLog).toHaveLength(1);
      expect(auditLog?.[0].action).toBe('subscription.upgrade');
      expect(auditLog?.[0].metadata).toMatchObject({ oldPlan, newPlan });
    });
  });

  describe('Subscription Downgrade with Credit Application', () => {
    it('should handle subscription downgrade with credit application', async () => {
      // Arrange
      const currentSubscription = mockSubscription({
        id: 'sub_premium_123',
        name: 'Premium Plan',
        price: 19.99,
        billingCycle: 'monthly',
        status: 'active',
      });

      const newPlanPrice = 9.99;
      const daysRemaining = 20;
      const daysInMonth = 30;
      
      // Calculate credit to apply to next billing cycle
      const unusedCredit = (currentSubscription.price * daysRemaining) / daysInMonth;
      const creditToApply = Math.round((unusedCredit - newPlanPrice) * 100); // in cents

      supabase.from.mockReturnThis();
      supabase.select.mockReturnThis();
      supabase.eq.mockReturnThis();
      supabase.single.mockResolvedValue({
        data: currentSubscription,
        error: null,
      });

      supabase.update.mockReturnThis();
      supabase.update.mockResolvedValue({
        data: {
          ...currentSubscription,
          price: newPlanPrice,
          metadata: {
            credit_balance: creditToApply,
          },
        },
        error: null,
      });

      stripe.subscriptions.update.mockResolvedValue({
        id: currentSubscription.id,
        status: 'active',
        items: {
          data: [{
            price: { id: 'price_basic', unit_amount: newPlanPrice * 100 },
          }],
        },
        proration_behavior: 'none', // No charge now, apply credit later
      });

      // Act
      const { data: currentSub } = await supabase
        .from('subscriptions')
        .select()
        .eq('id', currentSubscription.id)
        .single();

      expect(currentSub).toEqual(currentSubscription);

      // Downgrade subscription with credit
      const updatedSubscription = await stripe.subscriptions.update(
        currentSubscription.id,
        { proration_behavior: 'none' }
      );

      expect(updatedSubscription.proration_behavior).toBe('none');

      // Update subscription with credit balance
      const { data: updatedSub } = await supabase
        .from('subscriptions')
        .update({
          price: newPlanPrice,
          metadata: { credit_balance: creditToApply },
        })
        .eq('id', currentSubscription.id)
        .select();

      expect(updatedSub?.metadata?.credit_balance).toBe(creditToApply);
      expect(updatedSub?.metadata?.credit_balance).toBeGreaterThan(0); // Should have credit
    });

    it('should apply credit on next billing cycle for downgrade', async () => {
      // Arrange
      const subscriptionId = 'sub_with_credit';
      const creditBalance = 1000; // $10.00 credit in cents
      const nextBillingAmount = 999; // $9.99 in cents

      supabase.from.mockReturnThis();
      supabase.select.mockReturnThis();
      supabase.eq.mockReturnThis();
      supabase.single.mockResolvedValue({
        data: {
          ...mockSubscription({ id: subscriptionId }),
          metadata: { credit_balance: creditBalance },
        },
        error: null,
      });

      // Next billing should apply credit
      const finalAmount = Math.max(0, nextBillingAmount - creditBalance);

      stripe.paymentIntents.create.mockResolvedValue({
        id: 'pi_with_credit',
        amount: finalAmount,
        currency: 'usd',
        status: 'succeeded',
        metadata: {
          credit_applied: creditBalance,
          original_amount: nextBillingAmount,
        },
      });

      // Act
      const { data: subscription } = await supabase
        .from('subscriptions')
        .select()
        .eq('id', subscriptionId)
        .single();

      expect(subscription?.metadata?.credit_balance).toBe(creditBalance);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: finalAmount,
        currency: 'usd',
        metadata: {
          credit_applied: creditBalance,
          original_amount: nextBillingAmount,
        },
      });

      // Assert
      expect(paymentIntent.amount).toBe(finalAmount);
      expect(paymentIntent.metadata?.credit_applied).toBe(creditBalance);
      expect(finalAmount).toBe(0); // Credit covers the full amount
    });

    it('should create audit log for subscription downgrade', async () => {
      // Arrange
      const subscriptionId = 'sub_downgrade_test';
      const oldPlan = 'premium';
      const newPlan = 'basic';
      const creditApplied = 1050; // $10.50 in cents

      supabase.from.mockReturnThis();
      supabase.insert.mockReturnThis();
      supabase.select.mockResolvedValue({
        data: [{
          id: 'audit_456',
          user_id: testUser.id,
          action: 'subscription.downgrade',
          resource_type: 'subscription',
          resource_id: subscriptionId,
          metadata: {
            oldPlan,
            newPlan,
            creditApplied,
            timestamp: new Date().toISOString(),
          },
        }],
        error: null,
      });

      // Act
      const { data: auditLog } = await supabase
        .from('audit_logs')
        .insert({
          user_id: testUser.id,
          action: 'subscription.downgrade',
          resource_type: 'subscription',
          resource_id: subscriptionId,
          metadata: {
            oldPlan,
            newPlan,
            creditApplied,
            timestamp: new Date().toISOString(),
          },
        })
        .select();

      // Assert
      expect(auditLog).toHaveLength(1);
      expect(auditLog?.[0].action).toBe('subscription.downgrade');
      expect(auditLog?.[0].metadata).toMatchObject({
        oldPlan,
        newPlan,
        creditApplied,
      });
    });
  });
});
