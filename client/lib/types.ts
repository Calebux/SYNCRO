export type BillingCycle = "monthly" | "yearly" | "quarterly";

export type Difficulty = "easy" | "medium" | "hard";

export type SubscriptionStatus = 'active' | 'cancelled' | 'paused' | 'trial' | 'expired';

export interface Subscription {
  id: string;
  name: string;
  provider?: string;
  price: number;
  billingCycle: BillingCycle;
  renewalUrl?: string;
  /** ISO date string */
  renewalDate?: string;
  category?: string;
  visibility?: 'private' | 'team';
  status?: SubscriptionStatus;
  paused_at?: string | null;
  resume_at?: string | null;
  pause_reason?: string | null;
  /** History of payments/changes kept for merge operations */
  history?: SubscriptionHistoryEntry[];
  createdAt: string;
  updatedAt: string;
  /** UI specific / Computed fields */
  icon?: string;
  renewsIn?: number;
  email?: string;
  isTrial?: boolean;
  trialEndsAt?: string;
  priceAfterTrial?: number;
  latest_price_change?: {
    old_price: number;
    new_price: number;
    changed_at: string;
  };
  toggleVisibility?: boolean;
}

export interface SubscriptionHistoryEntry {
  date: string;
  event: "created" | "price_changed" | "merged" | "imported";
  previousValue?: unknown;
  newValue?: unknown;
  note?: string;
}

//  Duplicate detection results 

export type DuplicateConfidence = "high" | "probable" | "low";

/**
 * Which signals contributed to the duplicate match.
 * Used to explain *why* something was flagged.
 */
export interface MatchSignals {
  nameMatch: boolean;
  priceAndCycleMatch: boolean;
  urlDomainMatch: boolean;
}

export interface DuplicateMatch {
  existing: Subscription;
  confidence: DuplicateConfidence;
  signals: MatchSignals;
}

/** Result of checking a single candidate against the subscription list */
export interface DuplicateCheckResult {
  hasDuplicate: boolean;
  confidence: DuplicateConfidence | null;
  matches: DuplicateMatch[];
}

/** One group in a bulk scan result */
export interface DuplicateGroup {
  /** Canonical name used for grouping */
  normalizedName: string;
  /** Best display name (taken from the first subscription) */
  displayName: string;
  subscriptions: Subscription[];
  totalCost: number;
  potentialSavings: number;
  /** True when grouped subscriptions have different prices */
  priceConflict: boolean;
  confidence: DuplicateConfidence;
}

// API shapes 

/** POST /api/subscriptions/check-duplicate  — request body */
export interface CheckDuplicateRequest {
  name: string;
  price: number;
  billingCycle: BillingCycle;
  renewalUrl?: string;
}

/** POST /api/subscriptions/check-duplicate  — response */
export interface CheckDuplicateResponse {
  hasDuplicate: boolean;
  confidence: DuplicateConfidence | null;
  /** The best (highest-confidence) existing match, if any */
  existing: Subscription | null;
  /** All matches when more than one is found */
  allMatches: DuplicateMatch[];
}

/** POST /api/subscriptions/merge  — request body */
export interface MergeSubscriptionsRequest {
  /** The subscription to keep */
  primaryId: string;
  /** The subscription to absorb (will be deleted after merge) */
  duplicateId: string;
  /**
   * Which fields to take from the duplicate when they differ.
   * Unspecified fields default to the primary's value.
   */
  overrides?: Partial<Pick<Subscription, "name" | "price" | "billingCycle" | "renewalUrl">>;
}

/** POST /api/subscriptions/merge  — response */
export interface MergeSubscriptionsResponse {
  merged: Subscription;
}

export interface ConsolidationSuggestion {
  id: string;
  category: string;
  services: string[];
  suggestedBundle: string;
  savings: string;
}

