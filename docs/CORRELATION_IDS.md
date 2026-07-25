# Request Correlation IDs

## Overview

Every HTTP request and async job in the backend carries a **correlation ID** (`requestId`) that flows automatically through all log entries, audit events, async call stacks, Sentry breadcrumbs, and blockchain transaction data via Node.js `AsyncLocalStorage`.

**NEW:** Correlation IDs now propagate end-to-end from client → backend → blockchain contract calls, and are persisted in renewal tables for complete traceability.

## How It Works

### Client → Backend Propagation

**Client Side (`client/lib/api.ts`):**
- Automatically generates a correlation ID for every API request (format: `client:<uuid-v4>`)
- Sends correlation ID in `X-Correlation-ID` header
- Captures returned correlation ID from server response headers
- Available via `getLastCorrelationId()` for debugging

**Example client usage:**
```typescript
import { getLastCorrelationId } from '@/lib/api';

try {
  await apiPost('/api/subscriptions', data);
  console.log('Request correlation ID:', getLastCorrelationId());
} catch (error) {
  console.error('Failed with correlation ID:', getLastCorrelationId());
}
```

### HTTP Requests

`requestIdMiddleware` (registered first in `backend/src/index.ts`) assigns a **UUID v7** (time-ordered) correlation ID to every request:

1. If the client sends `X-Correlation-ID` or `X-Request-ID`, that value is reused.
2. If the upstream load balancer sends these headers, they are preserved.
3. Otherwise a new `uuidv7()` is generated (time-ordered, better database index locality).
4. The ID is stored in `AsyncLocalStorage` and echoed back in both the canonical `X-Correlation-ID` and legacy `x-request-id` response headers.
5. A Sentry breadcrumb is recorded with the correlation ID for end-to-end tracing in Sentry.

The Winston logger reads the store on every log call and injects `requestId` (and `userId` when available) automatically — no manual propagation needed.

### Async Jobs (Cron)

Cron jobs use `runWithCorrelationId(label, fn)` from `backend/src/middleware/requestContext.ts`:

```ts
runWithCorrelationId('cron:process-reminders', async (cid) => {
  logger.info('Starting', { correlationId: cid }); // also auto-injected by logger
  await reminderEngine.processReminders();
});
```

The generated ID has the format `<label>:<uuid-v7>`, e.g. `cron:process-reminders:019f107b…`.

### Renewal Execution

**NEW:** All renewal operations now capture and persist correlation IDs:

- `renewal_logs` table includes `correlation_id` column
- `subscription_renewal_attempts` table includes `correlation_id` column
- `renewal_dead_letter_queue` table includes `correlation_id` column
- `renewal_attempts` table includes `correlation_id` column

All renewal log entries, success or failure, include the correlation ID for tracing.

### Blockchain Contract Calls

**NEW:** Enhanced logging for contract invocations:

All blockchain operations now log correlation IDs at every step:
- Contract invocation start
- Each retry attempt
- Transaction submission
- Transaction confirmation
- Failure and DLQ enqueueing

All blockchain log entries (`blockchain_logs`) include the correlation ID in the `event_data` payload as `correlationId`, enabling end-to-end tracing from API request → database → blockchain transaction.

### Webhook Deliveries

**NEW:** Webhook payloads now include correlation IDs:

When dispatching webhooks, the correlation ID is included in the event payload, allowing external systems to trace events back to the originating request.

```json
{
  "id": "evt_abc123",
  "type": "subscription.renewed",
  "created": 1234567890,
  "data": {
    "subscription_id": "sub_xyz",
    "transaction_hash": "tx_hash"
  },
  "correlationId": "client:abc-123-def-456"
}
```

### Audit Events

`auditApiKeyEvent` reads `getRequestId()` and stores the correlation ID in `metadata.correlationId` so audit log entries can be cross-referenced with application logs.

### Sentry Breadcrumbs

Each request adds a Sentry breadcrumb with the correlation ID. This allows the Sentry dashboard to show the correlation ID in every error/event's breadcrumb trail, making it easy to jump from a Sentry alert to the relevant application logs.

## Tracing a Request

### End-to-End Tracing (Client → Backend → Blockchain)

1. **From Client**: Find the correlation ID in browser console or network tab
   ```javascript
   import { getLastCorrelationId } from '@/lib/api';
   console.log('Correlation ID:', getLastCorrelationId());
   ```

