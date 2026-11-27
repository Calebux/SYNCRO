# Channel Signer Lease Implementation

## Problem Statement

When two engine instances sign states for the same payment channel concurrently, they can produce two different states at the same nonce. Only one state can win on-chain, and the losing state's usage becomes unbacked, creating a security and accounting issue.

## Solution Overview (2% Implementation)

This implementation provides the foundational infrastructure for preventing concurrent channel state signing:

### 1. Database-Backed Lease Table (`channel_signer_lease`)

A PostgreSQL table that tracks which instance holds the exclusive right to sign states for each channel:

```sql
CREATE TABLE channel_signer_lease (
  channel_id UUID PRIMARY KEY,
  instance_id TEXT NOT NULL,
  lease_acquired_at TIMESTAMPTZ NOT NULL,
  lease_expires_at TIMESTAMPTZ NOT NULL,
  last_nonce_allocated BIGINT NOT NULL DEFAULT 0,
  ...
);
```

**Key Features:**
- One lease per channel (enforced by PRIMARY KEY on `channel_id`)
- Bounded lease term via `lease_expires_at`
- Tracks last allocated nonce for atomic allocation
- Instance identification via `instance_id`

### 2. Atomic Database Functions

Three PostgreSQL functions provide the core lease operations:

#### `acquire_channel_signer_lease()`
- Attempts to acquire or renew a lease
- Uses `FOR UPDATE` lock to prevent race conditions
- Checks lease validity and ownership
- Allows takeover of expired leases
- Returns success status and current nonce

#### `allocate_next_nonce()`
- Atomically allocates the next sequential nonce
- Verifies lease ownership before allocation
- Checks lease validity (not expired)
- Prevents nonce allocation without valid lease
- Returns allocated nonce or failure reason

#### `release_channel_signer_lease()`
- Explicitly releases a held lease
- Verifies ownership before release
- Enables graceful shutdown

### 3. TypeScript Service Layer (`ChannelSignerLeaseService`)

A service class that wraps the database functions and provides high-level APIs:

```typescript
class ChannelSignerLeaseService {
  // Unique instance identifier
  private readonly instanceId: string;
  
  // Acquire or renew lease
  async acquireLease(channelId: string, leaseDurationSeconds?: number): Promise<LeaseAcquisitionResult>
  
  // Atomically allocate next nonce
  async allocateNonce(channelId: string): Promise<NonceAllocationResult>
  
  // Release held lease
  async releaseLease(channelId: string): Promise<boolean>
  
  // Safe signing wrapper
  async signWithLease<T>(channelId: string, signFn: (nonce: number) => Promise<T>): Promise<T>
  
  // Check lease ownership
  async holdsLease(channelId: string): Promise<boolean>
}
```

**Key Features:**
- Each instance gets a unique `instanceId` (random bytes + PID)
- `signWithLease()` provides safe signing workflow
- Comprehensive logging for debugging and auditing
- Type-safe interfaces

### 4. Test Coverage

Basic test suite (`channel-signer-lease.test.ts`) verifies:

- ✅ Single instance can acquire lease
- ✅ Nonces are allocated sequentially
- ✅ Second instance is blocked from active lease
- ✅ Nonce allocation requires valid lease
- ✅ Expired leases can be taken over
- ✅ Lease can be explicitly released
- ✅ `holdsLease()` correctly reports ownership
- ✅ `signWithLease()` enforces lease protection

## What This Implementation Achieves (2%)

1. **Infrastructure Foundation**: Database schema and functions for lease management
2. **Basic Lease Acquisition**: Instances can acquire and renew leases
3. **Atomic Nonce Allocation**: Nonces are allocated sequentially and atomically
4. **Concurrency Prevention**: Second instance cannot acquire active lease
5. **Expiry Handling**: Stale leases can be taken over after expiration
6. **Test Coverage**: Basic test suite verifies core functionality

## What's NOT Yet Implemented (98%)

### Integration with Payment Channel Service
- [ ] Modify `payment-channel-service.ts` to use `signWithLease()`
- [ ] Update `signState()` to accept nonce parameter
- [ ] Refactor state signing to use allocated nonces

### Lease Renewal Strategy
- [ ] Background job to renew leases periodically
- [ ] Configurable lease duration based on load
- [ ] Graceful lease handoff during deployment

### Partition Recovery
- [ ] Handling network partitions where instance thinks it has lease
- [ ] Fencing tokens to prevent split-brain scenarios
- [ ] Detection of lease loss before signing

### Multi-Instance Chaos Testing
- [ ] Simulate concurrent signing attempts
- [ ] Verify no duplicate nonces under high contention
- [ ] Test stalled-then-resumed instance scenarios
- [ ] Partition testing with network delays

### Production Hardening
- [ ] Lease monitoring and alerting
- [ ] Metrics for lease contention
- [ ] Dead instance cleanup (zombie lease detection)
- [ ] Circuit breaker for lease acquisition failures

### Edge Cases
- [ ] Clock skew between instances and database
- [ ] Database connection failures during signing
- [ ] Long-running transactions blocking lease acquisition
- [ ] Lease expiry during multi-step signing operation

## Usage Example

```typescript
import { channelSignerLeaseService } from './services/channel-signer-lease-service';

async function signChannelState(channelId: string) {
  try {
    const signedState = await channelSignerLeaseService.signWithLease(
      channelId,
      async (nonce) => {
        // This function is only called if lease is held
        const state = {
          sequenceNumber: nonce,
          userBalance: 900,
          executorBalance: 100,
          totalDeposited: 1000,
        };
        
        const signature = signState(state, channelId);
        return { state, signature };
      }
    );
    
    console.log('Signed state with nonce:', signedState.state.sequenceNumber);
  } catch (error) {
    console.error('Failed to sign:', error.message);
    // Handle lease acquisition failure
  }
}
```

## Next Steps

To complete the remaining 98%, prioritize:

1. **Integration** (next 20%): Connect lease service to actual signing flow
2. **Testing** (next 30%): Multi-instance chaos tests and partition scenarios  
3. **Monitoring** (next 20%): Lease metrics, alerting, and observability
4. **Hardening** (remaining 28%): Edge cases, recovery, production deployment

## Architecture Decision Records

### Why Database-Backed Lease Instead of Redis?
- **Durability**: PostgreSQL provides ACID guarantees
- **Consistency**: `FOR UPDATE` prevents race conditions
- **Integration**: Already using Supabase/Postgres
- **Observability**: Standard SQL tooling for debugging

Trade-off: Slightly higher latency than Redis, but better consistency guarantees.

### Why Bounded Lease Term?
- Prevents zombie instances from holding leases indefinitely
- Enables automatic recovery from stalled instances
- Typical duration: 30 seconds (configurable)

Trade-off: Requires lease renewal logic, but provides fault tolerance.

### Why Instance-Level Granularity?
- Each process instance gets unique ID (random + PID)
- Enables tracking which instance holds which channel
- Supports multi-instance deployment

Trade-off: More complex than single-instance, but required for horizontal scaling.

## References

- Migration: `supabase/migrations/20260902000000_create_channel_signer_lease.sql`
- Service: `backend/src/services/channel-signer-lease-service.ts`
- Tests: `backend/tests/channel-signer-lease.test.ts`
- Original Issue: Concurrent signing produces duplicate nonces
