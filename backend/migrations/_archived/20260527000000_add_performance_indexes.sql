-- Migration: Add performance indexes for analytics and price history queries
-- Issue #659
-- This migration adds indexes to optimize slow queries identified in analytics, price history,
-- dismissed suggestions, and risk tables at scale.

-- ============================================================================
-- 1. Price History Table Indexes
-- ============================================================================
-- subscription_price_history has no indexes except primary key
-- Queries: Fetch price history for a subscription, track price changes over time

-- Index for fetching price history by subscription (most common query)
CREATE INDEX IF NOT EXISTS idx_price_history_subscription 
  ON subscription_price_history(subscription_id);

-- Index for fetching price history by user (for user analytics)
CREATE INDEX IF NOT EXISTS idx_price_history_user 
  ON subscription_price_history(user_id);

-- Composite index for time-series queries (subscription + time ordered)
CREATE INDEX IF NOT EXISTS idx_price_history_subscription_changed 
  ON subscription_price_history(subscription_id, changed_at DESC);

-- ============================================================================
-- 2. Subscriptions Table Indexes for Analytics
-- ============================================================================
-- Analytics queries filter by (user_id, status) frequently
-- Query patterns from analytics-service.ts:
-- - .eq('user_id', userId).eq('status', 'active')
-- - .eq('user_id', userId) for all subscriptions
-- - Filter by next_billing_date for upcoming renewals

-- Composite index for active subscriptions by user (analytics summary)
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status 
  ON public.subscriptions(user_id, status)
  WHERE status IN ('active', 'paused', 'trial');

-- Index for upcoming renewals query (next 7 days)
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_next_billing 
  ON public.subscriptions(user_id, next_billing_date)
  WHERE next_billing_date IS NOT NULL 
  AND status = 'active';

-- Index for category-based analytics breakdown
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_category 
  ON public.subscriptions(user_id, category)
  WHERE category IS NOT NULL;

-- ============================================================================
-- 3. Notifications Table Indexes for Budget Alert Deduplication
-- ============================================================================
-- Budget alert queries filter by (user_id, type) and use LIKE on message
-- Pattern from analytics-service.ts line 219-225:
-- .eq('user_id', userId).eq('type', 'budget_alert').like('message', `%monthStr%`)

-- Composite index for budget alert deduplication
CREATE INDEX IF NOT EXISTS idx_notifications_user_type_created 
  ON public.notifications(user_id, type, created_at DESC);

-- Partial index for budget alerts specifically (most common notification type)
CREATE INDEX IF NOT EXISTS idx_notifications_budget_alerts 
  ON public.notifications(user_id, created_at DESC)
  WHERE type = 'budget_alert';

-- ============================================================================
-- 4. Dismissed Suggestions Table Indexes
-- ============================================================================
-- Already has index on user_id, but needs time-based filtering
-- Pattern: Filter by user_id and dismissed_until to check if suggestion is still dismissed

-- Composite index for checking dismissed status with time expiry
CREATE INDEX IF NOT EXISTS idx_dismissed_suggestions_user_until 
  ON dismissed_suggestions(user_id, dismissed_until)
  WHERE dismissed_until > NOW();

-- ============================================================================
-- 5. Monthly Budgets Table Optimization
-- ============================================================================
-- Already has index on user_id, but composite index with category helps
-- Pattern: .eq('user_id', userId) for fetching user budgets

-- Composite index for budget queries with category
CREATE INDEX IF NOT EXISTS idx_monthly_budgets_user_category 
  ON public.monthly_budgets(user_id, category);

-- ============================================================================
-- Index Usage Documentation
-- ============================================================================
-- These indexes optimize the following query patterns:
--
-- Analytics Summary:
--   SELECT * FROM subscriptions WHERE user_id = ? AND status = 'active'
--   → Uses: idx_subscriptions_user_status
--
-- Price History Fetch:
--   SELECT * FROM subscription_price_history WHERE subscription_id = ? ORDER BY changed_at DESC
--   → Uses: idx_price_history_subscription_changed
--
-- Upcoming Renewals:
--   SELECT * FROM subscriptions WHERE user_id = ? AND next_billing_date BETWEEN ? AND ?
--   → Uses: idx_subscriptions_user_next_billing
--
-- Budget Alert Deduplication:
--   SELECT * FROM notifications WHERE user_id = ? AND type = 'budget_alert' AND message LIKE ?
--   → Uses: idx_notifications_user_type_created, idx_notifications_budget_alerts
--
-- Dismissed Suggestions Check:
--   SELECT * FROM dismissed_suggestions WHERE user_id = ? AND dismissed_until > NOW()
--   → Uses: idx_dismissed_suggestions_user_until
--
-- Category Breakdown:
--   SELECT * FROM subscriptions WHERE user_id = ? AND category = ?
--   → Uses: idx_subscriptions_user_category
