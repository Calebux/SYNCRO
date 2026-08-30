# Dead-Letter Handling for Webhook Deliveries and Notification Jobs

## Overview

This document describes the implementation of dead-letter handling for webhook deliveries and notification jobs in SYNCRO. Dead-letter queuing is a failure handling pattern that safely separates failed messages/jobs that have exhausted all retries into a separate "dead-letter" queue, allowing operators to inspect, diagnose, and replay them safely.

## Problem Statement

Previously, failed webhook deliveries and notification jobs would remain in the system with limited visibility into their failure reasons. Terminal failures after retry exhaustion were not explicitly tracked, making it difficult for operators to:
- Inspect what went wrong
- Understand failure patterns
- Safely retry failed deliveries
- Detect duplicate replay attempts

## Solution Architecture

### Components

#### 1. Database Schema
- **webhook_deliveries** (extended with dead-letter fields)
  - `is_dead_letter`: Boolean flag marking delivery as dead-letter
  - `dead_letter_at`: Timestamp when moved to dead-letter
  - `dead_letter_reason`: Human-readable reason for dead-letter status
  - `last_error_message`: Final error message from last attempt

- **webhook_dead_letter_replays**: Tracks replay attempts with idempotency
  - `webhook_delivery_id`: Foreign key to the original delivery
  - `idempotency_key`: UUID for duplicate protection
  - `replay_request_by`: User ID of operator requesting replay
  - `status`: 'pending' | 'processing' | 'success' | 'failed'

- **notification_dead_letter_queue**: Dead-letter entries for notification jobs
  - `user_id`: Affected user
  - `job_type`: 'push' | 'sms' | 'email'
  - `job_data`: Full job payload (JSONB)
  - `original_job_id`: BullMQ job ID
  - `failure_count`: Number of failed attempts

- **notification_dead_letter_replays**: Tracks notification replay attempts
  - `notification_dlq_id`: Foreign key to DLQ entry
  - `idempotency_key`: Duplicate protection

#### 2. Services

**WebhookDeadLetterService** (`backend/src/services/webhook-dead-letter-service.ts`)
- `moveToDeadLetter()`: Move delivery to dead-letter state
- `getDeadLetterDeliveries()`: Retrieve dead-letter deliveries
- `createReplayRequest()`: Create replay request with idempotency
- `executeReplay()`: Execute replay attempt
- `getReplayHistory()`: Track all replay attempts
- `getDeadLetterStats()`: Metrics and statistics

**NotificationDeadLetterService** (`backend/src/services/notification-dead-letter-service.ts`)
- Similar API to WebhookDeadLetterService
- Integrates with BullMQ notification queue
- Re-enqueues jobs on successful replay

#### 3. Integration Points

**Webhook Service** (`backend/src/services/webhook-service.ts`)
- Modified `handleDeliveryFailure()` to move to dead-letter after MAX_RETRIES (5)
- Delegates dead-letter operations to WebhookDeadLetterService

**Notification Queue** (`backend/src/jobs/notification-queue.ts`)
- Enhanced `failed` event handler to capture failed jobs
- Automatically moves to dead-letter when all retry attempts exhausted (4 total)

## API Endpoints

### Webhook Dead-Letter Endpoints

#### Get all dead-letter deliveries (user scope)
```
GET /api/webhooks/dead-letter/all
Authorization: Bearer <token>

Response:
{
  "success": true,
  "data": [
    {
      "id": "delivery-uuid",
      "webhook_id": "webhook-uuid",
      "event_type": "subscription.renewal_failed",
      "payload": { ... },
      "response_code": 500,
      "response_body": "Internal Server Error",
      "status": "failed",
      "retry_count": 5,
      "is_dead_letter": true,
      "dead_letter_at": "2026-05-27T10:30:00Z",
      "dead_letter_reason": "Exhausted 5 retries",
      "last_error_message": "HTTP 500: Connection refused"
    }
  ]
}
```

