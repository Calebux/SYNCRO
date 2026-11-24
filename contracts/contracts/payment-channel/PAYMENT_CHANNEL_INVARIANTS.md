# Payment Channel Invariants

State-machine invariants enforced by the `payment-channel` Soroban contract.
Each invariant names the test(s) that check it.

Primary coverage lives in `src/invariants.rs`. Related adversarial and fuzz
tests are listed where they strengthen the same rule.

---

## 1. Conservation of funds (I-C)

Escrowed tokens are never created or destroyed by channel transitions. Deposits
and top-ups increase escrow; finalize (and bounty pay/refund) disburse exactly
what remains.

| ID | Rule | Test |
|----|------|------|
| **I-C1** | After open / top-up / close, `balance_a + balance_b` equals cumulative deposits; finalize pays those balances and leaves contract escrow at zero | `invariants::invariant_funds_conserved_through_lifecycle` |
| **I-C2** | Watchtower cannot redirect channel principal; at most the reserved bounty | `adversarial::over_withdrawal_via_negative_watchtower_state_rejected` |
| **I-C3** | Random top-up / state sequences keep `balance_a + balance_b == deposited` and non-negative balances | `fuzz::fuzz_operation_sequence_conserves_balance`, `fuzz::fuzz_top_up_balance_conservation` |

**Notes**

- Dual-signed `submit_state` / `initiate_close` / `dispute` trust both parties for
  the split; the contract does not re-check that the signed balances sum to the
  prior total (the parties authorize the new allocation).
- `verify_payment_proof` moves value from `balance_a` to `balance_b` by the same
  amount. Covered in `proof_replay`.

---

## 2. Nonce / sequence monotonicity (I-N)

Every accepted state update must carry a **strictly greater** `sequence` than
the value stored on-chain. Equal or lower sequences are rejected with
`StaleState`.

| ID | Rule | Test |
|----|------|------|
| **I-N1** | `submit_state` rejects equal and lower sequences; accepted sequences advance | `invariants::invariant_sequence_strictly_monotonic` |
| **I-N2** | Equal sequence on `submit_state` is rejected | `adversarial::equal_nonce_submit_state_rejected` |
| **I-N3** | Older sequence on `submit_state` is rejected | `adversarial::stale_sequence_submit_state_rejected` |
| **I-N4** | Property: stale sequences never apply; valid sequences are monotonic | `fuzz::fuzz_stale_sequence_rejected`, `fuzz::fuzz_state_transition_sequence_monotonic` |

---

## 3. Close only once (I-X)

A channel reaches `Closed` at most once. After finalize, further finalize
attempts fail with `InvalidState`. While already `Closing`, a second
`initiate_close` is also rejected.

| ID | Rule | Test |
|----|------|------|
| **I-X1** | Second `initiate_close` while Closing fails; second `finalize` after Closed fails | `invariants::invariant_close_only_once` |
| **I-X2** | Double-spend finalize path rejected (CEI / closed state) | `adversarial::double_spend_finalize_rejected` |
| **I-X3** | Re-entrant finalize during token transfer is rejected | `adversarial::malicious_token_reentrancy_on_finalize_is_rejected` |

---

## 4. Dispute only within window (I-D)

While the channel is `Closing` (or still within the challenge period after a
dispute reset), a newer dual-signed state may be submitted via `dispute` or
`watchtower_submit`. After `dispute_deadline`, those calls return
`DisputeWindowExpired`. Finalize is blocked until the deadline has passed
(`DisputeWindowActive`).

| ID | Rule | Test |
|----|------|------|
| **I-D1** | `dispute` succeeds inside the window and fails after expiry | `invariants::invariant_dispute_only_within_window` |
| **I-D2** | `watchtower_submit` after deadline → `DisputeWindowExpired` | `invariants::invariant_watchtower_submit_only_within_window` |
| **I-D3** | Property: dispute after window rejected | `fuzz::fuzz_dispute_after_window_rejected` |
| **I-D4** | Payer can still dispute a stale provider close inside the window | `adversarial::provider_initiates_close_stale_payer_disputes_and_wins` |

---

## 5. Watchtower bounty bounds (I-B)

Watchtower bounty is reserved from the depositor’s `balance_a`, never exceeds
`MAX_WATCHTOWER_BOUNTY`, and never redirects channel principal to the watchtower.

| ID | Rule | Test |
|----|------|------|
| **I-B1** | Negative bounty → `InvalidBounty`; over `MAX_WATCHTOWER_BOUNTY` → `BountyExceedsCap`; over `balance_a` → `InsufficientBalance`; cap value accepted | `invariants::invariant_watchtower_bounty_bounds` |
| **I-B2** | Negative balances in watchtower-submitted state rejected | `adversarial::over_withdrawal_via_negative_watchtower_state_rejected` |

`MAX_WATCHTOWER_BOUNTY` is defined in `src/lib.rs` (`10_000` token units).

---

## 6. Related coverage

| Concern | Test |
|---------|------|
| Contract-address / deployment isolation | `adversarial::prior_contract_version_state_is_independent` |
| Payment-proof nonce one-time use | `proof_replay` module |

---

## 7. Running the tests

```bash
cd contracts
cargo test -p payment-channel --lib invariant_
cargo test -p payment-channel --lib
```
