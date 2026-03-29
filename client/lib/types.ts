

export type BillingCycle = "monthly" | "yearly" | "quarterly";

export type Difficulty = "easy" | "medium" | "hard";

export interface CancellationGuide {
  id: string;
  serviceName: string;
  difficulty: Difficulty;
  directUrl: string;
  steps: string[];
  estimatedTime: string;
  warningNote?: string;
  chatSupportLink?: string;
  phoneNumber?: string;
}

export interface Subscription {
  id: string;
  name: string;
  price: number;
  billingCycle: BillingCycle;
  renewalUrl?: string;
  /** ISO date string */
  renewalDate?: string;
  category?: string;
  visibility?: 'private' | 'team';
  /** History of payments/changes kept for merge operations */
  history?: SubscriptionHistoryEntry[];
  createdAt: string;
  updatedAt: string;
  cancellationGuide?: CancellationGuide; // NEW
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