#### Get dead-letter deliveries for specific webhook
```
GET /api/webhooks/:webhookId/dead-letter
Authorization: Bearer <token>
```

#### Get dead-letter statistics
```
GET /api/webhooks/dead-letter/stats
Authorization: Bearer <token>

Response:
{
  "success": true,
  "data": {
    "total_dead_letters": 42,
    "dead_letters_24h": 3,
    "dead_letters_7d": 12,
    "by_webhook": [
      {
        "webhook_id": "webhook-uuid",
        "webhook_url": "https://customer.example.com/webhooks",
        "count": 5,
        "most_recent": "2026-05-27T10:30:00Z"
      }
    ]
  }
}
```

#### Create replay request (idempotent)
```
POST /api/webhooks/:deliveryId/dead-letter/replay
Authorization: Bearer <token>
Content-Type: application/json

Request Body:
{
  "idempotency_key": "uuid-v4" // optional, generated if not provided
}

Response:
{
  "success": true,
  "data": {
    "id": "replay-uuid",
    "webhook_delivery_id": "delivery-uuid",
    "idempotency_key": "uuid-v4",
    "replay_request_by": "user-uuid",
    "status": "pending",
    "created_at": "2026-05-27T10:31:00Z"
  }
}
```

#### Get replay history
```
GET /api/webhooks/:deliveryId/dead-letter/replay-history
Authorization: Bearer <token>

Response:
{
  "success": true,
  "data": [
    {
      "id": "replay-uuid",
      "status": "success",
      "response_code": 200,
      "attempted_at": "2026-05-27T10:31:00Z",
      "completed_at": "2026-05-27T10:31:05Z"
    },
    {
      "id": "replay-uuid-2",
      "status": "failed",
      "response_code": 503,
      "error_message": "Service Unavailable",
      "attempted_at": "2026-05-27T10:32:00Z",
      "completed_at": "2026-05-27T10:32:02Z"
    }
  ]
}
```

#### Execute replay
```
POST /api/webhooks/dead-letter/replay/:replayId/execute
Authorization: Bearer <token>

Response:
{
  "success": true,
  "data": {
    "id": "replay-uuid",
    "status": "success",
    "response_code": 200,
    "response_body": "{\"success\": true}",
    "completed_at": "2026-05-27T10:31:05Z"
  }
}
```

### Notification Dead-Letter Endpoints

#### Get all dead-letter notifications
```
GET /api/notifications/dead-letter
Authorization: Bearer <token>

Response:
{
  "success": true,
  "data": [
    {
      "id": "dlq-uuid",
      "user_id": "user-uuid",
      "job_type": "push",
      "job_data": { ... },
      "original_job_id": "bullmq-job-id",
      "failure_count": 4,
      "last_error_message": "Push subscription expired",
      "dead_letter_at": "2026-05-27T10:30:00Z"
    }
  ]
}
```

#### Get dead-letter statistics
```
GET /api/notifications/dead-letter/stats
Authorization: Bearer <token>

Response:
{
  "success": true,
  "data": {
    "total_dead_letters": 15,
    "dead_letters_24h": 2,
    "dead_letters_7d": 8,
    "by_type": [
      {
        "job_type": "push",
        "count": 12,
        "most_recent": "2026-05-27T10:30:00Z"
      },
      {
        "job_type": "sms",
        "count": 3
      }
    ]
  }
}
```

#### Create replay request (notification)
```
POST /api/notifications/dead-letter/:dlqId/replay
Authorization: Bearer <token>

Response:
{
  "success": true,
  "data": {
    "id": "replay-uuid",
    "notification_dlq_id": "dlq-uuid",
    "status": "pending"
  }
}
```

#### Execute replay (notification)
```
POST /api/notifications/dead-letter/replay/:replayId/execute
Authorization: Bearer <token>

Response:
{
  "success": true,
  "data": {
    "id": "replay-uuid",
    "status": "queued",
    "original_job_id": "new-bullmq-job-id"
  }
}
```

