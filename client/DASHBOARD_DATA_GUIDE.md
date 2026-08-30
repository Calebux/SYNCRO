# Dashboard Data Guide

> Quick reference for working with dashboard price changes and consolidation suggestions

## Overview

The dashboard bootstrap now fetches real data for:
- **Price Changes** - Historical price tracking from `subscription_price_history`
- **Consolidation Suggestions** - Smart cost-saving recommendations

---

## Quick Start

### Fetching Price Changes

```typescript
import { fetchPriceChanges } from '@/lib/dashboard-data'

const priceChanges = await fetchPriceChanges(userId)
// Returns: PriceChange[]
```

### Fetching Consolidation Suggestions

```typescript
import { 
  fetchConsolidationSuggestions,
  filterDismissedSuggestions 
} from '@/lib/dashboard-data'

const rawSuggestions = await fetchConsolidationSuggestions(userId)
const suggestions = await filterDismissedSuggestions(userId, rawSuggestions)
// Returns: ConsolidationSuggestion[]
```

---

## Type Definitions

### PriceChange

```typescript
interface PriceChange {
  id: string                    // Unique identifier
  subscriptionId: string        // Related subscription
  subscriptionName: string      // Display name
  oldPrice: number             // Previous price
  newPrice: number             // Current price
  changedAt: Date              // When it changed
  changeType: 'increase' | 'decrease'
  percentChange: number        // % change (e.g., 12.51)
  annualImpact: number         // Annual cost difference
}
```

**Example:**
```typescript
{
  id: "uuid-123",
  subscriptionId: "sub-456",
  subscriptionName: "Netflix",
  oldPrice: 15.99,
  newPrice: 17.99,
  changedAt: new Date("2026-04-15"),
  changeType: "increase",
  percentChange: 12.51,
  annualImpact: 24.00
}
```

### ConsolidationSuggestion

```typescript
interface ConsolidationSuggestion {
  id: string                    // Unique identifier
  type: SuggestionType         // Type of suggestion
  subscriptionIds: string[]    // Affected subscriptions
  subscriptionNames: string[]  // Display names
  category?: string            // Subscription category
  message: string              // User-facing message
  potentialSavings: number     // Estimated savings
  confidence: number           // 0.0 - 1.0
}

type SuggestionType = 
  | 'duplicate_service'
  | 'unused_subscription'
  | 'switch_to_annual'
  | 'plan_downgrade'
```

**Example:**
```typescript
{
  id: "duplicate_Streaming_1714234567890",
  type: "duplicate_service",
  subscriptionIds: ["sub-123", "sub-789"],
  subscriptionNames: ["Netflix", "Hulu"],
  category: "Streaming",
  message: "You have 2 Streaming subscriptions. Consider consolidating to save money.",
  potentialSavings: 143.88,
  confidence: 0.8
}
```

---

## Suggestion Types

### 1. Duplicate Service
**Detects:** Multiple subscriptions in the same category

**Logic:**
- Groups subscriptions by category
- Flags categories with 2+ active subscriptions
- Estimates savings by consolidating to one service

**Confidence:** 80%

**Example Message:**
> "You have 3 Streaming subscriptions. Consider consolidating to save money."

---

### 2. Unused Subscription
**Detects:** Subscriptions not used in 60+ days

**Logic:**
- Checks `last_used_at` timestamp
- Flags if no usage in 60 days
- Calculates annual savings from cancellation

**Confidence:** 90%

**Example Message:**
> "Adobe Creative Cloud hasn't been used in over 60 days. Consider canceling to save money."

---

### 3. Switch to Annual
**Detects:** Monthly subscriptions that could save with annual billing

**Logic:**
- Identifies monthly subscriptions > $10
- Estimates 15% annual discount
- Calculates potential savings

**Confidence:** 70%

**Example Message:**
> "Switch GitHub Pro to annual billing and save ~15% (estimated $21.60/year)."

---

### 4. Plan Downgrade
**Status:** Not yet implemented

**Future Logic:**
- Analyze usage patterns
- Compare with plan features
- Suggest lower-tier plans

---

## Database Schema

### subscription_price_history

```sql
CREATE TABLE subscription_price_history (
  id UUID PRIMARY KEY,
  subscription_id UUID REFERENCES subscriptions(id),
  old_price DECIMAL(10, 2),
  new_price DECIMAL(10, 2),
  changed_at TIMESTAMPTZ,
  user_id UUID REFERENCES auth.users(id)
);
```

**Automatic Tracking:**
- Trigger on `subscriptions` table
- Captures all price changes
- No manual intervention needed

**Query Example:**
```sql
SELECT 
  sph.*,
  s.name as subscription_name
FROM subscription_price_history sph
JOIN subscriptions s ON s.id = sph.subscription_id
WHERE sph.user_id = 'user-id'
ORDER BY sph.changed_at DESC
LIMIT 50;
```

---

### dismissed_suggestions

```sql
CREATE TABLE dismissed_suggestions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES profiles(id),
  subscription_id UUID REFERENCES subscriptions(id),
  suggestion_type TEXT,
  dismissed_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ
);
```