2. **From Response Headers**: Check `X-Correlation-ID` or `x-request-id` in the API response

3. **Application Logs**: Search by correlation ID
   ```bash
   grep '"requestId":"<id>"' logs/combined-*.log
   ```

4. **Renewal Logs**: Query database
   ```sql
   SELECT * FROM renewal_logs WHERE correlation_id = '<id>';
   SELECT * FROM subscription_renewal_attempts WHERE correlation_id = '<id>';
   ```

5. **Blockchain Logs**: Cross-reference blockchain operations
   ```sql
   SELECT * FROM blockchain_logs WHERE event_data->>'correlationId' = '<id>';
   ```

6. **Audit Logs**: Query audit trail
   ```sql
   SELECT * FROM audit_logs WHERE metadata->>'correlationId' = '<id>';
   ```

7. **Sentry**: Search breadcrumbs for the correlation ID to find related events

### Example: Tracing a Renewal

Given correlation ID: `client:abc-123-def-456`

```bash
# 1. Find all backend logs for this request
grep '"requestId":"client:abc-123-def-456"' logs/combined-*.log

# 2. Check renewal execution
psql -c "SELECT * FROM renewal_logs WHERE correlation_id = 'client:abc-123-def-456'"

# 3. Find blockchain transaction
psql -c "SELECT * FROM blockchain_logs WHERE event_data->>'correlationId' = 'client:abc-123-def-456'"

# 4. Check webhook deliveries
psql -c "SELECT * FROM webhook_deliveries WHERE payload->>'correlationId' = 'client:abc-123-def-456'"
```

## Passing IDs to External Providers

When making outbound HTTP calls to external providers, forward the correlation ID as a header:

```ts
import { getRequestId } from '../middleware/requestContext';

fetch(url, {
  headers: { 'X-Correlation-ID': getRequestId() ?? '' },
});
```

This is recommended for any new provider integrations.

## Database Schema

### New Columns (Migration: 20260724000000)

The following tables now include `correlation_id TEXT` columns:
- `renewal_logs`
- `subscription_renewal_attempts`
- `renewal_dead_letter_queue`
- `renewal_attempts`

All include indexes for efficient lookup:
```sql
CREATE INDEX idx_renewal_logs_correlation_id ON renewal_logs(correlation_id);
```

## Testing

Run the correlation ID integration tests:

```bash
npm test correlation-id-flow.test.ts
```

The test suite verifies:
- ✅ Client headers are accepted
- ✅ Response headers are returned
- ✅ AsyncLocalStorage propagation works
- ✅ Logger auto-injection works
- ✅ Sentry breadcrumbs are created
- ✅ Correlation IDs persist across async operations

## Troubleshooting

### Correlation ID Not Appearing in Logs

1. Check that `requestIdMiddleware` is registered **first** in your Express app
2. Verify `requestContextFormat()` is in the logger's format pipeline
3. Ensure you're calling logger methods, not `console.log`

### Correlation ID Lost in Async Operations

1. Verify all async operations stay within the AsyncLocalStorage context
2. Avoid creating new execution contexts (e.g., spawning child processes)
3. Use `runWithCorrelationId()` for background jobs

### Client Not Sending Correlation ID

1. Check that axios interceptors are configured in `client/lib/api.ts`
2. Verify `uuid` package is installed
3. Check browser network tab for `X-Correlation-ID` header

## Best Practices

1. **Always use the logger**: Don't use `console.log` - use `logger.info/warn/error`
2. **Include in error responses**: Return correlation ID in API error responses for client debugging
3. **External integrations**: Forward correlation ID to external services when possible
4. **Documentation**: Include correlation ID in API documentation for debugging
5. **Retention**: Keep correlation ID data for at least 30 days for troubleshooting

## Migration Notes

### For Existing Deployments

1. Apply database migration: `20260724000000_add_correlation_id_to_renewal_tables.sql`
2. Update client dependencies: `npm install uuid`
3. No code changes required - correlation IDs will populate automatically
4. Existing logs without correlation IDs remain queryable by other fields

### Backward Compatibility

- Both `X-Correlation-ID` (new) and `x-request-id` (legacy) headers are supported
- Tables without correlation ID columns will continue to work (columns are nullable)
- Existing code that doesn't use correlation IDs remains functional

