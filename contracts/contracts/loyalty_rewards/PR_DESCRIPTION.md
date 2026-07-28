## Summary

Implements the `loyalty_rewards` Soroban smart contract for issue #1045.
Subscribers earn loyalty points for every consecutive on-time renewal; points
accumulate with a streak multiplier and are redeemable against fees.

## Acceptance criteria

- [x] **Accrue on renewal event** — `accrue(owner, sub_id, renewal_ledger)` awards points after each successful renewal
- [x] **Streak tracking** — streak increments on `accrue`, resets to 0 on `miss`; bonus capped at `MAX_STREAK_BONUS_LEVEL = 20`
- [x] **Redeem path** — `redeem(owner, amount)` burns points and returns a fee-credit value (1 pt = 1 credit unit)
- [x] **Tests** — 35 tests covering all entrypoints and error paths

---

## Contract design

### Entrypoints

| Entrypoint | Auth | Description |
|---|---|---|
| `init(admin, renewal_caller)` | admin | One-time setup |
| `accrue(owner, sub_id, renewal_ledger)` | renewal_caller | Award `BASE_POINTS + streak × STREAK_BONUS` pts |
| `miss(owner, sub_id)` | renewal_caller | Reset streak to 0, no point deduction |
| `redeem(owner, amount)` | owner | Burn points, return fee credit |
| `set_paused(paused)` | admin | Emergency pause/resume |
| `set_renewal_caller(addr)` | admin | Rotate authorised caller |
| `balance / account / streak / is_paused` | — | Read-only queries |

### Point formula

```
points_awarded = BASE_POINTS(100) + min(streak, 20) × STREAK_BONUS(50)
```

| Streak | Points awarded |
|---|---|
| 0 | 100 |
| 1 | 150 |
| 5 | 350 |
| 10 | 600 |
| 20+ | 1 100 (cap) |

### Error codes

| # | Name | Trigger |
|---|---|---|
| 1 | NotInitialized | Contract not yet initialised |
| 2 | AlreadyInitialized | `init` called twice |
| 3 | Unauthorized | Auth check failed |
| 4 | Paused | Contract is paused |
| 5 | RedeemTooSmall | `amount < MIN_REDEEM (100)` |
| 6 | InsufficientPoints | Balance < requested amount |
| 7 | Overflow | Arithmetic overflow guard |

### Storage layout

| Key | Tier | Content |
|---|---|---|
| `ConfigKey::Admin` | Persistent | Administrator address |
| `ConfigKey::RenewalCaller` | Persistent | Authorised renewal contract |
| `ConfigKey::Paused` | Persistent | Global pause flag |
| `UserKey::Account(addr)` | Instance | Per-user `LoyaltyAccount` |

`LoyaltyAccount` fields: `points`, `streak`, `last_renewal_ledger`, `lifetime_points`, `total_redeems`.

---

## Files changed

| File | Lines | Description |
|---|---|---|
| `contracts/contracts/loyalty_rewards/Cargo.toml` | 14 | New crate manifest |
| `contracts/contracts/loyalty_rewards/src/lib.rs` | 402 | Contract implementation |
| `contracts/contracts/loyalty_rewards/src/test.rs` | 422 | 35-test suite |
| `contracts/Cargo.toml` | +1 | Register crate in workspace |

## Test coverage (35 tests)

- init success + double-init guard
- accrue: base points, streak increment, bonus arithmetic, balance accumulation, lifetime points, last-renewal ledger
- streak bonus hard-capped at MAX_STREAK_BONUS_LEVEL = 20
- miss: streak reset, no point loss, zero-streak noop, restart after miss
- redeem: burns points, returns credit, full-balance drain, total_redeems counter, lifetime_points invariant
- redeem error paths: below minimum (#5), insufficient balance (#6), empty account (#6)
- pause/unpause: accrue / miss / redeem all reject when paused (#4)
- set_renewal_caller rotation
- Multiple independent users — balances and streaks fully isolated
- Uninitialized contract guard (#1)

Closes #1045
