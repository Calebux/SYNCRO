# Subscription Renewal Invariants

Complete specification of all approval-window and renewal-window invariants enforced by the `SubscriptionRenewal` Soroban contract.

---

## 1. Approval-Window Invariants

An **approval** is a single-use, time-bounded, amount-bounded authorisation that the subscription owner must create before any renewal can execute.

### 1.1 Structure

```rust
pub struct RenewalApproval {
    pub sub_id: u64,      // Subscription this approval is bound to
    pub max_spend: i128,  // Maximum amount that may be charged
    pub expires_at: u32,  // Ledger sequence number after which the approval is void
    pub used: bool,       // True once consumed; prevents reuse
}
```

### 1.2 Creation — `approve_renewal()`

| Rule | Detail |
|------|--------|
| **Owner-only** | `data.owner.require_auth()` — only the subscription owner may create an approval |
| **Bound to subscription** | Approval is keyed by `(sub_id, approval_id)`; it cannot be used for a different subscription |
| **Ledger-based expiry** | `expires_at` is a **ledger sequence number**, not a Unix timestamp |
| **Starts unused** | `used: false` on creation |

**Example:**
```rust
// Owner approves up to 1000 stroops, valid until ledger 500
contract.approve_renewal(env, sub_id: 42, approval_id: 1, max_spend: 1000, expires_at: 500);
// Emits: ApprovalCreated { sub_id: 42, approval_id: 1, max_spend: 1000, expires_at: 500 }
```

### 1.3 Consumption — `consume_approval()` (internal)

Called inside `renew()`. Checks are evaluated in this order:

| Order | Check | Rejection reason code | Panic / return |
|-------|-------|-----------------------|----------------|
| 1 | Approval exists | `4` — Not found | `ApprovalRejected` emitted, returns `false` |
| 2 | `used == false` | `2` — Already used | `ApprovalRejected` emitted, returns `false` |
| 3 | `current_ledger <= expires_at` | `1` — Expired | `ApprovalRejected` emitted, returns `false` |
| 4 | `amount <= max_spend` | `3` — Amount exceeds limit | `ApprovalRejected` emitted, returns `false` |

If all checks pass, `used` is set to `true` and the function returns `true`.

**`renew()` behaviour:** if `consume_approval` returns `false`, `renew()` panics with `"Invalid or expired approval"`.

### 1.4 Invariant Summary

- **I-A1** An approval can be consumed **at most once** (`used` flag).
- **I-A2** An approval is void after ledger `expires_at` (inclusive check: `current_ledger > expires_at` → rejected).
- **I-A3** The renewal amount must not exceed `max_spend`.
- **I-A4** An approval is bound to exactly one `(sub_id, approval_id)` pair; it cannot be transferred.
- **I-A5** Only the subscription owner can create an approval.

### 1.5 Examples

```rust
// ✅ Valid: amount within limit, ledger within window
// current_ledger = 100, expires_at = 200, amount = 500, max_spend = 1000
contract.renew(..., approval_id: 1, amount: 500, ...);  // succeeds

// ❌ Expired: current_ledger > expires_at
// current_ledger = 300, expires_at = 200
contract.renew(...);  // panics "Invalid or expired approval"
//   → ApprovalRejected { reason: 1 }

// ❌ Already used: second call with same approval_id
contract.renew(..., approval_id: 1, ...);  // second call panics
//   → ApprovalRejected { reason: 2 }

// ❌ Amount exceeds max_spend
// amount = 1500, max_spend = 1000
contract.renew(..., amount: 1500, ...);  // panics "Invalid or expired approval"
//   → ApprovalRejected { reason: 3 }

// ❌ Approval not found
contract.renew(..., approval_id: 999, ...);  // panics "Invalid or expired approval"
//   → ApprovalRejected { reason: 4 }
```

---

## 2. Renewal-Window Invariants

A **renewal window** restricts when (by Unix timestamp) a renewal may execute. It is optional — if no window is set, there is no time restriction.

### 2.1 Structure

```rust
pub struct RenewalWindow {
    pub billing_start: u64,  // Unix timestamp: earliest allowed renewal time
    pub billing_end: u64,    // Unix timestamp: latest allowed renewal time
}
```

### 2.2 Setting a Window — `set_window()`

| Rule | Detail |
|------|--------|
| **Owner-only** | `data.owner.require_auth()` |
| **Start before end** | `billing_start >= billing_end` → panics `"Invalid window: start must be before end"` |
| **Emits event** | `WindowUpdated { sub_id, billing_start, billing_end }` |
| **Optional** | If never called, no window restriction applies |

