export type BillingCycle = "monthly" | "yearly" | "quarterly";

import { type CancellationGuide } from "@/lib/supabase/cancellation-guides";

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
  cancellationGuide?: CancellationGuide;
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