## Acceptance Criteria Verification

### ✅ Criterion 1: Failed deliveries move to dead-letter state after retry exhaustion

**Implementation:**
- Webhooks: In `WebhookService.handleDeliveryFailure()`, when `retryCount > MAX_RETRIES (5)`, the delivery is moved to dead-letter via `webhookDeadLetterService.moveToDeadLetter()`
- Notifications: BullMQ job handler moves jobs to dead-letter when `attemptsMade >= (RETRY_DELAYS.length + 1)` in the `notificationWorker.on('failed')` event

**Verification:**
- Database fields set: `is_dead_letter = true`, `dead_letter_at = NOW()`
- `dead_letter_reason` captures why: "Exhausted 5 retries"
- `last_error_message` contains final error details
- Tests: `dead-letter-service.test.ts` - `moveToDeadLetter` test cases

### ✅ Criterion 2: Operators can inspect and replay deliveries safely

**Inspection:**
- `GET /api/webhooks/dead-letter/all` - View all dead-letter deliveries
- `GET /api/webhooks/:webhookId/dead-letter` - View specific webhook's failures
- Response includes: response codes, error messages, payloads for debugging
- `GET /api/webhooks/dead-letter/stats` - Metrics and aggregates

**Safe Replay:**
- `POST /api/webhooks/:deliveryId/dead-letter/replay` - Creates replay request
- Original delivery is not modified until replay succeeds
- `X-Syncro-Replay` header identifies replay attempts
- Webhook receives same payload as original
- On success: original delivery status updated to 'success', webhook failure count decremented

**Tests:** `dead-letter-api.test.ts` - Integration tests for retrieval and replay

### ✅ Criterion 3: Tests cover duplicate replay protection

**Idempotency Implementation:**
- Each replay request includes unique `idempotency_key` (UUID)
- Database constraint: `UNIQUE(idempotency_key)` on both replay tables
- On duplicate: Returns existing replay request instead of creating new one
- Prevents accidental double-replays from network retries

**Test Coverage:**
- `dead-letter-service.test.ts`: 
  - `createReplayRequest` handles duplicate keys
  - Returns existing replay when constraint violation occurs
- `dead-letter-api.test.ts`:
  - Acceptance criteria: "should prevent duplicate replays with same idempotency key"
  - Verifies same replay ID returned on duplicate requests

## Operational Usage Guide

### Monitoring Dead-Letter Queues

```bash
# Get statistics
curl -H "Authorization: Bearer $TOKEN" \
  https://api.example.com/api/webhooks/dead-letter/stats

# Monitor for recent failures (24h)
curl -H "Authorization: Bearer $TOKEN" \
  https://api.example.com/api/webhooks/dead-letter/all | \
  jq '.data[] | select(.dead_letter_at > now - 86400)'
```

### Replaying Failed Deliveries

```bash
# 1. Inspect the failure
curl -H "Authorization: Bearer $TOKEN" \
  https://api.example.com/api/webhooks/webhook-123/dead-letter

# 2. Create replay request
REPLAY=$(curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"idempotency_key": "'"$(uuidgen)"'"}' \
  https://api.example.com/api/webhooks/delivery-123/dead-letter/replay)

REPLAY_ID=$(echo $REPLAY | jq -r '.data.id')

# 3. Execute replay
curl -X POST -H "Authorization: Bearer $TOKEN" \
  https://api.example.com/api/webhooks/dead-letter/replay/$REPLAY_ID/execute

# 4. Check replay history
curl -H "Authorization: Bearer $TOKEN" \
  https://api.example.com/api/webhooks/delivery-123/dead-letter/replay-history
```

### Bulk Replay Operations

For bulk replays, iterate through dead-letter deliveries and create replay requests:

