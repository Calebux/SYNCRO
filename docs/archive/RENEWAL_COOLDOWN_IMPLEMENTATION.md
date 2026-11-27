# Renewal Cooldown Implementation

## Overview
This implementation prevents rapid repeated renewal attempts that can spam the network and overload the blockchain. It enforces a minimum time gap (cooldown period) between renewal attempts.

## Problem Statement
- Users or systems could click the retry button multiple times rapidly
- This causes unnecessary network traffic and blockchain load
- Multiple failed attempts in quick succession degrade system performance
- No tracking mechanism existed for renewal attempt frequency

## Solution

### 1. Database Schema Changes
File: `backend/scripts/014_add_renewal_cooldown.sql`

#### New Columns
- `last_renewal_attempt_at` (TIMESTAMP): Tracks when the last renewal attempt occurred
- `renewal_cooldown_minutes` (INTEGER): Configurable cooldown period (default: 5 minutes)

#### Helper Functions
- `check_renewal_cooldown()`: Validates if cooldown period is active
- `update_last_renewal_attempt()`: Records renewal attempt timestamp

#### Indexes
- `idx_subscriptions_last_renewal_attempt`: Efficient cooldown status queries

### 2. Core Service: RenewalCooldownService
File: `backend/src/services/renewal-cooldown-service.ts`

#### Public Methods

**`checkCooldown(subscriptionId, customCooldownMinutes?)`**
- Returns: `CooldownCheckResult`
- Validates if a renewal can proceed
- Calculates remaining cooldown time
- Returns next allowed retry time

**`recordRenewalAttempt(subscriptionId, success, errorMessage?, attemptType?)`**
- Records all renewal attempts (successful or failed)
- Updates `last_renewal_attempt_at` timestamp
- Logs attempt type: 'automatic', 'manual', 'retry'

**`setCooldownPeriod(subscriptionId, cooldownMinutes)`**
- Allows per-subscription cooldown customization
- Validates period: 0-1440 minutes
- Returns previous and new settings

**`getCooldownConfig(subscriptionId)`**
- Retrieves cooldown configuration
- Returns last attempt time and next allowed retry time

**`resetCooldown(subscriptionId)`**
- Admin function to immediately allow retry
- Sets `last_renewal_attempt_at` to null

### 3. Integration Points

#### SubscriptionService
- `checkRenewalCooldown()`: Check status endpoint
- `retryBlockchainSync()`: Enforce cooldown during retry attempts
- Records attempt status (success/failure)

#### API Routes
- **GET** `/api/subscriptions/:id/cooldown-status`: Check cooldown status
- **POST** `/api/subscriptions/:id/retry-sync`: Retry with cooldown enforcement
  - Returns 429 (Too Many Requests) if cooldown active
  - Includes `retryAfter` header

#### EventListener
- Records renewal attempts from blockchain events
- Updates `last_renewal_attempt_at` on success/failure
- Tracks attempt type as 'automatic' for automated processes

## Usage Examples

### Check if Renewal Can Be Attempted
```typescript
const cooldownStatus = await renewalCooldownService.checkCooldown(subscriptionId);

if (cooldownStatus.canRetry) {
  // Proceed with renewal
} else {
  console.log(`Wait ${cooldownStatus.timeRemainingSeconds} seconds`);
  // Show user: "Please wait 3 minutes 42 seconds"
}
```

### Record a Renewal Attempt
```typescript
// After successful renewal
await renewalCooldownService.recordRenewalAttempt(
  subscriptionId,
  true,
  undefined,
  'manual'
);

// After failed renewal
await renewalCooldownService.recordRenewalAttempt(
  subscriptionId,
  false,
  'Network timeout',
  'retry'
);
```

### Enforce Cooldown in Retry Endpoint
```typescript
async retryBlockchainSync(userId, subscriptionId) {
  // Automatically checks and enforces cooldown
  const result = await subscriptionService.retryBlockchainSync(
    userId,
    subscriptionId
  );
  // Throws error if cooldown active: "Cooldown period active. Please wait X seconds"
}
```

