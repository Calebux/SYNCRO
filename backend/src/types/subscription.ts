export interface Subscription {
  id: string;
  user_id: string;
  email_account_id: string | null;
  name: string;
  provider: string;
  price: number;
  billing_cycle: 'monthly' | 'yearly' | 'quarterly';
  status: 'active' | 'cancelled' | 'paused' | 'trial';
  next_billing_date: string | null;
  category: string | null;
  logo_url: string | null;
  website_url: string | null;
  renewal_url: string | null;
  notes: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface SubscriptionCreateInput {
  name: string;
  provider?: string;
  price: number;
  billing_cycle: 'monthly' | 'yearly' | 'quarterly';
  status?: 'active' | 'cancelled' | 'paused' | 'trial';
  next_billing_date?: string;
  category?: string;
  logo_url?: string;
  website_url?: string;
  renewal_url?: string;
  notes?: string;
  tags?: string[];
  email_account_id?: string;
}

export interface SubscriptionUpdateInput {
  name?: string;
  provider?: string;
  price?: number;
  billing_cycle?: 'monthly' | 'yearly' | 'quarterly';
  status?: 'active' | 'cancelled' | 'paused' | 'trial';
  next_billing_date?: string;
  category?: string;
  logo_url?: string;
  website_url?: string;
  renewal_url?: string;
  notes?: string;
  tags?: string[];
}

// ── Cancellation ─────────────────────────────────────────────────────────────

export interface CancellationInput {
  /** Optional redirect URL to the merchant's own cancellation page. */
  cancellation_url?: string;
  /** Human-readable reason for cancellation (stored in notes/logs). */
  reason?: string;
}

export interface CancellationResult {
  subscription: Subscription;
  /** Resolved merchant cancellation page URL (if provided). */
  cancellationUrl?: string;
  blockchainResult?: {
    success: boolean;
    transactionHash?: string;
    error?: string;
  };
  /** 'synced' = both DB + chain OK, 'partial' = DB OK but chain failed, 'failed' = DB failed */
  syncStatus: 'synced' | 'partial' | 'failed';
}

