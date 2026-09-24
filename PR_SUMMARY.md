# Pull Request: Channel Signer Lease Implementation (2% Solution)

## 🎯 Problem

When multiple engine instances sign states for the same payment channel concurrently, they can produce different states at the same nonce. Only one state wins on-chain, leaving the loser's usage unbacked—creating security and accounting issues.

## 🔧 Solution (2% Implementation)

This PR implements the foundational infrastructure to prevent concurrent channel state signing through database-backed exclusive leases.

### What's Included

#### 1. Database Migration (`supabase/migrations/20260902000000_create_channel_signer_lease.sql`)
- **New table**: `channel_signer_lease` with one lease per channel
- **Bounded lease term**: Prevents zombie instances from holding leases indefinitely
- **Atomic functions**:
  - `acquire_channel_signer_lease()`: Acquire or renew exclusive signing lease
  - `allocate_next_nonce()`: Atomically allocate sequential nonces with lease verification
  - `release_channel_signer_lease()`: Explicit lease release
- **Row-level locking**: Uses `FOR UPDATE` to prevent race conditions

#### 2. TypeScript Service (`backend/src/services/channel-signer-lease-service.ts`)
- **ChannelSignerLeaseService**: High-level API for lease management
- **Unique instance identification**: Each process gets a unique ID (random bytes + PID)
- **Safe signing wrapper**: `signWithLease()` enforces lease protection before signing
- **Lease verification**: `holdsLease()` checks current ownership
- **Comprehensive logging**: Full audit trail for debugging

#### 3. Test Suite (`backend/tests/channel-signer-lease.test.ts`)
Tests verify:
- ✅ Single instance can acquire lease
- ✅ Nonces are allocated sequentially
- ✅ Second instance blocked from active lease
- ✅ Nonce allocation requires valid lease
- ✅ Expired leases can be taken over
- ✅ Explicit lease release works
- ✅ Lease ownership detection
- ✅ `signWithLease()` enforces protection

#### 4. Documentation (`backend/CHANNEL_SIGNER_LEASE_IMPLEMENTATION.md`)
- Detailed implementation explanation
- Usage examples
- Architecture decisions
- Roadmap for remaining 98%

## 📊 Scope: 2% of Total Solution

### ✅ What This PR Delivers
1. Infrastructure foundation for lease management
2. Atomic nonce allocation with lease verification
3. Concurrency prevention at database level
4. Expiry-based stale lease handling
5. Basic test coverage

### ⏳ What's Still Needed (98%)
- Integration with `payment-channel-service.ts`
- Lease renewal background job
- Multi-instance chaos testing
- Partition recovery mechanisms
- Production monitoring and alerting
- Edge case hardening (clock skew, connection failures, etc.)

## 🧪 Testing

Run the test suite:
```bash
cd backend
npm test channel-signer-lease.test.ts
```

## 🎓 Usage Example

```typescript
import { channelSignerLeaseService } from './services/channel-signer-lease-service';

async function signChannelState(channelId: string) {
  const signedState = await channelSignerLeaseService.signWithLease(
    channelId,
    async (nonce) => {
      // Only called if lease is held
      const state = {
        sequenceNumber: nonce,
        userBalance: 900,
        executorBalance: 100,
        totalDeposited: 1000,
      };
      return { state, signature: signState(state, channelId) };
    }
  );
  
  console.log('Signed with nonce:', signedState.state.sequenceNumber);
}
```

## 🔍 Architecture Decisions

### Why PostgreSQL Leases?
- **ACID guarantees**: Stronger consistency than Redis
- **FOR UPDATE locking**: Prevents race conditions
- **Existing infrastructure**: Already using Supabase/Postgres
- **SQL observability**: Standard tooling for debugging

### Why Bounded Lease Term?
- Prevents zombie instances from blocking channel signing
- Enables automatic recovery from stalled instances
- Default: 30 seconds (configurable)

### Why Instance-Level Granularity?
- Each process instance gets unique ID
- Enables tracking which instance holds which channel
- Supports multi-instance horizontal scaling

## 🚀 Next Steps

1. **Integration (20%)**: Connect to actual payment channel signing flow
2. **Chaos Testing (30%)**: Multi-instance concurrent signing tests
3. **Monitoring (20%)**: Lease metrics and alerting
4. **Hardening (30%)**: Edge cases, network partitions, production deployment

## 📝 Files Changed

```
backend/CHANNEL_SIGNER_LEASE_IMPLEMENTATION.md        # Documentation
backend/src/services/channel-signer-lease-service.ts  # Service layer
backend/tests/channel-signer-lease.test.ts            # Test suite
supabase/migrations/20260902000000_create_channel_signer_lease.sql  # Migration
```

## ✅ Checklist

- [x] Database migration created
- [x] Service layer implemented
- [x] Test suite passing
- [x] Documentation complete
- [x] No integration with existing signing flow (intentionally scoped to 2%)
- [ ] Multi-instance chaos tests (future work)
- [ ] Production deployment (future work)

## 🔗 Related

- **Issue**: Concurrent signing produces duplicate nonces
- **Goal**: Enforce single active signer per channel
- **Success Criteria**: Multi-instance chaos test produces no duplicate nonces

---

**This PR delivers 2% of the complete solution as requested**, establishing the foundation for full concurrent signing prevention.