// MFA / Two Factor Authentication Types
export interface MFAFactor {
  id: string;
  type: 'totp' | 'webauthn';
  friendlyName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MFAEnrollResponse {
  id: string;
  type: 'totp';
  secret: string;
  qrCode: string;
  uri: string;
}

export interface MFAChallengeResponse {
  challengeId: string;
  expiresAt: string;
}

export interface MFAVerifyResponse {
  success: boolean;
  message?: string;
}

export interface MFARecoveryCode {
  code: string;
  used: boolean;
  usedAt?: string;
}

export interface MFAStatus {
  enabled: boolean;
  factors: MFAFactor[];
  currentLevel: 'aal1' | 'aal2';
  nextLevel: 'aal1' | 'aal2';
  recoveryCodesRemaining: number;
}

// Teams Page Models
export interface EmailAccount {
  email: string;
  isWorkEmail: boolean;
}

export interface TeamSubscription {
  name: string;
  usage: number;
  lastUsed: string;
  email: string;
}

export type TeamRole = "Admin" | "Billing Manager" | "Member" | "Viewer" | string;
export type TeamMemberStatus = "active" | "pending" | "inactive" | string;

export interface TeamMember {
  id: number;
  name: string;
  email: string;
  role: TeamRole;
  department: string;
  permissions: string[];
  status: TeamMemberStatus;
  toolsUsed: number;
  monthlySpend: number;
  emailAccounts: EmailAccount[];
  subscriptions: TeamSubscription[];
  leftAt?: Date;
}

export interface Workspace {
  id?: string;
  name?: string;
  domain?: string;
  plan?: string;
}

export interface TeamSettings {
  spendingLimit: number;
  departmentBudgets: Record<string, number>;
}

// SEP-24 Fiat On-ramp / Anchor Types

/** A supported SEP-24 anchor that can be used to fund channels. */
export interface AnchorInfo {
  /** Stable identifier used by the client (e.g. "testanchor") */
  id: string;
  /** Human readable anchor name */
  name: string;
  /** Home domain used for stellar.toml discovery */
  homeDomain: string;
  /** SEP-24 transfer server endpoint */
  transferServerSep24: string;
  /** Whether this anchor is only available on testnet */
  testnet: boolean;
  /** Assets supported for deposit, e.g. ["USDC"] */
  supportedAssets: string[];
  /** Fiat currencies accepted for on-ramp, e.g. ["USD", "EUR"] */
  supportedCurrencies: string[];
  /** Minimum deposit amount (in fiat units) */
  minAmount?: number;
  /** Maximum deposit amount (in fiat units) */
  maxAmount?: number;
  /** Fixed fee charged by the anchor (in fiat units) */
  feeFixed?: number;
  /** Percentage fee charged by the anchor (e.g. 0.5 for 0.5%) */
  feePercent?: number;
  /** Estimated time to funds arriving, in minutes */
  estimatedArrivalMinutes?: number;
  /** Optional URL for anchor documentation / limits */
  docsUrl?: string;
}

export type DepositStatus =
  | "incomplete"
  | "pending_user_transfer_start"
  | "pending_anchor"
  | "pending_stellar"
  | "pending_external"
  | "pending_trust"
  | "pending_user"
  | "completed"
  | "refunded"
  | "expired"
  | "error"
  | "no_market"
  | "too_small"
  | "too_large";

/** A SEP-24 interactive deposit transaction. */
export interface DepositTransaction {
  /** Anchor-assigned transaction id */
  id: string;
  /** Anchor this deposit belongs to */
  anchorId: string;
  /** Current status of the deposit */
  status: DepositStatus;
  /** Asset code being deposited (e.g. "USDC") */
  assetCode: string;
  /** Fiat currency used for the on-ramp */
  fiatCurrency: string;
  /** Amount requested (in fiat units) */
  amountIn?: number;
  /** Amount credited to the Stellar account (in asset units) */
  amountOut?: number;
  /** Stellar account that will receive the funds */
  account: string;
  /** Stellar memo (if required by the anchor) */
  memo?: string;
  /** Interactive URL the user must visit to complete KYC / payment */
  interactiveUrl?: string;
  /** ISO timestamp when the transaction was created */
  startedAt: string;
  /** ISO timestamp when the transaction last changed */
  updatedAt: string;
  /** ISO timestamp when funds were credited, if completed */
  completedAt?: string;
  /** Human readable message from the anchor (e.g. error details) */
  message?: string;
  /** Optional URL to more information about the transaction */
  moreInfoUrl?: string;
}

/** Request payload to start a SEP-24 interactive deposit. */
export interface StartDepositRequest {
  anchorId: string;
  assetCode: string;
  /** Fiat currency for the on-ramp */
  fiatCurrency: string;
  /** Amount in fiat units (optional; anchor may prompt) */
  amount?: number;
  /** Stellar account to credit */
  account: string;
  /** Optional memo to attach to the deposit */
  memo?: string;
}

/** Response from starting a SEP-24 interactive deposit. */
export interface StartDepositResponse {
  transaction: DepositTransaction;
  /** URL to open in a popup / new tab for the interactive flow */
  interactiveUrl: string;
}

/** Request to chain a completed deposit into a channel top-up. */
export interface TopUpFromDepositRequest {
  /** Channel to top up */
  channelId: string;
  /** Deposit transaction to source funds from */
  depositId: string;
  /** Optional amount to top up (defaults to full deposit amount) */
  amount?: number;
}

/** Result of chaining a deposit into a channel top-up. */
export interface TopUpFromDepositResponse {
  channelId: string;
  /** Amount credited to the channel (in asset units) */
  amount: number;
  /** New channel balance after the top-up */
  newBalance: number;
  /** Stellar transaction hash of the top-up transfer */
  txHash?: string;
  deposit: DepositTransaction;
}