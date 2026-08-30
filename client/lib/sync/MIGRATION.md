# Offline Sync Migration Guide

## Overview

The offline mutation system has been rebuilt as a durable, ordered queue that replays mutations through the normal API path. This eliminates the security bugs that came from the previous shortcut implementation.

## Security Issues Fixed

### Previous Approach (Deprecated)
- **Shortcut Path**: `POST /api/sync/offline` with duplicated validation logic
- **Issues**:
  1. Creating user_id from client payload (closed issue)
  2. Accepting protected columns in updates (closed issue) 
  3. Bypassing centralized API middleware

### New Approach
- **Unified Path**: Mutations queue durably and replay through `POST/PUT/DELETE /api/subscriptions`
- **Benefits**:
  1. Single validation gate for all mutations
  2. All auth and middleware applies uniformly
  3. Ordered, durable queue prevents data loss
  4. Explicit conflict resolution per operation
  5. User-visible sync status

## Migration Path for Developers

### Before (Old useMutationQueue)
```typescript
const { isOnline, queueMutation } = useMutationQueue()

if (!isOnline) {
  queueMutation("create", subscriptionData)
  // Raw payload queued, validated later
}
```

### After (New useOfflineQueue)
```typescript
import { useOfflineQueue } from '@/hooks/use-offline-queue'
import { type MutationOperation } from '@/lib/sync/mutation-queue'

const { isOnline, queueOperation, conflictMutations } = useOfflineQueue()

if (!isOnline) {
  const operation: MutationOperation = {
    operation: 'create',
    resource: 'subscription',
    payload: subscriptionData,
  }
  const mutationId = await queueOperation(operation)
  
  // UI can track mutation by ID and show conflicts
}
```

## API Route Changes

### Offline Sync Endpoint (`/api/sync/offline`)
- **Status**: DEPRECATED
- **Replacement**: Mutations now replay through `/api/subscriptions`
- **Backward Compatibility**: Returns clear deprecation error

### Subscriptions Endpoint (`/api/subscriptions`)
- **New Unified Path**: All mutations (online/offline) go through here
- **Methods**: `POST` (create), `PUT` (update), `DELETE` (delete)
- **Properties**:
  - Full auth and middleware enforcement
  - Rate limiting
  - Idempotency tracking
  - Centralized validation

## Queue Schema

```typescript
// Mutation operation (same structure as normal API calls)
type MutationOperation = 
  | { operation: 'create', resource: 'subscription', payload: Record<string, unknown> }
  | { operation: 'update', resource: 'subscription', id: string, version?: number, payload: Record<string, unknown> }
  | { operation: 'delete', resource: 'subscription', id: string }

// Queued mutation with metadata
interface QueuedMutation {
  id: string                           // UUID for tracking
  operation: MutationOperation         // Operation details
  status: MutationStatus              // pending|in-flight|resolved|conflict|failed|expired
  
  // Metadata
  queuedAt: string                    // ISO timestamp
  expiresAt: string                   // TTL (7 days by default)
  attempts: number                    // Retry counter
  maxAttempts: number                 // Max retries (5 by default)
  
  // Conflict tracking
  conflictDetails?: {                 // Only for status='conflict'
    serverVersion?: number
    clientVersion?: number
    serverData?: Record<string, unknown>
    resolvedData?: Record<string, unknown>
  }
  conflictResolution: 'last-write-wins' | 'merge' | 'user-prompt'
  
  // Results
  result?: {
    status: number                    // HTTP status code
    data?: Record<string, unknown>    // Response data
    error?: string                    // Error message
  }
}
```

## Storage

### IndexedDB (Primary)
- **Database**: `syncro-queue` (version 1)
- **Store**: `mutations`
- **Indices**: status, operation, expiresAt, attempts
- **Durability**: Survives page reloads, crashes, network disconnections

### Persistence
- Mutations are added to queue immediately before any API call
- Status updates reflect actual response outcomes
- Expired mutations auto-cleanup every 5 minutes

## Conflict Resolution

When a mutation receives a 409 response:

```typescript
// Mutation enters 'conflict' status with details
conflictDetails: {
  serverVersion: 3,
  clientVersion: 2,
  serverData: { /* current server state */ },
  resolvedData: { /* merge attempt */ }
}

// UI prompts user:
await resolveConflictMutation(mutationId, action)
// action: 'accept-server' | 'retry' | 'discard'
```

## Component Integration

### In React Components
```typescript
import { useOfflineQueue } from '@/hooks/use-offline-queue'

export function MyComponent() {
  const { 
    isOnline, 
    pendingMutations, 
    conflictMutations,
    queueOperation,
    resolveConflictMutation,
  } = useOfflineQueue()

  // Show pending count
  if (pendingMutations.length > 0) {
    <Badge>{pendingMutations.length} pending</Badge>
  }

  // Show conflicts needing user input
  if (conflictMutations.length > 0) {
    <Dialog open={true}>
      {conflictMutations.map(m => (
        <ConflictResolver 
          mutation={m}
          onResolve={(action) => resolveConflictMutation(m.id, action)}
        />
      ))}
    </Dialog>
  }
}
```

## Statistics & Debugging

```typescript
const stats = getQueueStats()
// {
//   total: 5,           // Total queued mutations
//   pending: 2,         // Awaiting transmission
//   inFlight: 1,        // Currently transmitting
//   resolved: 1,        // Successfully applied
//   conflict: 1,        // Needs user resolution
//   failed: 0,          // Permanent failure
//   expired: 0,         // Dropped due to TTL
// }
```

## Files Modified

- `client/lib/sync/mutation-queue.ts` - Queue types and configuration
- `client/lib/sync/queue-store.ts` - IndexedDB persistence layer
- `client/lib/sync/queue-processor.ts` - API replay logic
- `client/hooks/use-offline-queue.ts` - React hook for UI integration
- `client/hooks/use-api.ts` - New HTTP client for queue processor
- `client/app/api/subscriptions/route.ts` - New unified mutation API
- `client/app/api/sync/offline/route.ts` - Deprecated (error only)

## Rollback Plan

If issues arise:

1. **Immediate**: Revert the commit
2. **Short-term**: Keep `/api/sync/offline` endpoint accepting mutations (not deprecated)
3. **Long-term**: Parallel run both systems for 2 weeks before full migration

## Testing Checklist

- [ ] Queue persists across page reloads
- [ ] Queue automatically syncs when coming online
- [ ] Conflicts surface to UI with full details
- [ ] Expired mutations auto-cleanup after 7 days
- [ ] Failed mutations show diagnostic details
- [ ] Offline creation followed by update works correctly (ordering)
- [ ] Rate limiting applies equally to online/offline mutations
- [ ] Idempotency keys prevent double-processing
- [ ] No mutations lost on browser crash
- [ ] Service worker sync still functions when online
