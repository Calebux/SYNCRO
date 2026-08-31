/**
 * Mock factories for domain models
 * 
 * These factories use faker to generate realistic test data with support for partial overrides.
 * Use these factories in tests to create consistent, realistic mock data.
 * 
 * @example
 * const user = mockUser({ email: 'test@example.com' });
 * const subscription = mockSubscription({ price: 9.99 });
 */

import type { 
  Subscription, 
  BillingCycle, 
  SubscriptionStatus,
  MFAFactor,
  MFAStatus
} from '@/lib/types';

import { type CancellationGuide } from '@/lib/supabase/cancellation-guides';

// Simple UUID generator for tests
const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// Simple random generators (avoiding external dependencies)
const randomEmail = () => `user${Math.random().toString(36).substr(2, 9)}@example.com`;
const randomFloat = (min: number, max: number, precision: number = 2) => {
  const value = Math.random() * (max - min) + min;
  return Number(value.toFixed(precision));
};
const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomElement = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randomCompanyName = () => {
  const companies = ['Netflix', 'Spotify', 'Adobe', 'Microsoft', 'Apple', 'Amazon', 'Google', 'Dropbox'];
  return randomElement(companies);
};
const randomDate = (daysAgo: number = 30) => {
  const date = new Date();
  date.setDate(date.getDate() - randomInt(0, daysAgo));
  return date.toISOString();
};

/**
 * Mock user for authentication testing
 */
export interface MockUser {
  id: string;
  email: string;
  user_metadata: {
    role: 'user' | 'admin';
    mfa_enabled?: boolean;
    full_name?: string;
  };
  created_at?: string;
  updated_at?: string;
}

export const mockUser = (overrides?: Partial<MockUser>): MockUser => ({
  id: generateId(),
  email: randomEmail(),
  user_metadata: {
    role: 'user',
    mfa_enabled: false,
    ...overrides?.user_metadata,
  },
  created_at: randomDate(90),
  updated_at: randomDate(30),
  ...overrides,
});

/**
 * Mock subscription for subscription management testing
 */
export const mockSubscription = (overrides?: Partial<Subscription>): Subscription => {
  const categories = ['streaming', 'software', 'gaming', 'productivity', 'cloud storage'];
  const billingCycles: BillingCycle[] = ['monthly', 'yearly', 'quarterly'];
  const statuses: SubscriptionStatus[] = ['active', 'cancelled', 'paused', 'trial', 'expired'];
  
  return {
    id: generateId(),
    name: randomCompanyName(),
    price: randomFloat(5, 100),
    billingCycle: randomElement(billingCycles),
    category: randomElement(categories),
    status: randomElement(statuses),
    renewalDate: randomDate(-30), // Future date
    createdAt: randomDate(90),
    updatedAt: randomDate(30),
    ...overrides,
  };
};

/**
 * Mock payment for payment processing testing
 */
export interface MockPayment {
  id: string;
  transaction_id: string;
  user_id: string;
  subscription_id?: string;
  amount: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  provider: 'stripe' | 'paypal';
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export const mockPayment = (overrides?: Partial<MockPayment>): MockPayment => {
  const statuses: MockPayment['status'][] = ['pending', 'succeeded', 'failed', 'refunded'];
  const providers: MockPayment['provider'][] = ['stripe', 'paypal'];
  
  return {
    id: generateId(),
    transaction_id: `pi_${Math.random().toString(36).substr(2, 24)}`,
    user_id: generateId(),
    subscription_id: generateId(),
    amount: randomFloat(10, 1000),
    currency: 'usd',
    status: randomElement(statuses),
    provider: randomElement(providers),
    metadata: {},
    created_at: randomDate(30),
    updated_at: randomDate(30),
    ...overrides,
  };
};

/**
 * Mock notification for notification testing
 */
export interface MockNotification {
  id: string;
  user_id: string;
  type: 'renewal' | 'payment_failed' | 'subscription_added' | 'budget_alert' | 'trial_ending';
  title: string;
  message: string;
  read: boolean;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export const mockNotification = (overrides?: Partial<MockNotification>): MockNotification => {
  const types: MockNotification['type'][] = ['renewal', 'payment_failed', 'subscription_added', 'budget_alert', 'trial_ending'];
  const type = overrides?.type || randomElement(types);
  
  const titles: Record<MockNotification['type'], string> = {
    renewal: 'Subscription Renewal',
    payment_failed: 'Payment Failed',
    subscription_added: 'Subscription Added',
    budget_alert: 'Budget Alert',
    trial_ending: 'Trial Ending Soon',
  };
  
  const messages: Record<MockNotification['type'], string> = {
    renewal: 'Your subscription will renew soon',
    payment_failed: 'Your payment could not be processed',
    subscription_added: 'A new subscription has been added',
    budget_alert: 'You are approaching your budget limit',
    trial_ending: 'Your trial period is ending soon',
  };
  
  return {
    id: generateId(),
    user_id: generateId(),
    type,
    title: titles[type],
    message: messages[type],
    read: false,
    created_at: randomDate(7),
    metadata: {},
    ...overrides,
  };
};

/**
 * Mock MFA factor for MFA testing
 */
export const mockMFAFactor = (overrides?: Partial<MFAFactor>): MFAFactor => ({
  id: generateId(),
  type: 'totp',
  friendlyName: 'Authenticator App',
  createdAt: randomDate(30),
  updatedAt: randomDate(30),
  ...overrides,
});

/**
 * Mock MFA status for MFA testing
 */
export const mockMFAStatus = (overrides?: Partial<MFAStatus>): MFAStatus => ({
  enabled: false,
  factors: [],
  currentLevel: 'aal1',
  nextLevel: 'aal1',
  recoveryCodesRemaining: 0,
  ...overrides,
});

/**
 * Mock tag for tag management testing
 */
export interface MockTag {
  id: string;
  user_id: string;
  name: string;
  color: string;
  created_at: string;
}

export const mockTag = (overrides?: Partial<MockTag>): MockTag => {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8'];
  const tagNames = ['Work', 'Personal', 'Entertainment', 'Essential', 'Optional'];
  
  return {
    id: generateId(),
    user_id: generateId(),
    name: randomElement(tagNames),
    color: randomElement(colors),
    created_at: randomDate(60),
    ...overrides,
  };
};

/**
 * Mock webhook event for webhook testing
 */
export interface MockWebhookEvent {
  id: string;
  type: string;
  data: {
    object: unknown;
  };
  created: number;
}

export const mockWebhookEvent = (overrides?: Partial<MockWebhookEvent>): MockWebhookEvent => ({
  id: `evt_${Math.random().toString(36).substr(2, 24)}`,
  type: 'payment_intent.succeeded',
  data: {
    object: {
      id: `pi_${Math.random().toString(36).substr(2, 24)}`,
      amount: randomInt(1000, 10000),
      currency: 'usd',
      status: 'succeeded',
    },
  },
  created: Math.floor(Date.now() / 1000),
  ...overrides,
});

/**
 * Mock cancellation guide for testing
 */
export const mockCancellationGuide = (overrides?: Partial<CancellationGuide>): CancellationGuide => ({
  id: generateId(),
  service_name: randomCompanyName(),
  difficulty: 'medium',
  direct_url: 'https://example.com/cancel',
  steps: ['Log in', 'Go to settings', 'Click cancel'],
  estimated_time: '5 mins',
  created_at: randomDate(30),
  updated_at: randomDate(7),
  ...overrides,
});
