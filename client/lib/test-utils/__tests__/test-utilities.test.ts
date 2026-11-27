/**
 * Test utilities verification tests
 * 
 * These tests verify that our test utilities (factories, mocks, matchers, etc.)
 * are working correctly.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  mockUser,
  mockSubscription,
  mockPayment,
  mockNotification,
  mockTag,
  mockWebhookEvent,
  mockSupabaseClient,
  mockStripeClient,
  mockNextRequest,
  fixtures,
} from '../index';

describe('Test Utilities', () => {
  describe('Factories', () => {
    it('should create a mock user with default values', () => {
      const user = mockUser();
      
      expect(user).toHaveProperty('id');
      expect(user).toHaveProperty('email');
      expect(user).toHaveProperty('user_metadata');
      expect(user.user_metadata.role).toBe('user');
    });

    it('should create a mock user with overrides', () => {
      const user = mockUser({ 
        email: 'test@example.com',
        user_metadata: { role: 'admin' }
      });
      
      expect(user.email).toBe('test@example.com');
      expect(user.user_metadata.role).toBe('admin');
    });

    it('should create a mock subscription', () => {
      const subscription = mockSubscription();
      
      expect(subscription).toHaveProperty('id');
      expect(subscription).toHaveProperty('name');
      expect(subscription).toHaveProperty('price');
      expect(subscription).toHaveProperty('billingCycle');
      expect(subscription).toHaveProperty('status');
    });

    it('should create a mock subscription with overrides', () => {
      const subscription = mockSubscription({
        name: 'Netflix',
        price: 15.99,
        billingCycle: 'monthly',
      });
      
      expect(subscription.name).toBe('Netflix');
      expect(subscription.price).toBe(15.99);
      expect(subscription.billingCycle).toBe('monthly');
    });

    it('should create a mock payment', () => {
      const payment = mockPayment();
      
      expect(payment).toHaveProperty('id');
      expect(payment).toHaveProperty('transaction_id');
      expect(payment).toHaveProperty('amount');
      expect(payment).toHaveProperty('currency');
      expect(payment).toHaveProperty('status');
    });

    it('should create a mock notification', () => {
      const notification = mockNotification();
      
      expect(notification).toHaveProperty('id');
      expect(notification).toHaveProperty('type');
      expect(notification).toHaveProperty('title');
      expect(notification).toHaveProperty('message');
      expect(notification.read).toBe(false);
    });

    it('should create a mock tag', () => {
      const tag = mockTag();
      
      expect(tag).toHaveProperty('id');
      expect(tag).toHaveProperty('name');
      expect(tag).toHaveProperty('color');
    });

    it('should create a mock webhook event', () => {
      const event = mockWebhookEvent();
      
      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('type');
      expect(event).toHaveProperty('data');
      expect(event.type).toBe('payment_intent.succeeded');
    });
  });

  describe('Mocks', () => {
    it('should create a mock Supabase client', () => {
      const supabase = mockSupabaseClient();
      
      expect(supabase.from).toBeDefined();
      expect(supabase.select).toBeDefined();
      expect(supabase.insert).toBeDefined();
      expect(supabase.update).toBeDefined();
      expect(supabase.delete).toBeDefined();
      expect(supabase.auth).toBeDefined();
    });

    it('should create a chainable Supabase client', () => {
      const supabase = mockSupabaseClient();
      
      // Test chainability
      const chain = supabase.from('subscriptions').select('*').eq('id', '123');
      expect(chain).toBeDefined();
    });

    it('should create a mock Stripe client', () => {
      const stripe = mockStripeClient();
      
      expect(stripe.paymentIntents).toBeDefined();
      expect(stripe.customers).toBeDefined();
      expect(stripe.subscriptions).toBeDefined();
      expect(stripe.webhooks).toBeDefined();
    });

    it('should create a mock Next.js request', () => {
      const request = mockNextRequest({
        method: 'POST',
        body: { name: 'Test' },
      });
      
      expect(request.method).toBe('POST');
      expect(request.json).toBeDefined();
    });
  });

  describe('Fixtures', () => {
    it('should provide active subscriptions', () => {
      expect(fixtures.activeSubscriptions).toBeInstanceOf(Array);
      expect(fixtures.activeSubscriptions.length).toBeGreaterThan(0);
      expect(fixtures.activeSubscriptions[0].status).toBe('active');
    });

    it('should provide cancelled subscriptions', () => {
      expect(fixtures.cancelledSubscriptions).toBeInstanceOf(Array);
      expect(fixtures.cancelledSubscriptions.length).toBeGreaterThan(0);
      expect(fixtures.cancelledSubscriptions[0].status).toBe('cancelled');
    });

    it('should provide payment history', () => {
      expect(fixtures.paymentHistory).toBeInstanceOf(Array);
      expect(fixtures.paymentHistory.length).toBeGreaterThan(0);
    });

    it('should provide notifications', () => {
      expect(fixtures.notifications).toBeInstanceOf(Array);
      expect(fixtures.notifications.length).toBeGreaterThan(0);
    });

    it('should provide tags', () => {
      expect(fixtures.tags).toBeInstanceOf(Array);
      expect(fixtures.tags.length).toBeGreaterThan(0);
    });

    it('should provide empty states', () => {
      expect(fixtures.emptyStates.subscriptions).toEqual([]);
      expect(fixtures.emptyStates.payments).toEqual([]);
      expect(fixtures.emptyStates.notifications).toEqual([]);
    });

    it('should provide edge cases', () => {
      expect(fixtures.edgeCases.expensiveSubscription.price).toBeGreaterThan(1000);
      expect(fixtures.edgeCases.cheapSubscription.price).toBeLessThan(1);
    });
  });

  describe('Custom Matchers', () => {
    it('should have toHaveSuccessResponse matcher', () => {
      const response = { success: true, data: { id: '123' } };
      expect(response).toHaveSuccessResponse();
    });

    it('should have toHaveErrorResponse matcher', () => {
      const response = { success: false, error: { code: 'NOT_FOUND', message: 'Not found' } };
      expect(response).toHaveErrorResponse('NOT_FOUND');
    });

    it('should have toMatchPaginatedResponse matcher', () => {
      const response = {
        data: [{ id: '1' }, { id: '2' }],
        pagination: {
          total: 10,
          page: 1,
          pageSize: 2,
        },
      };
      expect(response).toMatchPaginatedResponse();
    });
  });
});
