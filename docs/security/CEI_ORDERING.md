# Checks–Effects–Interactions (CEI) Ordering

> **Location:** `docs/security/CEI_ORDERING.md`  
> **Audience:** Contract developers, auditors, reviewers  
> **Last updated:** 2026-07-25

---

## What is CEI?

CEI is the canonical safe ordering pattern for smart-contract functions that
read and write state *and* perform external calls (token transfers,
cross-contract invocations, etc.).

```
1. CHECKS      — validate inputs, authorisation, and preconditions
2. EFFECTS     — mutate and persist all contract state
3. INTERACTIONS — call external contracts / emit tokens
```

Violating this order creates a **re-entrancy window**: an adversary can
re-enter the contract during step 3 and observe a stale on-chain state that
allows a double-spend or other inconsistency.

Although Soroban's execution model is synchronous and the current token
contracts do not carry re-entrant callbacks, CEI compliance is required because:

- Future Soroban upgrades may introduce async or callback primitives.
- Off-chain monitoring and cross-chain bridges consume emitted events; if an
  event is emitted before state is final, monitors may act on incorrect data.
- Following CEI is a zero-cost defensive coding practice that eliminates an
  entire class of vulnerabilities regardless of the execution model.

---

## Rule

> **All state mutations and event publications MUST occur before any call to
> `token::Client::transfer(...)` or other external contract invocations.**

---

## Audit Results (2026-07-25)

| Contract | Function | Finding | Status |
|---|---|---|---|
| `escrow` | `release` | Token transfer fired BEFORE `state = Released` write | **Fixed** |
| `escrow` | `refund` | Token transfer fired BEFORE `state = Refunded` write | **Fixed** |
| `escrow` | `resolve_dispute` | Transfer inside `match` arm BEFORE `storage.set()` | **Fixed** |
| `subscription_renewal` | `renew` | No external transfer; state written before events | ✅ Clean |
| `virtual-card` | `process_payment` | No external transfer; internal accounting committed before event | ✅ Clean |
| `payment-channel` | `finalize` | State written before event (OK), but **no token disbursement** — funds locked forever | **Fixed** |

---

## Contract-by-Contract Details

### `escrow` — `release`

**Before (violation):**
```rust
token_client.transfer(...);   // INTERACTION first  ← WRONG
escrow.state = EscrowState::Released;
env.storage().persistent().set(...);
EscrowReleased { ... }.publish(&env);
```

**After (correct):**
```rust
// EFFECTS
escrow.state = EscrowState::Released;
env.storage().persistent().set(&DataKey::Escrow(escrow_id), &escrow);
EscrowReleased { ... }.publish(&env);
// INTERACTIONS
token_client.transfer(...);
```

**Why it matters:** If the `transfer` call reverts for any reason, the
transaction rolls back and state never changes.  If state were written first
and transfer succeeded later there would be no issue.  But with the old code,
if a re-entrant call were somehow possible between the transfer and the state
write, the state would still show `Approved`, allowing a second `release`.

---

### `escrow` — `refund`

Same pattern as `release`.  Token disbursement was happening before the
`Refunded` state was persisted, leaving an identical re-entrancy window.

---

### `escrow` — `resolve_dispute`

**Before (violation):**
```rust
match resolution {
    1 => {
        token_client.transfer(..., &escrow.payee, ...);  // INTERACTION first ← WRONG
        escrow.state = EscrowState::Released;
    }
    2 => {
        token_client.transfer(..., &escrow.payer, ...);  // INTERACTION first ← WRONG
        escrow.state = EscrowState::Refunded;
    }
}
env.storage().persistent().set(...);   // EFFECTS after interactions
EscrowResolved { ... }.publish(&env);  // event after interactions
```

**After (correct):**
```rust
// EFFECTS — determine and persist terminal state first
match resolution {
    1 => escrow.state = EscrowState::Released,
    2 => escrow.state = EscrowState::Refunded,
    _ => panic!(...),
}
env.storage().persistent().set(&DataKey::Escrow(escrow_id), &escrow);
EscrowResolved { ... }.publish(&env);
// INTERACTIONS — transfers happen last
match resolution {
    1 => token_client.transfer(..., &payee, ...),
    2 => token_client.transfer(..., &payer, ...),
    _ => unreachable!(),
}
```

---

### `payment-channel` — `finalize` (functional gap)

**Before (gap):** The `finalize` function set `state = Closed` and emitted an
event but performed **no token transfers**.  Every channel's entire token
balance would be locked in the contract forever once finalized.

**Fix:** Added a `token: Address` field to `PaymentChannel` (set during
`open_channel`) and added disbursement calls in `finalize`:

```rust
// EFFECTS
channel.state = ChannelState::Closed;
env.storage().persistent().set(...);
env.events().publish(...);
// INTERACTIONS
if balance_a > 0 { token_client.transfer(..., &depositor, &balance_a); }
if balance_b > 0 { token_client.transfer(..., &counterparty, &balance_b); }
```

Zero-value transfers are skipped to avoid unnecessary cross-contract calls.

`open_channel` and `top_up` were also updated to pull funds from the caller
into contract escrow at the time of the call (INTERACTIONS after EFFECTS).

---

### `subscription_renewal` — `renew` (clean)

No external token transfer exists in this contract; renewal is simulated.
State is written to storage before events are emitted.  No CEI work required.

---

### `virtual-card` — `process_payment` (clean)

Balance deduction and optional status change (`Closed` on zero balance) are
written to `storage` before the `payment_processed` event is published.  No
external token transfer.  No CEI work required.

---

## Enforcement Checklist for Reviewers

When reviewing a new function that makes an external call, verify the
following checklist **in order**:

- [ ] All `require_auth()` calls are the first thing in the function body
- [ ] All `panic_with_error!` / `return Err(...)` guards precede any state
      mutation
- [ ] All `env.storage().*.set(...)` calls are complete before any
      `token::Client::transfer(...)` call
- [ ] All event publications (`.publish(&env)`) occur after storage writes
      but **before** external transfers (so monitors see the new state)
- [ ] Captured local copies of addresses and amounts are used in the
      INTERACTIONS phase rather than reading from the (already-mutated) struct

---

## Pattern Template

```rust
pub fn withdraw(env: Env, id: u64) -> Result<(), Error> {
    // ── CHECKS ──────────────────────────────────────────────────────────────
    let mut record = load_record(&env, id)?;
    if record.state == State::Done { return Err(Error::AlreadyDone); }
    caller.require_auth();

    // Capture values before mutation.
    let recipient = record.owner.clone();
    let token_addr = record.token.clone();
    let amount = record.amount;

    // ── EFFECTS ─────────────────────────────────────────────────────────────
    record.state = State::Done;
    record.amount = 0;
    env.storage().persistent().set(&Key::Record(id), &record);
    Withdrawn { id, amount }.publish(&env);

    // ── INTERACTIONS ─────────────────────────────────────────────────────────
    token::Client::new(&env, &token_addr)
        .transfer(&env.current_contract_address(), &recipient, &amount);

    Ok(())
}
```

---

## References

- [Soroban Security Best Practices](https://developers.stellar.org/docs/smart-contracts/security)
- [Classic Ethereum re-entrancy background](https://consensys.github.io/smart-contract-best-practices/attacks/reentrancy/)
- `contracts/contracts/escrow/src/lib.rs` — canonical CEI implementation
- `contracts/contracts/payment-channel/src/lib.rs` — canonical CEI implementation
