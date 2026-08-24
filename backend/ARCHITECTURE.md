# Backend architecture

Features are organised under `src/domains` as `subscriptions`, `payments`,
`reminders`, `privacy`, `admin`, and `integrations`. Migration is incremental;
compatibility exports under `src/routes` and `src/services` preserve established
imports and public API paths while application registration uses domain modules.

## Layer dependency rule

```text
route registration -> controller -> service -> repository -> database/client
```

- Controllers own HTTP validation and response mapping. They call services and
  may not import repositories or database clients.
- Services own use cases and transaction orchestration. They may call
  repositories and integration adapters, but never routes or controllers.
- Repositories construct persistence queries and enforce authenticated user
  scope for user-owned data.
- Integration adapters isolate third-party SDKs from controllers.

The backend ESLint configuration rejects controller-to-repository and
service-to-controller/route imports. CI should run `npm run lint` from
`backend`. Subscriptions, payments, and reminders are the first migrated
domains; their existing API prefixes and response shapes remain unchanged.

User-owned persistence uses aggregate repositories for subscriptions,
payments, reminders, tags, audit records, and sessions. Their constructors
require a non-empty user id and inject it into reads and writes. Unscoped
operational tables use `DatabaseRepository`; direct `supabase.from()` calls are
forbidden by lint so query ownership stays visible and testable.

---

# Subscription CRUD Architecture

## Overview

This implementation provides a production-ready subscription CRUD API with enterprise-grade features:

- **Authenticated endpoints** with JWT/cookie support
- **Ownership validation** on every request
- **Blockchain sync** with graceful failure handling
- **Idempotency** for safe retries
- **Race condition prevention** via optimistic locking
- **Partial failure management** (database succeeds, blockchain fails gracefully)

## Architecture Layers

```
┌─────────────────────────────────────────────────────────┐
│                    HTTP Layer (Express)                  │
│  - Routes (/api/subscriptions)                           │
│  - CORS, Cookie Parsing                                  │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│                 Middleware Layer                         │
│  - authenticate: JWT/cookie validation                  │
│  - validateSubscriptionOwnership: ownership check       │
│  - validateBulkSubscriptionOwnership: bulk validation    │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│                 Service Layer                            │
│  - SubscriptionService: Core CRUD + blockchain sync      │
│  - BlockchainService: On-chain contract interaction      │
│  - IdempotencyService: Request deduplication            │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│                 Data Layer                               │
│  - Supabase (PostgreSQL)                                │
│  - Row-Level Security (RLS)                             │
│  - Blockchain Contracts (Soroban)                       │
└─────────────────────────────────────────────────────────┘
```

## Request Flow

### Create Subscription Flow

```
1. Client Request
   ├─ Headers: Authorization, Idempotency-Key
   └─ Body: { name, price, billing_cycle, ... }

2. Authentication Middleware
   ├─ Extract token from header/cookie
   ├─ Verify with Supabase Auth
   └─ Attach user to request

3. Idempotency Check (if key provided)
   ├─ Hash request payload
   ├─ Check for existing record
   └─ Return cached response if duplicate

4. Subscription Service
   ├─ Database Transaction Start
   ├─ Insert subscription (atomic)
   ├─ Attempt blockchain sync (non-blocking)
   └─ Return result with sync status

5. Response
   ├─ 201: Success + blockchain synced
   ├─ 207: Success + blockchain failed (partial)
   └─ 500: Database failure
```

### Update/Delete Flow

```
1. Client Request
   ├─ Headers: Authorization, Idempotency-Key, If-Match (optional)
   └─ Body: { updates... }

2. Authentication + Ownership Validation
   ├─ Verify user owns subscription
   └─ Load current subscription state

3. Optimistic Locking (if If-Match provided)
   ├─ Check version matches
   └─ Reject if conflict

4. Subscription Service
   ├─ Database Transaction
   ├─ Update/Delete subscription
   ├─ Attempt blockchain sync
   └─ Return result

5. Response
   ├─ 200: Success
   ├─ 207: Partial success (blockchain failed)
   └─ 409: Version conflict
```

## Key Components

### 1. Authentication Middleware (`middleware/auth.ts`)

- Supports Bearer tokens and HTTP-only cookies
- Verifies JWT with Supabase Auth
- Attaches user to request object

### 2. Ownership Validation (`middleware/ownership.ts`)