**Example:**
```rust
// Set a 48-hour renewal window starting 2026-01-01 00:00 UTC
contract.set_window(env, sub_id: 42, billing_start: 1735689600, billing_end: 1735862400);
// Emits: WindowUpdated { sub_id: 42, billing_start: 1735689600, billing_end: 1735862400 }
```

### 2.3 Enforcement in `renew()`

```
if window exists:
    current_time = env.ledger().timestamp()   // Unix timestamp
    if current_time < billing_start OR current_time > billing_end:
        panic!("Outside renewal window")
```

Note: the window check uses **ledger timestamp** (Unix seconds), while the approval expiry uses **ledger sequence number**. These are different clocks.

### 2.4 Invariant Summary

- **I-W1** `billing_start` must be strictly less than `billing_end`.
- **I-W2** If a window is set, `renew()` only succeeds when `billing_start <= current_time <= billing_end`.
- **I-W3** If no window is set, `renew()` has no time restriction.
- **I-W4** Only the subscription owner can set or update the window.
- **I-W5** The window check occurs **after** approval consumption — a consumed approval is not refunded if the window check fails.

> **Important (I-W5):** The approval is consumed before the window is checked. If the window check fails, the approval has already been marked `used`. The owner must create a new approval before retrying.

### 2.5 Examples

```rust
// ✅ Within window
// current_time = 1735700000, billing_start = 1735689600, billing_end = 1735862400
contract.renew(...);  // succeeds

// ❌ Too early
// current_time = 1735600000 < billing_start = 1735689600
contract.renew(...);  // panics "Outside renewal window"

// ❌ Too late
// current_time = 1735900000 > billing_end = 1735862400
contract.renew(...);  // panics "Outside renewal window"

// ✅ No window set — no time restriction
// (set_window was never called for this sub_id)
contract.renew(...);  // succeeds regardless of current_time
```

---

## 3. Cooldown Invariants

After a failed renewal, a cooldown period prevents immediate retry.

- **I-C1** If `failure_count > 0`, then `current_ledger >= last_attempt_ledger + cooldown_ledgers` must hold.
- **I-C2** Violation panics with `"Cooldown period active"`.
- **I-C3** `cooldown_ledgers` is supplied by the caller on each `renew()` call; the contract does not store a default.
- **I-C4** The first renewal attempt (`failure_count == 0`) is never subject to cooldown.

---

## 4. Renewal Lock Invariants

A processing lock prevents concurrent renewal execution.

- **I-L1** `acquire_renewal_lock()` panics `"Renewal lock active"` if a non-expired lock exists.
- **I-L2** `renew()` panics `"Renewal lock required"` if no lock exists.
- **I-L3** `renew()` panics `"Renewal lock expired"` if the lock has expired (i.e. `current_ledger >= locked_at + lock_timeout`).
- **I-L4** The lock is **always released** at the end of `renew()`, whether the renewal succeeds or fails.
- **I-L5** An expired lock can be re-acquired; `RenewalLockExpired` is emitted when this happens.

---

## 5. Cycle Deduplication Invariants

Prevents the same billing cycle from being renewed twice.

- **I-D1** `renew()` panics `"Duplicate renewal for cycle"` if `cycle_id` equals the last stored `cycle_id` for the subscription.
- **I-D2** After a successful renewal, the new `cycle_id` is stored.
- **I-D3** After a failed renewal, the `cycle_id` is **not** stored — the same `cycle_id` may be retried.

---

## 6. `renew()` Execution Order

The checks inside `renew()` execute in this fixed order:

```
1. Protocol not paused
2. Subscription exists
3. Caller is owner or registered executor
4. consume_approval()          ← approval-window checks (I-A1..I-A5)
5. Renewal window check        ← I-W2 (if window set)
6. Subscription not in FAILED state
7. Renewal lock exists and not expired  ← I-L2, I-L3
8. Cycle deduplication         ← I-D1
9. Cooldown check              ← I-C1
10. Integrity hash verification
11. Per-subscription spending cap
12. Global user spending cap
13. Execute renewal (succeed / fail branch)
```

---

## 7. Approval Rejection Reason Codes

| Code | Meaning |
|------|---------|
| `1` | Approval expired (`current_ledger > expires_at`) |
| `2` | Approval already used |
| `3` | Amount exceeds `max_spend` |
| `4` | Approval not found |

---

## 8. Related Documentation

- [`APPROVAL_SYSTEM.md`](./APPROVAL_SYSTEM.md) — approval system overview
- [`../../RENEWAL_WINDOW.md`](../../RENEWAL_WINDOW.md) — renewal window feature summary
- [`../../../backend/docs/RENEWAL_EXECUTION.md`](../../../backend/docs/RENEWAL_EXECUTION.md) — backend-side billing window (7-day window around billing date)
- [`../../../docs/contracts.mdx`](../../../docs/contracts.mdx) — full contract API reference