### Handle Cooldown Errors in Frontend
```typescript
try {
  await fetch(`/api/subscriptions/${id}/retry-sync`, { method: 'POST' });
} catch (error) {
  if (error.status === 429) {
    // Too Many Requests - cooldown active
    const retryAfter = error.headers.get('retry-after');
    showMessage(`Try again in ${retryAfter} seconds`);
  }
}
```

## Configuration

### Default Cooldown Period
- **5 minutes** (300 seconds)
- Configurable per subscription

### Valid Cooldown Range
- Minimum: 0 minutes (no cooldown)
- Maximum: 1440 minutes (24 hours)

### Custom Cooldown Per Subscription
```typescript
// Set 10-minute cooldown for high-volume subscription
await renewalCooldownService.setCooldownPeriod(subscriptionId, 10);
```

## Tracking Features

### Attempt Recording
All attempts are tracked in `subscription_renewal_attempts` table:
- Timestamp of attempt
- Success/failure status
- Error message (if failed)
- Attempt type (automatic/manual/retry)

### Renewal Attempt Types
- `automatic`: Scheduled or blockchain-triggered renewals
- `manual`: User-initiated from UI
- `retry`: Retry after failure

## Error Handling

### Cooldown Active
```
Status: 429 (Too Many Requests)
Body: {
  "success": false,
  "error": "Cooldown period active. Please wait 180 seconds before retrying.",
  "retryAfter": 180
}
```

### Cooldown Check Failure
```
Status: 500
Body: {
  "success": false,
  "error": "Failed to check cooldown: ..."
}
```

## Testing

File: `backend/tests/renewal-cooldown-service.test.ts`

### Test Coverage
- ✅ No previous attempt (canRetry = true)
- ✅ Cooldown active (canRetry = false)
- ✅ Cooldown expired (canRetry = true)
- ✅ Record successful attempt
- ✅ Record failed attempt with error
- ✅ Set custom cooldown period
- ✅ Validate cooldown period bounds
- ✅ Reset cooldown
- ✅ Retrieve cooldown config
- ✅ Integration: Rapid retry prevention workflow

## Database Migration

Run migration to add cooldown support:
```bash
# Via Supabase dashboard:
# Execute SQL file: backend/scripts/014_add_renewal_cooldown.sql

# Or via CLI:
supabase db push
```

## Performance Considerations

### Indexes
- `idx_subscriptions_last_renewal_attempt` ensures O(1) cooldown lookups
- Prevents n+1 queries for batch renewal checks

### Query Optimization
- Single database lookup per cooldown check
- In-memory time calculations (no additional DB queries)

### Scalability
- Stateless design: no session/cache dependencies
- Works across distributed systems
- Safe for horizontal scaling

## Admin Operations

### Reset Cooldown (Emergency)
```typescript
// Immediately allow retry (use with caution)
await renewalCooldownService.resetCooldown(subscriptionId);
```

### Bypass Cooldown (Admin Only)
```typescript
// Force retry ignoring cooldown
await subscriptionService.retryBlockchainSync(
  userId,
  subscriptionId,
  forceBypass = true // Admin flag
);
```

## Future Enhancements

1. **Exponential Backoff**: Increase cooldown after consecutive failures
2. **Rate Limiting**: Limit total attempts per subscription per day
3. **Metrics Dashboard**: Track renewal attempt patterns
4. **Alerts**: Notify admins of suspicious attempt patterns
5. **Adaptive Cooldown**: ML-based cooldown duration optimization

## Related Files
- Database: `backend/src/config/database.ts`
- Logger: `backend/src/config/logger.ts`
- Subscription Service: `backend/src/services/subscription-service.ts`
- Subscription Routes: `backend/src/routes/subscriptions.ts`
- Event Listener: `backend/src/services/event-listener.ts`
- Types: `backend/src/types/risk-detection.ts`
