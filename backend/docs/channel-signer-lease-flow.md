# Channel Signer Lease Flow Diagram

## Successful Signing Flow

```
┌─────────────┐                   ┌──────────────┐                 ┌──────────────┐
│ Instance A  │                   │  PostgreSQL  │                 │ Instance B   │
└──────┬──────┘                   └──────┬───────┘                 └──────┬───────┘
       │                                 │                                │
       │ 1. acquireLease(channel-1)     │                                │
       │───────────────────────────────>│                                │
       │                                 │                                │
       │      lease_expires_at: +30s    │                                │
       │<───────────────────────────────│                                │
       │                                 │                                │
       │ 2. allocateNonce(channel-1)    │                                │
       │───────────────────────────────>│                                │
       │                                 │                                │
       │         nonce: 1                │                                │
       │<───────────────────────────────│                                │
       │                                 │                                │
       │ 3. Sign state with nonce 1     │                                │
       │ (local operation)               │                                │
       │                                 │                                │
       │ 4. Store signed state           │                                │
       │───────────────────────────────>│                                │
       │                                 │                                │
       │         Success                 │                                │
       │<───────────────────────────────│                                │
       │                                 │                                │
```

## Concurrent Access Protection

```
┌─────────────┐                   ┌──────────────┐                 ┌──────────────┐
│ Instance A  │                   │  PostgreSQL  │                 │ Instance B   │
│ (HOLDS LEASE)│                  └──────┬───────┘                 └──────┬───────┘
└──────┬──────┘                          │                                │
       │                                 │                                │
       │ allocateNonce(channel-1)       │                                │
       │───────────────────────────────>│                                │
       │                                 │  acquireLease(channel-1)       │
       │         nonce: 5                │<───────────────────────────────│
       │<───────────────────────────────│                                │
       │                                 │   ❌ REJECTED                  │
       │                                 │   "Lease held by another       │
       │ ✅ Sign state with nonce 5     │    instance"                   │
       │                                 │───────────────────────────────>│
       │                                 │                                │
       │                                 │  allocateNonce(channel-1)      │
       │                                 │<───────────────────────────────│
       │                                 │                                │
       │                                 │   ❌ REJECTED                  │
       │                                 │   "Lease held by different     │
       │                                 │    instance"                   │
       │                                 │───────────────────────────────>│
       │                                 │                                │
       │                                 │  ❌ Cannot sign                │
       │                                 │                                │
```

## Lease Expiry and Takeover

```
┌─────────────┐                   ┌──────────────┐                 ┌──────────────┐
│ Instance A  │                   │  PostgreSQL  │                 │ Instance B   │
│ (STALLED)   │                   └──────┬───────┘                 └──────┬───────┘
└──────┬──────┘                          │                                │
       │                                 │                                │
       │ Last seen: 45 seconds ago       │                                │
       │ Lease expired: 15 seconds ago   │                                │
       │                                 │                                │
       │                                 │  acquireLease(channel-1)       │
       │                                 │<───────────────────────────────│
       │                                 │                                │
       │                                 │   ✅ GRANTED                   │
       │                                 │   "Expired lease acquired"     │
       │                                 │   current_nonce: 5             │
       │                                 │───────────────────────────────>│
       │                                 │                                │
       │                                 │  allocateNonce(channel-1)      │
       │                                 │<───────────────────────────────│
       │                                 │                                │
       │                                 │   nonce: 6                     │
       │                                 │───────────────────────────────>│
       │                                 │                                │
       │                                 │  ✅ Sign with nonce 6          │
       │                                 │                                │
       ⚠️ Instance A resumes            │                                │
       │                                 │                                │
       │ allocateNonce(channel-1)       │                                │
       │───────────────────────────────>│                                │
       │                                 │                                │
       │   ❌ REJECTED                   │                                │
       │   "Lease held by different      │                                │
       │    instance"                    │                                │
       │<───────────────────────────────│                                │
       │                                 │                                │
       │ ❌ Cannot sign (discovers       │                                │
       │    lease was lost)              │                                │
       │                                 │                                │
```