**User Control:**
- Users can dismiss suggestions
- Suggestions hidden until `dismissed_until`
- Automatically reappear after period

**Query Example:**
```sql
SELECT * FROM dismissed_suggestions
WHERE user_id = 'user-id'
  AND dismissed_until > NOW();
```

---

## Error Handling

### All Functions Return Empty Arrays on Error

```typescript
try {
  const changes = await fetchPriceChanges(userId)
  // Use changes
} catch (error) {
  // Never throws - returns [] on error
}
```

### Comprehensive Logging

All errors are logged with context:

```typescript
console.error('[fetchPriceChanges] Database error:', {
  code: error.code,
  message: error.message,
  details: error.details,
  hint: error.hint,
})
```

### Success Logging

```typescript
console.log('[fetchPriceChanges] Successfully fetched 5 price changes')
```

---

## Usage in Components

### Dashboard Page

```typescript
// Server component
async function getInitialData() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) return { /* empty data */ }
  
  const [priceChanges, rawSuggestions] = await Promise.all([
    fetchPriceChanges(user.id),
    fetchConsolidationSuggestions(user.id),
  ])
  
  const suggestions = await filterDismissedSuggestions(
    user.id,
    rawSuggestions
  )
  
  return {
    priceChanges,
    consolidationSuggestions: suggestions,
  }
}
```

### Client Component

```typescript
'use client'

function DashboardClient({ 
  initialPriceChanges,
  initialConsolidationSuggestions 
}) {
  const [priceChanges, setPriceChanges] = useState(initialPriceChanges)
  const [suggestions, setSuggestions] = useState(initialConsolidationSuggestions)
  
  // Use the data
  return (
    <div>
      {priceChanges.map(change => (
        <PriceChangeCard key={change.id} change={change} />
      ))}
      
      {suggestions.map(suggestion => (
        <SuggestionCard key={suggestion.id} suggestion={suggestion} />
      ))}
    </div>
  )
}
```

---

## Testing

### Manual Testing

1. **Create Price Change:**
   ```sql
   UPDATE subscriptions 
   SET price = 19.99 
   WHERE id = 'your-sub-id';
   ```

2. **Verify History:**
   ```sql
   SELECT * FROM subscription_price_history 
   WHERE subscription_id = 'your-sub-id';
   ```

3. **Check Dashboard:**
   - Refresh page
   - Verify price change appears
   - Check calculations are correct

### Unit Testing

```typescript
import { fetchPriceChanges } from '@/lib/dashboard-data'

describe('fetchPriceChanges', () => {
  it('should return array of price changes', async () => {
    const changes = await fetchPriceChanges('user-id')
    expect(Array.isArray(changes)).toBe(true)
  })
  
  it('should include required fields', async () => {
    const changes = await fetchPriceChanges('user-id')
    if (changes.length > 0) {
      expect(changes[0]).toHaveProperty('subscriptionName')
      expect(changes[0]).toHaveProperty('percentChange')
      expect(changes[0]).toHaveProperty('annualImpact')
    }
  })
})
```

---

## Performance

### Optimization Strategies

1. **Parallel Fetching**
   ```typescript
   const [changes, suggestions] = await Promise.all([
     fetchPriceChanges(userId),
     fetchConsolidationSuggestions(userId),
   ])
   ```

2. **Query Limits**
   - Price changes limited to 50 most recent
   - Prevents large data transfers
   - Keeps UI responsive

3. **Indexed Columns**
   - `user_id` indexed for fast filtering
   - `changed_at` indexed for sorting
   - `subscription_id` indexed for joins

---

## Troubleshooting

### No Price Changes Showing

**Check:**
1. Has any subscription price changed?
2. Is the trigger installed?
   ```sql
   SELECT * FROM pg_trigger 
   WHERE tgname = 'on_subscription_price_change';
   ```
3. Check logs for errors

### No Suggestions Showing

**Check:**
1. Are there active subscriptions?
2. Do subscriptions meet criteria?
   - Duplicates: 2+ in same category
   - Unused: No usage in 60+ days
   - Annual: Monthly billing > $10
3. Check if suggestions are dismissed

### Suggestions Not Filtered

**Check:**
1. Is `dismissed_suggestions` table accessible?
2. Are RLS policies correct?
3. Check logs for filter errors

---

## Best Practices

### DO ✅
- Always filter dismissed suggestions
- Use parallel fetching for performance
- Log errors with context
- Handle empty arrays gracefully
- Validate data before display

### DON'T ❌
- Don't fetch data on every render
- Don't ignore error logs
- Don't assume data exists
- Don't skip dismissed filter
- Don't block on data fetching

---

## Related Files

- **Types:** `client/lib/types/dashboard.ts`
- **Data Logic:** `client/lib/dashboard-data.ts`
- **Page Integration:** `client/app/page.tsx`
- **Documentation:** `ISSUE_494_IMPLEMENTATION_SUMMARY.md`

---

## Support

For questions or issues:
1. Check error logs in console
2. Review this guide
3. Check implementation summary
4. Verify database schema

---

**Last Updated:** 2026-04-27  
**Version:** 1.0
