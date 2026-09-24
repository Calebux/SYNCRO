/**
 * Retry configuration for SDK requests
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in milliseconds for exponential backoff (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds for exponential backoff (default: 30000) */
  maxDelayMs?: number;
  /** HTTP status codes to retry on (default: [408, 429, 500, 502, 503, 504]) */
  retryableStatusCodes?: number[];
}

/**
 * Stellar wallet for blockchain operations
 */
export interface StellarWallet {
  publicKey?: string | (() => string);
  signTransaction?: (...args: any[]) => any;
  sign?: (...args: any[]) => any;
  [key: string]: any;
}

/**
 * Stellar keypair for blockchain operations
 */
export interface StellarKeypair {
  publicKey: string | (() => string);
  secret?: () => string;
  sign?: (...args: any[]) => any;
  [key: string]: any;
}

/**
 * Strictly typed Syncro SDK configuration
 */
export interface SyncroSDKConfig {
  /** API key for authentication (required) */
  apiKey: string;
  /** Base URL for the Syncro backend API (default: "http://localhost:3001/api") */
  baseURL?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Retry configuration for failed requests (default: enabled with sensible defaults) */
  retryOptions?: RetryOptions;
  /** Maximum concurrent batch operations (default: 5) */
  batchConcurrency?: number;
  /** Enable SDK logging to console (default: false) */
  enableLogging?: boolean;
  /** Stellar wallet for blockchain operations */
  wallet?: StellarWallet;
  /** Stellar keypair for blockchain operations */
  keypair?: StellarKeypair;
}

/**
 * Configuration for SDK initialization (extends SyncroSDKConfig for backwards compatibility)
 */
export interface SyncroSDKInitConfig {
  /** API key for authentication (required) */
  apiKey: string;
  /** Base URL for the Syncro backend API */
  baseURL?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Retry configuration for failed requests */
  retryOptions?: RetryOptions;
  /** Maximum concurrent batch operations */
  batchConcurrency?: number;
  /** Enable SDK logging to console */
  enableLogging?: boolean;
  /** Stellar wallet for blockchain operations */
  wallet?: StellarWallet;
  /** Stellar keypair for blockchain operations */
  keypair?: StellarKeypair;
  /** Backend API base URL (optional, can use baseURL instead for backwards compatibility) */
  backendApiBaseUrl?: string;
}

export type GiftCardEventType = 'attached' | 'failed';

export interface GiftCardEvent {
  type: GiftCardEventType;
  subscriptionId: string;
  giftCardHash?: string;
  provider?: string;
  data?: Record<string, unknown>;
  error?: string;
}

export type { Logger } from './logger.js';

// ─────────────────────────────────────────────
// Subscription types
// ─────────────────────────────────────────────

export type SubscriptionStatus = 'active' | 'cancelled' | 'paused' | 'trial' | 'expired';
export type BillingCycle = 'monthly' | 'yearly' | 'quarterly';

/** Full subscription object returned from the API */
export interface SubscriptionRecord {
  id: string;
  user_id: string;
  name: string;
  provider: string;
  price: number;
  billing_cycle: BillingCycle;
  status: SubscriptionStatus;
  next_billing_date: string | null;
  category: string | null;
  logo_url: string | null;
  website_url: string | null;
  renewal_url: string | null;
  notes: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

/** Input for creating a new subscription */
export interface CreateSubscriptionInput {
  name: string;
  price: number;
  billing_cycle: BillingCycle;
  provider?: string;
  status?: SubscriptionStatus;
  next_billing_date?: string;
  category?: string;
  logo_url?: string;
  website_url?: string;
  renewal_url?: string;
  notes?: string;
  tags?: string[];
}

/** Input for updating an existing subscription (all fields optional) */
export interface UpdateSubscriptionInput {
  name?: string;
  price?: number;
  billing_cycle?: BillingCycle;
  provider?: string;
  status?: SubscriptionStatus;
  next_billing_date?: string;
  category?: string;
  logo_url?: string;
  website_url?: string;
  renewal_url?: string;
  notes?: string;
  tags?: string[];
}

/** Filters / pagination options for listing subscriptions */
export interface SubscriptionFilters {
  page?: number;
  limit?: number;
  status?: SubscriptionStatus;
  category?: string;
}

/** Paginated API response wrapper */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  hasMore: boolean;
}

// ─────────────────────────────────────────────
// Analytics types
// ─────────────────────────────────────────────

export interface AnalyticsSummary {
  totalActiveSubscriptions: number;
  totalMonthlyCost: number;
  totalAnnualCost: number;
  subscriptionsByStatus: Record<SubscriptionStatus, number>;
  subscriptionsByCategory: Record<string, number>;
  upcomingRenewals: number;
}

export interface RenewalEvent {
  id: string;
  subscriptionId: string;
  subscriptionName: string;
  amount: number;
  billingCycle: BillingCycle;
  renewedAt: string;
  status: 'success' | 'failed';
  transactionHash?: string;
}

// ─────────────────────────────────────────────
// Webhook types
// ─────────────────────────────────────────────

export type WebhookEvent =
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.cancelled'
  | 'subscription.deleted'
  | 'subscription.renewed';

export interface CreateWebhookInput {
  url: string;
  events: WebhookEvent[];
  secret?: string;
}

export interface Webhook {
  id: string;
  url: string;
  events: WebhookEvent[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────
// Notification types
// ─────────────────────────────────────────────

export type NotificationType = 'renewal' | 'price_change' | 'duplicate' | 'trial_ending';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  subscriptionId: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface PaidReceiptPayload {
  receiptId: string;
  requestHash: string;
  route: string;
  unit: string;
  quantity: number;
  amount: number;
  rateCardVersion: string;
  exchangeRate: number | null;
  channelId: string;
  stateNonce: number;
  timestamp: string;
  signerPublicKey: string;
}

export interface PaidReceipt extends PaidReceiptPayload {
  signature: string;
}
