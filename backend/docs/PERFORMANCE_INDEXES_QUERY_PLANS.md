# Performance Indexes - Query Plans Documentation

This document captures the query plans and performance improvements for the performance indexes added in migration `20260527000000_add_performance_indexes.sql`.

## Overview

The following indexes were added to optimize slow queries in analytics, price history, dismissed suggestions, and related tables:

### 1. Price History Table Indexes
- `idx_price_history_subscription` - For fetching price history by subscription
- `idx_price_history_user` - For fetching price history by user
- `idx_price_history_subscription_changed` - Composite index for time-series queries

### 2. Subscriptions Table Indexes for Analytics
- `idx_subscriptions_user_status` - Composite index for active subscriptions by user
- `idx_subscriptions_user_next_billing` - Index for upcoming renewals query
- `idx_subscriptions_user_category` - Index for category-based analytics

### 3. Notifications Table Indexes
- `idx_notifications_user_type_created` - Composite index for budget alert deduplication
- `idx_notifications_budget_alerts` - Partial index for budget alerts specifically

### 4. Dismissed Suggestions Table Indexes
- `idx_dismissed_suggestions_user_until` - Composite index for checking dismissed status with time expiry

### 5. Monthly Budgets Table Optimization
- `idx_monthly_budgets_user_category` - Composite index for budget queries with category

## Query Plans

### Before Migration (Baseline)

To capture baseline query plans before applying the migration:

```bash
cd backend
node scripts/capture-query-plans.js
```

This will save query plans to `backend/query-plans/` directory.

### After Migration

After applying the migration, run the same script to capture improved query plans:

```bash
cd backend
node scripts/capture-query-plans.js
```

Compare the two sets of plans to measure improvements.

## Expected Improvements

### Analytics Summary - Active Subscriptions
**Query:** `SELECT * FROM subscriptions WHERE user_id = ? AND status = 'active'`

**Before:** Sequential scan on subscriptions table, filtering by user_id and status
**After:** Index scan on `idx_subscriptions_user_status` (partial index on active/paused/trial)

**Expected Improvement:** 50-90% faster for users with many subscriptions

### Price History - By Subscription
**Query:** `SELECT * FROM subscription_price_history WHERE subscription_id = ? ORDER BY changed_at DESC`

**Before:** Sequential scan on subscription_price_history table
**After:** Index scan on `idx_price_history_subscription_changed`

**Expected Improvement:** 80-95% faster for subscriptions with price history

### Upcoming Renewals - Next 7 Days
**Query:** `SELECT * FROM subscriptions WHERE user_id = ? AND next_billing_date BETWEEN ? AND ?`

**Before:** Sequential scan filtering by user_id and date range
**After:** Index scan on `idx_subscriptions_user_next_billing` (partial index)

**Expected Improvement:** 70-90% faster for users with many subscriptions

### Budget Alert Deduplication
**Query:** `SELECT * FROM notifications WHERE user_id = ? AND type = 'budget_alert' AND message LIKE ?`

**Before:** Sequential scan with LIKE operation
**After:** Index scan on `idx_notifications_user_type_created` or `idx_notifications_budget_alerts`

**Expected Improvement:** 60-85% faster for users with many notifications

### Dismissed Suggestions - Active
**Query:** `SELECT * FROM dismissed_suggestions WHERE user_id = ? AND dismissed_until > NOW()`

**Before:** Sequential scan filtering by user_id and time
**After:** Index scan on `idx_dismissed_suggestions_user_until` (partial index)

**Expected Improvement:** 75-90% faster for users with dismissed suggestions

## Benchmark Results

### Running Benchmarks

To run performance benchmarks:

```bash
cd backend
node scripts/benchmark-performance-indexes.js
```

This will execute each query 5 times and report average, min, and max execution times.

### Benchmark Template

| Query Name | Before (avg) | After (avg) | Improvement | Notes |
|------------|--------------|-------------|-------------|-------|
| Analytics Summary - Active Subscriptions | TBD | TBD | TBD | | 
| Price History - By Subscription | TBD | TBD | TBD | |
| Price History - By User | TBD | TBD | TBD | |
| Upcoming Renewals - Next 7 Days | TBD | TBD | TBD | |
| Budget Alert Deduplication | TBD | TBD | TBD | |
| Dismissed Suggestions - Active | TBD | TBD | TBD | |
| Category Breakdown | TBD | TBD | TBD | |
| Monthly Budgets - By User | TBD | TBD | TBD | |

## Index Usage Verification

To verify that indexes are being used:

```sql
-- Check index usage statistics
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_scan as index_scans,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE tablename IN (
  'subscriptions',
  'subscription_price_history',
  'notifications',
  'dismissed_suggestions',
  'monthly_budgets'
)
ORDER BY idx_scan DESC;
```

## Index Size Impact

To check the size impact of the new indexes:

```sql
SELECT 
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_indexes
WHERE indexname LIKE 'idx_%'
  AND tablename IN (
    'subscriptions',
    'subscription_price_history',
    'notifications',
    'dismissed_suggestions',
    'monthly_budgets'
  )
ORDER BY pg_relation_size(indexrelid) DESC;
```

## Maintenance Notes

### Index Maintenance
- All indexes use `IF NOT EXISTS` to prevent errors on re-runs
- Partial indexes are used where appropriate to reduce index size
- Composite indexes are ordered by selectivity (most selective first)

### Monitoring
- Monitor index usage statistics regularly
- Remove unused indexes to save space and improve write performance
- Consider index bloat and run `REINDEX` if necessary

### Trade-offs
- Indexes improve read performance but add overhead to INSERT/UPDATE/DELETE operations
- The chosen indexes balance read performance gains against write overhead
- Partial indexes minimize the write overhead for less common queries

## Related Documentation

- Migration: `backend/migrations/20260527000000_add_performance_indexes.sql`
- Benchmark Script: `backend/scripts/benchmark-performance-indexes.js`
- Query Plan Script: `backend/scripts/capture-query-plans.js`
- Analytics Service: `backend/src/services/analytics-service.ts`