## Atomic Nonce Allocation (Database Level)

```sql
-- Inside allocate_next_nonce() function

BEGIN TRANSACTION;

  -- 1. Lock the lease row
  SELECT * FROM channel_signer_lease
  WHERE channel_id = 'channel-1'
  FOR UPDATE;  -- ← Prevents concurrent modifications

  -- 2. Verify lease ownership
  IF instance_id != 'instance-A' THEN
    ROLLBACK;
    RETURN 'Lease held by different instance';
  END IF;

  -- 3. Check lease validity
  IF lease_expires_at <= NOW() THEN
    ROLLBACK;
    RETURN 'Lease has expired';
  END IF;

  -- 4. Atomically increment nonce
  UPDATE channel_signer_lease
  SET last_nonce_allocated = last_nonce_allocated + 1,
      updated_at = NOW()
  WHERE channel_id = 'channel-1';

  -- 5. Return new nonce
  RETURN new_nonce;

COMMIT;
```

## Key Protection Mechanisms

### 1. Single Lease per Channel
```
payment_channels table          channel_signer_lease table
┌──────────────────┐           ┌──────────────────────────┐
│ id: channel-1    │──────────>│ channel_id: channel-1    │ ← PRIMARY KEY
│ state: active    │           │ instance_id: instance-A  │
│ balance: 1000    │           │ lease_expires_at: T+30s  │
└──────────────────┘           │ last_nonce_allocated: 5  │
                               └──────────────────────────┘
                                        ↑
                                        │ Only ONE row per channel
                                        │ Enforced by PRIMARY KEY
```

### 2. Lease Expiry
```
Timeline:

T+0s    Instance A acquires lease (expires at T+30s)
T+5s    Instance A allocates nonce 1 ✅
T+10s   Instance A allocates nonce 2 ✅
T+31s   Lease expires
T+32s   Instance B can acquire lease ✅
T+32s   Instance A cannot allocate nonce ❌ (lease expired)
```

### 3. Instance Identity
```
Instance A: instance-a1b2c3d4-12345 (random ID + PID)
Instance B: instance-e5f6g7h8-67890

Database tracks which instance holds each channel lease
Prevents cross-instance nonce allocation
```

## Integration Points (Not Yet Implemented)

```
┌─────────────────────────────────────────────────────────┐
│ PaymentChannelService (Future Integration)             │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  async applyOffChainRenewal(channelId, amount) {       │
│    // OLD: Direct signing without lease                │
│    // const nextState = { sequenceNumber: seq + 1 };  │
│    // signState(nextState, channelId);                │
│                                                         │
│    // NEW: Lease-protected signing                     │
│    return await channelSignerLeaseService.signWithLease(│
│      channelId,                                         │
│      async (nonce) => {                                 │
│        const nextState = {                              │
│          sequenceNumber: nonce,  // ← From lease!      │
│          userBalance: ...,                              │
│          executorBalance: ...                           │
│        };                                               │
│        return signState(nextState, channelId);         │
│      }                                                   │
│    );                                                   │
│  }                                                      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Failure Modes Handled

1. **Instance Crash**: Lease expires after 30s, another instance can take over
2. **Concurrent Acquisition**: Database `FOR UPDATE` lock serializes attempts
3. **Stale Instance**: Cannot allocate nonce after lease expires
4. **Split Brain**: Only one instance can hold lease at a time
5. **Network Partition**: Instance without lease cannot sign

## Failure Modes NOT Yet Handled (Future Work)

1. **Clock Skew**: Instance and database clocks may differ
2. **Long Transactions**: Lease may expire during multi-step operation
3. **Database Unavailable**: No fallback mechanism
4. **Lease Renewal Gaps**: Gap between expiry and renewal attempt
5. **Zombie Detection**: No active cleanup of dead instance leases
