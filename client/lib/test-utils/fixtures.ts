/**
 * Test fixtures for common scenarios
 * 
 * Provides predefined data sets for common testing scenarios.
 * These fixtures represent realistic data states and edge cases.
 * 
 * @example
 * const subscriptions = fixtures.activeSubscriptions;
 * const payments = fixtures.paymentHistory;
 */

import type { Subscription, SubscriptionStatus } from '@/lib/types';
import { mockSubscription, mockPayment, mockNotification, mockTag, type MockPayment, type MockNotification, type MockTag } from './factories';

/**
 * Active subscriptions fixture
 */
export const activeSubscriptions: Subscription[] = [
  mockSubscription({
    id: 'sub-1',
    name: 'Netflix',
    price: 15.99,
    billingCycle: 'monthly',
    category: 'streaming',
    status: 'active',
    renewalDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
  }),
  mockSubscription({
    id: 'sub-2',
    name: 'Spotify',
    price: 9.99,
    billingCycle: 'monthly',
    category: 'streaming',
    status: 'active',
    renewalDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days from now
  }),
  mockSubscription({
    id: 'sub-3',
    name: 'Adobe Creative Cloud',
    price: 54.99,
    billingCycle: 'monthly',
    category: 'software',
    status: 'active',
    renewalDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days from now
  }),
];

/**
 * Cancelled subscriptions fixture
 */
export const cancelledSubscriptions: Subscription[] = [
  mockSubscription({
    id: 'sub-4',
    name: 'Hulu',
    price: 12.99,
    billingCycle: 'monthly',
    category: 'streaming',
    status: 'cancelled',
    renewalDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
  }),
  mockSubscription({
    id: 'sub-5',
    name: 'Dropbox',
    price: 11.99,
    billingCycle: 'monthly',
    category: 'cloud storage',
    status: 'cancelled',
    renewalDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(), // 60 days ago
  }),
];

/**
 * Trial subscriptions fixture
 */
export const trialSubscriptions: Subscription[] = [
  mockSubscription({
    id: 'sub-6',
    name: 'Disney+',
    price: 7.99,
    billingCycle: 'monthly',
    category: 'streaming',
    status: 'trial',
    renewalDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days from now
  }),
];

/**
 * Paused subscriptions fixture
 */
export const pausedSubscriptions: Subscription[] = [
  mockSubscription({
    id: 'sub-7',
    name: 'Audible',
    price: 14.95,
    billingCycle: 'monthly',
    category: 'entertainment',
    status: 'paused',
    paused_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    resume_at: new Date(Date.now() + 23 * 24 * 60 * 60 * 1000).toISOString(),
    pause_reason: 'Vacation',
  }),
];

/**
 * Expired subscriptions fixture
 */
export const expiredSubscriptions: Subscription[] = [
  mockSubscription({
    id: 'sub-8',
    name: 'LinkedIn Premium',
    price: 29.99,
    billingCycle: 'monthly',
    category: 'productivity',
    status: 'expired',
    renewalDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days ago
  }),
];

/**
 * All subscriptions combined
 */
export const allSubscriptions: Subscription[] = [
  ...activeSubscriptions,
  ...cancelledSubscriptions,
  ...trialSubscriptions,
  ...pausedSubscriptions,
  ...expiredSubscriptions,
];

/**
 * Payment history fixture
 */
export const paymentHistory: MockPayment[] = [
  mockPayment({
    id: 'pay-1',
    transaction_id: 'pi_1234567890',
    subscription_id: 'sub-1',
    amount: 15.99,
    currency: 'usd',
    status: 'succeeded',
    provider: 'stripe',
    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  }),
  mockPayment({
    id: 'pay-2',
    transaction_id: 'pi_0987654321',
    subscription_id: 'sub-2',
    amount: 9.99,
    currency: 'usd',
    status: 'succeeded',
    provider: 'stripe',
    created_at: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(),
  }),
  mockPayment({
    id: 'pay-3',
    transaction_id: 'pi_1122334455',
    subscription_id: 'sub-3',
    amount: 54.99,
    currency: 'usd',
    status: 'succeeded',
    provider: 'stripe',
    created_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
  }),
];

/**
 * Failed payments fixture
 */