- Validates user owns subscription before operations
- Supports single and bulk operations
- Returns 403 if ownership check fails

### 3. Subscription Service (`services/subscription-service.ts`)

**Features:**
- Atomic database operations
- Blockchain sync with graceful failure
- Optimistic locking support
- Transaction management

**Methods:**
- `createSubscription()`: Create with blockchain sync
- `updateSubscription()`: Update with version checking
- `deleteSubscription()`: Delete with blockchain sync
- `getSubscription()`: Get with ownership check
- `listSubscriptions()`: List with filtering/pagination
- `retryBlockchainSync()`: Retry failed syncs

### 4. Blockchain Service (`services/blockchain-service.ts`)

**Features:**
- Database-first logging
- Non-blocking blockchain writes
- Error recovery
- Transaction hash tracking

**Methods:**
- `syncSubscription()`: Sync create/update/delete to chain
- `logReminderEvent()`: Log reminder events (existing)
- `getUserLogs()`: Get blockchain logs for user

### 5. Idempotency Service (`services/idempotency.ts`)

**Features:**
- Request deduplication
- 24-hour TTL
- Hash-based matching
- Cached response storage

**How it works:**
1. Client sends `Idempotency-Key` header
2. Server hashes request payload
3. Checks for existing key + user + hash
4. Returns cached response if found
5. Stores response for future requests

### 6. Transaction Utility (`utils/transaction.ts`)

- Wraps database operations
- Error handling and rollback logic
- Compensating actions pattern for multi-step ops

## Database Schema

### Tables

1. **subscriptions** (existing)
   - User subscriptions
   - RLS policies enforce ownership

2. **idempotency_keys** (new)
   - Request deduplication
   - Unique constraint on (key, user_id, request_hash)
   - Auto-expires after 24 hours

3. **blockchain_logs** (existing)
   - Blockchain sync status
   - Transaction hashes
   - Error tracking

## Error Handling Strategy

### Partial Failures

**Scenario**: Database succeeds, blockchain fails

**Response:**
```json
{
  "success": true,
  "data": {...},
  "blockchain": {
    "synced": false,
    "error": "Network timeout"
  }
}
```

**Status Code**: `207 Multi-Status`

**Recovery**: Use `/retry-sync` endpoint

### Race Conditions

**Scenario**: Concurrent updates

**Prevention:**
1. Optimistic locking (`If-Match` header)
2. Database constraints
3. RLS policies

**Response**: `409 Conflict` if version mismatch

### Idempotency

**Scenario**: Duplicate request

**Response**: Cached response from first request

**Status Code**: Same as original request

## Security Features

1. **Authentication Required**: All endpoints protected
2. **Ownership Validation**: Every request checks ownership
3. **RLS Policies**: Database-level access control
4. **Input Validation**: Request payload validation
5. **SQL Injection Protection**: Parameterized queries

## Performance Considerations

1. **Database Indexes**: On user_id, status, category
2. **Idempotency Caching**: Reduces duplicate processing
3. **Non-blocking Blockchain**: Doesn't slow down database ops
4. **Pagination**: Limits result sets
5. **Connection Pooling**: Supabase handles this

## Monitoring & Observability

### Logging

- All operations logged with context
- Blockchain sync failures logged separately
- Idempotency hits logged

### Metrics to Track

- Request latency
- Blockchain sync success rate
- Idempotency hit rate
- Ownership validation failures
- Partial failure rate

## Testing Strategy

### Unit Tests

- Service methods
- Middleware functions
- Idempotency logic

### Integration Tests

- Full request flows
- Blockchain sync scenarios
- Race condition handling
- Partial failure recovery

### Load Tests

- Concurrent requests
- Idempotency under load
- Database connection limits

## Deployment Checklist

1. Run database migrations (idempotency table)
2. Set environment variables
3. Configure CORS for frontend
4. Set up blockchain contract address
5. Configure Supabase RLS policies
6. Set up monitoring/logging
7. Test authentication flow
8. Test blockchain sync
9. Test idempotency
10. Load test endpoints

## Future Enhancements

1. **Event Sourcing**: Full audit trail
2. **Webhooks**: External notifications
3. **Rate Limiting**: Per-user limits
4. **Caching**: Redis for hot data
5. **GraphQL**: Alternative API layer
6. **Versioning**: API versioning
7. **Batch Operations**: Optimized bulk ops
