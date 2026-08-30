/**
 * Types for AppClient initial payload props
 * These types define the shape of data passed from the server to the client
 */

import type { Subscription as DBSubscription } from "@/lib/supabase/subscriptions";
import type { DataLoadWarning } from "@/lib/dashboard-bootstrap";

/**
 * Email account linked to user subscriptions
 * Represents records from the email_accounts table
 */
export interface EmailAccount {
    id: number;
    user_id?: string;
    email: string;
    provider: string;
    is_primary?: boolean;
    last_synced?: string;
    created_at?: string;
    updated_at?: string;
}

/**
 * Payment record from the payments table
 */
export interface Payment {
    id: number;
    user_id?: string;
    subscription_id?: number;
    amount: number;
    currency: string;
    status: string;
    payment_method?: string;
    transaction_id?: string;
    created_at?: string;
    updated_at?: string;
}

/**
 * Price change detected for a subscription
 */
export interface PriceChange {
    id: number;
    subscription_id: number;
    old_price: number;
    new_price: number;
    change_type: "increase" | "decrease" | "same";
    detected_at: string;
}

/**
 * Consolidation suggestion for duplicate subscriptions
 */
export interface ConsolidationSuggestion {
    id: number;
    subscription_ids: number[];
    reason: string;
    suggested_action: "merge" | "keep" | "remove";
    created_at: string;
}

/**
 * Workspace/Team information for enterprise accounts
 */
export interface Workspace {
    id: string;
    name: string;
    plan: string;
    created_at?: string;
    updated_at?: string;
    owner_id?: string;
    team_members?: number;
}

/**
 * Subscription updates from edit modal
 */
export interface SubscriptionUpdates {
    name?: string;
    category?: string;
    price?: number;
    icon?: string;
    renews_in?: number | null;
    status?: string;
    color?: string;
    renewal_url?: string | null;
    tags?: string[];
    billing_cycle?: string;
    pricing_type?: string;
    notes?: string;
}

/**
 * Public props for the AppClient component
 * These are passed from the server-side page component
 */
export interface AppClientProps {
    initialSubscriptions: DBSubscription[];
    initialEmailAccounts: EmailAccount[];
    initialPayments: Payment[];
    initialPriceChanges?: PriceChange[];
    initialConsolidationSuggestions?: ConsolidationSuggestion[];
    initialAnalyticsSummary?: import('@/lib/api/analytics').AnalyticsSummary | null;
    dataLoadWarnings?: DataLoadWarning[];
    isDemo?: boolean;
}