export const failedPayments: MockPayment[] = [
  mockPayment({
    id: 'pay-4',
    transaction_id: 'pi_failed_001',
    subscription_id: 'sub-1',
    amount: 15.99,
    currency: 'usd',
    status: 'failed',
    provider: 'stripe',
    metadata: { error: 'insufficient_funds' },
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  }),
];

/**
 * Pending payments fixture
 */
export const pendingPayments: MockPayment[] = [
  mockPayment({
    id: 'pay-5',
    transaction_id: 'pi_pending_001',
    subscription_id: 'sub-2',
    amount: 9.99,
    currency: 'usd',
    status: 'pending',
    provider: 'stripe',
    created_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1 hour ago
  }),
];

/**
 * Notifications fixture
 */
export const notifications: MockNotification[] = [
  mockNotification({
    id: 'notif-1',
    type: 'renewal',
    title: 'Subscription Renewal',
    message: 'Your Netflix subscription will renew in 3 days',
    read: false,
    created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    metadata: { subscription_id: 'sub-1' },
  }),
  mockNotification({
    id: 'notif-2',
    type: 'payment_failed',
    title: 'Payment Failed',
    message: 'Your payment for Netflix could not be processed',
    read: false,
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    metadata: { subscription_id: 'sub-1', payment_id: 'pay-4' },
  }),
  mockNotification({
    id: 'notif-3',
    type: 'subscription_added',
    title: 'Subscription Added',
    message: 'Adobe Creative Cloud has been added to your subscriptions',
    read: true,
    created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    metadata: { subscription_id: 'sub-3' },
  }),
];

/**
 * Unread notifications fixture
 */
export const unreadNotifications: MockNotification[] = notifications.filter(n => !n.read);

/**
 * Read notifications fixture
 */
export const readNotifications: MockNotification[] = notifications.filter(n => n.read);

/**
 * Tags fixture
 */
export const tags: MockTag[] = [
  mockTag({
    id: 'tag-1',
    name: 'Work',
    color: '#FF6B6B',
  }),
  mockTag({
    id: 'tag-2',
    name: 'Personal',
    color: '#4ECDC4',
  }),
  mockTag({
    id: 'tag-3',
    name: 'Entertainment',
    color: '#45B7D1',
  }),
  mockTag({
    id: 'tag-4',
    name: 'Essential',
    color: '#FFA07A',
  }),
];

/**
 * Empty state fixtures
 */
export const emptyStates = {
  subscriptions: [] as Subscription[],
  payments: [] as MockPayment[],
  notifications: [] as MockNotification[],
  tags: [] as MockTag[],
};

/**
 * Edge case fixtures
 */
export const edgeCases = {
  // Subscription with very high price
  expensiveSubscription: mockSubscription({
    id: 'sub-expensive',
    name: 'Enterprise Software',
    price: 9999.99,
    billingCycle: 'yearly',
    category: 'software',
    status: 'active',
  }),

  // Subscription with very low price
  cheapSubscription: mockSubscription({
    id: 'sub-cheap',
    name: 'Basic Service',
    price: 0.99,
    billingCycle: 'monthly',
    category: 'software',
    status: 'active',
  }),

  // Subscription with no renewal date
  noRenewalDateSubscription: mockSubscription({
    id: 'sub-no-renewal',
    name: 'Lifetime License',
    price: 299.99,
    billingCycle: 'yearly',
    category: 'software',
    status: 'active',
    renewalDate: undefined,
  }),

  // Subscription with past renewal date
  pastRenewalSubscription: mockSubscription({
    id: 'sub-past-renewal',
    name: 'Overdue Service',
    price: 19.99,
    billingCycle: 'monthly',
    category: 'software',
    status: 'active',
    renewalDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
  }),
};

/**
 * Complete fixture collection
 */
export const fixtures = {
  activeSubscriptions,
  cancelledSubscriptions,
  trialSubscriptions,
  pausedSubscriptions,
  expiredSubscriptions,
  allSubscriptions,
  paymentHistory,
  failedPayments,
  pendingPayments,
  notifications,
  unreadNotifications,
  readNotifications,
  tags,
  emptyStates,
  edgeCases,
};

export default fixtures;