```bash
# Get all dead-letter deliveries
DELIVERIES=$(curl -H "Authorization: Bearer $TOKEN" \
  https://api.example.com/api/webhooks/dead-letter/all | jq -r '.data[].id')

# Create replay requests for all
for delivery_id in $DELIVERIES; do
  curl -X POST -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}' \
    https://api.example.com/api/webhooks/$delivery_id/dead-letter/replay
done
```

## Database Schema Changes

### New Tables

See migration: `backend/migrations/20260527000000_add_dead_letter_handling.sql`

```sql
-- Extended webhook_deliveries table
ALTER TABLE webhook_deliveries 
  ADD COLUMN IF NOT EXISTS dead_letter_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_dead_letter BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS dead_letter_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_error_message TEXT;

-- New replay tracking tables
CREATE TABLE webhook_dead_letter_replays (...)
CREATE TABLE notification_dead_letter_queue (...)
CREATE TABLE notification_dead_letter_replays (...)

-- Views for metrics
CREATE OR REPLACE VIEW webhook_dead_letter_stats AS (...)
CREATE OR REPLACE VIEW notification_dead_letter_stats AS (...)
```

## Security Considerations

1. **Row-Level Security (RLS):**
   - Dead-letter tables have RLS policies enabled
   - Users can only view their own dead-letter deliveries
   - Operators must authenticate with valid JWT token

2. **Idempotency Keys:**
   - Prevent accidental duplicate replays
   - Should be generated client-side and included in requests
   - Server generates if not provided

3. **Replay Headers:**
   - Webhooks receive `X-Syncro-Replay: true` header
   - Webhooks receive `X-Syncro-Replay-Id: <replayId>` for tracking
   - Allows webhooks to detect and deduplicate replay attempts

4. **Error Information:**
   - Error details limited to 1000 characters in response_body
   - Full error messages in last_error_message for debugging
   - Sensitive information redacted by logger

## Performance Considerations

1. **Indexes:**
   - `is_dead_letter` indexed for fast filtering
   - `dead_letter_at` indexed for time-range queries
   - `idempotency_key` unique index for duplicate prevention

2. **Retention Policies:**
   - Dead-letter entries retained indefinitely
   - Consider archival after 30-90 days
   - Replay history retained with dead-letter entries

3. **Views:**
   - Statistics views materialized (not auto-refreshed)
   - Consider periodic materialization for high-volume systems

## Troubleshooting

### Issue: Deliveries not moving to dead-letter

**Cause:** MAX_RETRIES not reached
- Webhook: Check `retry_count` in database
- Notification: Check `attemptsMade` in BullMQ UI

**Solution:** Wait for final retry or manually move if misconfigured

### Issue: Replay execution fails

**Cause:** Webhook endpoint still returning errors
**Solution:** 
1. Check webhook endpoint logs
2. Verify webhook URL is still valid
3. Check `response_code` and `response_body` in dead-letter entry

### Issue: Duplicate replay protection not working

**Cause:** No `idempotency_key` provided
**Solution:** Provide explicit UUID in replay request body

## Testing

Comprehensive test suites available:
- **Unit tests:** `backend/tests/dead-letter-service.test.ts`
- **Integration tests:** `backend/tests/dead-letter-api.test.ts`
- **Acceptance criteria tests:** All three criteria verified in test files

Run tests:
```bash
npm test -- --testPathPattern="dead-letter"
```

## Future Enhancements

1. **Automated Retry Schedules:** Configure automatic replay attempts based on failure patterns
2. **Webhook Webhook for Dead-Letters:** Notify webhook owners of dead-letter events
3. **Analytics Dashboard:** Real-time metrics on dead-letter queue health
4. **Circuit Breaker Enhancement:** Temporary webhook disabling instead of permanent
5. **DLQ Purging:** Automatic cleanup policies for old dead-letter entries

## References

- [Dead-Letter Queue Pattern](https://en.wikipedia.org/wiki/Dead_letter_queue)
- BullMQ: https://docs.bullmq.io/
- Webhook Delivery Retry Strategy: RFC 7320
- Idempotency: RFC 9110 Section 9.1
