# Soroban Contract Fuzzing — Discovered Edge Cases

Property-based fuzz tests (`proptest`) were added for `subscription_renewal`, `escrow`, and `payment-channel` as part of [#955](https://github.com/Calebux/SYNCRO/issues/955).

Run locally:

```bash
cd contracts
cargo test fuzz_
```

## subscription_renewal

| Edge case | Behavior | Test |
|-----------|----------|------|
| Renewal amount exceeds per-subscription spending cap | Panics with spending cap violation | `fuzz_renewal_respects_spending_cap` |
| Cumulative spend exceeds global user cap | Panics with global cap violation | `fuzz_global_cap_overflow_rejected` |
| Approval reuse after successful renewal | Panics — approvals are single-use | `fuzz_approval_single_use` |
| Admin operations on uninitialized contract | Panics — no admin in storage | `fuzz_uninitialized_contract_rejects_admin_ops` |
| Random amounts/intervals on init | Stored values match inputs; state stays `Active` | `fuzz_init_sub_amounts_and_intervals` |
| Random entrypoint sequences | All renewal invariants hold (caps, cycle guard, state graph, lock release) | `fuzz_renewal_state_machine` |

The `fuzz_renewal_state_machine` property test drives a proptest state machine
through random sequences of `init_sub`, `approve_renewal`, `renew`, `cancel_sub`,
`set_window` and `set_user_cap`, asserting after every step:

1. Every accepted renewal respects the per-subscription spending cap.
2. Cumulative `UserSpent` never exceeds the global `UserCap` as a result of a renewal.
3. At most one successful renewal per billing window (cycle guard).
4. `SubscriptionState` transitions follow the declared graph.
5. The renewal lock is never held after a completed call.

The invariant list is documented on the crate root (`subscription_renewal/src/lib.rs`)
and mirrored in `fuzz.rs`.

## escrow

| Edge case | Behavior | Test |
|-----------|----------|------|
| Second deposit on funded escrow | Panics with `AlreadyFunded` | `fuzz_concurrent_deposit_rejected` |
| Zero or negative escrow amount | Panics with `InvalidAmount` | `fuzz_invalid_amounts_rejected` |
| Third-party dispute raise | Panics with `Unauthorized` | `fuzz_unauthorized_dispute_rejected` |
| Deposit then refund | Token balance restored to payer | `fuzz_deposit_refund_conservation` |
| Random positive amounts | `deposited` equals `amount` after funding | `fuzz_deposit_with_random_amounts` |

## payment-channel

| Edge case | Behavior | Test |
|-----------|----------|------|
| Counterparty attempts top-up | Returns `Unauthorized` | `fuzz_unauthorized_top_up_rejected` |
| Zero/negative open deposit | Returns `InvalidAmount` | `fuzz_invalid_deposit_amounts_rejected` |
| Stale sequence on state update | Returns `StaleState` | `fuzz_stale_sequence_rejected` |
| Top-up sequence | `balance_a + balance_b` conserved | `fuzz_top_up_balance_conservation` |
| Close → finalize after dispute window | State transitions `Open → Closing → Closed` | `fuzz_close_state_transitions` |
| State submit with valid sequence | Sequence monotonically increases | `fuzz_state_transition_sequence_monotonic` |

## Notes

- Fuzz tests use 8 cases per property (`ProptestConfig::with_cases(8)`) for fast CI runs.
- CI runs the fuzz/state-machine suite on every PR with a fixed `PROPTEST_SEED` and a bounded case count (`PROPTEST_CASES=8`) for reproducibility, and a separate nightly job (`fuzz-nightly` in `.github/workflows/contracts.yml`) with an extended case count (`PROPTEST_CASES=512`).
- Fuzz tests disable Soroban snapshot capture (`EnvTestConfig::capture_snapshot_at_drop = false`); no snapshot JSON files are committed.
- Integer overflow is guarded by Rust `overflow-checks = true` in release profile and explicit `saturating_add` checks in fuzz assertions where applicable.
- Panic-based contracts (`subscription_renewal`, `escrow`) use `catch_unwind` to verify rejection paths; `Result`-based `payment-channel` checks `Err` variants directly.
