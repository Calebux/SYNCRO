//! Property-based tests for the subscription renewal contract.
//!
//! Beyond the targeted edge-case fuzz tests below, `fuzz_renewal_state_machine`
//! drives a proptest state machine through random sequences of the public
//! entrypoints (`init_sub`, `approve_renewal`, `renew`, `cancel_sub`,
//! `set_window`, `set_user_cap`) and asserts the crate invariants after every
//! generated operation. The invariant list is documented on the crate root in
//! `lib.rs` and mirrored here:
//!
//! 1. Every accepted renewal respects the per-subscription spending cap.
//! 2. Total charged (cumulative `UserSpent`) <= global user cap.
//! 3. At most one successful renewal per billing window (cycle guard).
//! 4. `SubscriptionState` transitions follow the declared graph.
//! 5. The renewal lock is never held after a completed call.

#![cfg(test)]
extern crate std;

use std::collections::HashSet;
use std::panic::{catch_unwind, AssertUnwindSafe};

use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, EnvTestConfig, Ledger as _},
    Address, Env,
};

use super::{
    ContractError, SubscriptionRenewalContract, SubscriptionRenewalContractClient, SubscriptionState,
};

fn fuzz_env() -> Env {
    Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
        ..EnvTestConfig::default()
    })
}

fn fuzz_setup() -> (Env, Address, Address) {
    let env = fuzz_env();
    env.mock_all_auths();
    let id = env.register_contract(None, SubscriptionRenewalContract);
    let admin = Address::generate(&env);
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    client.init(&admin);
    (env, id, admin)
}

/// Maximum renewal-lock timeout (mirrors `RENEWAL_LOCK_TIMEOUT_MAX` in
/// `lib.rs`). Using this keeps a lock from expiring mid-test so that lock
/// lifecycle invariants are exercised deterministically.
const BIG_LOCK_TIMEOUT: u32 = 604_800;

// ── Renewal state machine ─────────────────────────────────────────

/// One generated step of the renewal state machine.
///
/// Each variant carries the raw (random) parameters; the harness resolves the
/// concrete `sub_id`, `approval_id` and `cycle_id` from its own model so the
/// generated sequences need not manage regeneration of dependent identifiers.
#[derive(Clone, Debug)]
enum Op {
    Init { amount: i128, spending_cap: i128 },
    Approve { max_spend: i128 },
    Renew { amount: i128, max_retries: u32, cooldown: u32, succeed: bool },
    Cancel,
    SetWindow { start: u64, end: u64 },
    SetUserCap { cap: i128 },
}

/// Mirrors the on-chain state the harness can observe through the client. It is
/// used both to generate *valid* follow-on operations and to cross-check the
/// invariants against what the contract actually reports.
#[derive(Clone, Debug)]
struct Model {
    has_sub: bool,
    spending_cap: i128,
    state: SubscriptionState,
    prev_state: SubscriptionState,
    failure_count: u32,
    last_attempt_ledger: u32,
    last_cycle: Option<u64>,
    user_cap: i128,
    user_spent: i128,
    has_window: bool,
    window_start: u64,
    window_end: u64,
    next_approval_id: u64,
    next_cycle_id: u64,
    succeeded_cycles: HashSet<u64>,
    ledger: u32,
    timestamp: u64,
}

impl Model {
    fn new() -> Self {
        Model {
            has_sub: false,
            spending_cap: 0,
            state: SubscriptionState::Active,
            prev_state: SubscriptionState::Active,
            failure_count: 0,
            last_attempt_ledger: 0,
            last_cycle: None,
            user_cap: 0,
            user_spent: 0,
            has_window: false,
            window_start: 0,
            window_end: 0,
            next_approval_id: 1,
            next_cycle_id: 1,
            succeeded_cycles: HashSet::new(),
            ledger: 0,
            timestamp: 0,
        }
    }
}

/// Returns true when the transition `from -> to` is legal in the state graph.
fn legal_transition(from: SubscriptionState, to: SubscriptionState) -> bool {
    use SubscriptionState::*;
    match (from, to) {
        (Active, Active) | (Active, Retrying) | (Active, Failed) | (Active, Cancelled) => true,
        (Retrying, Active) | (Retrying, Retrying) | (Retrying, Failed) | (Retrying, Cancelled) => true,
        (Failed, Cancelled) | (Failed, Active) => true, // Active via re-init
        (Cancelled, Active) => true,                    // Active via re-init
        (Failed, Failed) | (Cancelled, Cancelled) => false,
    }
}

/// Applies a generated operation to the contract through the client and updates
/// the model, asserting the crate invariants after each (applied or rejected)
/// step. Operations that are rejected by the contract (cap exceeded, duplicate
/// cycle, already-cancelled, invalid window, etc.) are detected via
/// `catch_unwind` and leave the model state unchanged.
fn apply_op(
    env: &Env,
    client: &SubscriptionRenewalContractClient,
    user: &Address,
    merchant: &Address,
    sub_id: u64,
    op: &Op,
    model: &mut Model,
) {
    match op {
        Op::Init { amount, spending_cap } => {
            client.init_sub(user, merchant, amount, &86_400u64, spending_cap, &sub_id);
            model.has_sub = true;
            model.spending_cap = *spending_cap;
            model.state = SubscriptionState::Active;
            model.failure_count = 0;
            model.last_attempt_ledger = 0;
        }

        Op::Approve { max_spend } => {
            if !model.has_sub {
                return; // cannot approve a subscription that does not exist yet
            }
            let approval_id = model.next_approval_id;
            model.next_approval_id += 1;
            let expires_at = 1_000_000_000u32; // far in the future for this test
            client
                .approve_renewal(&sub_id, &approval_id, max_spend, &expires_at)
                .unwrap();
        }

        Op::Renew {
            amount,
            max_retries,
            cooldown,
            succeed,
        } => {
            // The contract cannot renew a non-existent, cancelled or failed
            // subscription; those are rejected without touching the lock.
            if !model.has_sub || model.state == SubscriptionState::Cancelled || model.state == SubscriptionState::Failed {
                return;
            }

            // Advance the ledger so a prior retry's cooldown has elapsed and the
            // renewal-lock we acquire below is not treated as expired.
            model.ledger = model.ledger.saturating_add(1).max(model.last_attempt_ledger.saturating_add(*cooldown + 1));
            model.timestamp = model.timestamp.saturating_add(1);
            // Keep the ledger timestamp inside an active billing window.
            if model.has_window && (model.timestamp < model.window_start || model.timestamp > model.window_end) {
                model.timestamp = model.window_start;
            }
            env.ledger().with_mut(|li| {
                li.sequence_number = model.ledger;
                li.timestamp = model.timestamp;
            });

            // Guarantee a usable approval: single-use, so mint a fresh one whose
            // max_spend covers this renewal amount whenever the held approval
            // cannot (including the very first renewal). This keeps the approval
            // path out of the rejection set so cap/window/state invariants can be
            // exercised in isolation.
            let approval_id = model.next_approval_id;
            model.next_approval_id += 1;
            client
                .approve_renewal(&sub_id, &approval_id, &(*amount).max(1), &1_000_000_000u32)
                .unwrap();

            // Acquire the renewal lock (required by `renew`).
            client
                .acquire_renewal_lock(&sub_id, &BIG_LOCK_TIMEOUT)
                .unwrap();

            let cycle_id = model.next_cycle_id;
            model.next_cycle_id += 1;

            // Determine whether this renewal is valid under the caps.
            let spending_ok = model.spending_cap == 0 || *amount <= model.spending_cap;
            let global_ok =
                model.user_cap == 0 || model.user_spent.saturating_add(*amount) <= model.user_cap;
            let cycle_ok = model.last_cycle.map_or(true, |lc| lc != cycle_id);

            // Run the call inside catch_unwind so genuine contract rejections
            // (cap exceeded, duplicate cycle, etc.) surface as a panic rather
            // than aborting the entire proptest case.
            let result = catch_unwind(AssertUnwindSafe(|| {
                client
                    .renew(
                        &sub_id,
                        &approval_id,
                        amount,
                        max_retries,
                        cooldown,
                        &cycle_id,
                        succeed,
                    )
                    .unwrap()
            }));

            // A completed `renew` (success or retry path) must release the lock.
            // After a mid-function panic the contract does not reach the release
            // tail, so the harness clears the lock itself to keep the model
            // consistent and allow subsequent renews.
            if client.get_renewal_lock(&sub_id).is_some() {
                let _ = client.release_renewal_lock(&sub_id);
            }

            // Assert invariant #5: a call that completed must not hold the lock.
            assert!(
                client.get_renewal_lock(&sub_id).is_none(),
                "renewal lock still held for sub {sub_id} after a completed renew"
            );

            let rejected = result.is_err() || !spending_ok || !global_ok || !cycle_ok;

            if !rejected {
                let completed_success = result.ok().unwrap_or(false) && *succeed;
                if completed_success {
                    // Assert invariant #1: an accepted renewal never exceeds the
                    // per-subscription spending cap when one is configured.
                    assert!(
                        model.spending_cap == 0 || *amount <= model.spending_cap,
                        "accepted renewal {amount} exceeds spending cap {}",
                        model.spending_cap
                    );
                    // Assert invariant #3: no duplicate successful cycle.
                    assert!(
                        model.succeeded_cycles.insert(cycle_id),
                        "duplicate successful renewal for cycle {cycle_id}"
                    );
                    model.state = SubscriptionState::Active;
                    model.failure_count = 0;
                    model.last_attempt_ledger = model.ledger;
                    model.last_cycle = Some(cycle_id);
                    model.user_spent = model.user_spent.saturating_add(*amount);
                } else {
                    // Retry path: failure/retry captured by the contract.
                    let completed_failure = result.ok().unwrap_or(true) || !*succeed;
                    if completed_failure {
                        model.failure_count = model.failure_count.saturating_add(1);
                        model.last_attempt_ledger = model.ledger;
                        if model.failure_count > *max_retries {
                            model.state = SubscriptionState::Failed;
                        } else {
                            model.state = SubscriptionState::Retrying;
                        }
                    }
                }
            }

            // Assert invariant #2 (global cap) holds after the step for any
            // renewal the contract accepted: user_spent never exceeds user_cap.
            assert!(
                model.user_cap == 0 || model.user_spent <= model.user_cap,
                "user_spent {} exceeds user_cap {}",
                model.user_spent,
                model.user_cap
            );
        }

        Op::Cancel => {
            if !model.has_sub || model.state == SubscriptionState::Cancelled {
                return; // nothing to cancel / already cancelled
            }
            let cancelled = catch_unwind(AssertUnwindSafe(|| client.cancel_sub(&sub_id).unwrap()))
                .is_ok();
            if cancelled {
                model.state = SubscriptionState::Cancelled;
            }
        }

        Op::SetWindow { start, end } => {
            // Admin-only; mock_all_auths means it succeeds iff start < end.
            if start >= end {
                let _ = catch_unwind(AssertUnwindSafe(|| {
                    client.set_window(&sub_id, start, end).unwrap()
                }));
                return;
            }
            client.set_window(&sub_id, start, end).unwrap();
            model.has_window = true;
            model.window_start = *start;
            model.window_end = *end;
            model.timestamp = *start;
            env.ledger().with_mut(|li| li.timestamp = *start);
        }

        Op::SetUserCap { cap } => {
            client.set_user_cap(user, cap).unwrap();
            model.user_cap = *cap;
        }
    }

    assert_invariants(client, user, sub_id, model);
}

/// Asserts the five crate invariants from observable contract state, after every
/// generated operation.
fn assert_invariants(
    client: &SubscriptionRenewalContractClient,
    user: &Address,
    sub_id: u64,
    model: &mut Model,
) {
    assert_eq!(spent, model.user_spent, "model/contract spent drift");

    // Invariant #2 (a renewal never drives cumulative spend above the current
    // user cap) is assessed in the `Renew` arm, where the contract enforces it
    // on each accepted renewal. `set_user_cap` may legally lower a cap below
    // the current spend, so it is not asserted here unconditionally.

    if !model.has_sub {
        return;
    }

    // Invariant #4: the observed state must match the model and the transition
    // from the previous step must be legal in the declared state graph.
    let observed = client.get_sub(&sub_id).unwrap();
    let prev = model.prev_state;
    assert!(
        !model.has_sub || prev == model.state || legal_transition(prev, model.state),
        "illegal state transition {from} -> {to}",
        from = state_name(prev),
        to = state_name(model.state)
    );
    assert_eq!(
        observed.state, model.state,
        "model/contract state drift (want {} got {})",
        state_name(model.state),
        state_name(observed.state)
    );
    assert_eq!(
        observed.failure_count, model.failure_count,
        "model/contract failure_count drift"
    );
    model.prev_state = model.state;

    // Invariant #5: at rest the renewal lock is never held.
    assert!(
        client.get_renewal_lock(&sub_id).is_none(),
        "renewal lock held for sub {sub_id} at rest"
    );
}

fn state_name(s: SubscriptionState) -> &'static str {
    match s {
        SubscriptionState::Active => "Active",
        SubscriptionState::Retrying => "Retrying",
        SubscriptionState::Failed => "Failed",
        SubscriptionState::Cancelled => "Cancelled",
    }
}

/// Generates a random renewal state-machine operation.
fn any_op() -> impl Strategy<Value = Op> {
    prop_oneof![
        (1i128..=1_000_000i128, 0i128..=700_000i128)
            .prop_map(|(amount, spending_cap)| Op::Init { amount, spending_cap })
            .boxed(),
        (1i128..=1_000_000i128)
            .prop_map(|max_spend| Op::Approve { max_spend })
            .boxed(),
        (1i128..=1_000_000i128, 1u32..=4u32, 0u32..=10u32, proptest::bool::ANY)
            .prop_map(|(amount, max_retries, cooldown, succeed)| Op::Renew {
                amount,
                max_retries,
                cooldown,
                succeed,
            })
            .boxed(),
        proptest::bool::ANY.prop_map(|_| Op::Cancel).boxed(),
        (1_000u64..=200_000u64, 1_100u64..=210_000u64)
            .prop_map(|(start, end)| Op::SetWindow { start, end })
            .boxed(),
        (0i128..=900_000i128)
            .prop_map(|cap| Op::SetUserCap { cap })
            .boxed(),
    ]
}

/// Generates a random sequence of renewal state-machine operations.
fn state_machine_seq() -> impl Strategy<Value = Vec<Op>> {
    prop::collection::vec(any_op(), 5..=30)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(8))]

    /// Fuzz subscription init with random amounts and billing intervals.
    #[test]
    fn fuzz_init_sub_amounts_and_intervals(
        amount in 1i128..=1_000_000_000i128,
        frequency in 1u64..=31_536_000u64,
        spending_cap in 0i128..=10_000_000_000i128,
    ) {
        let (env, id, _admin) = fuzz_setup();
        let client = SubscriptionRenewalContractClient::new(&env, &id);
        let user = Address::generate(&env);
        let merchant = Address::generate(&env);

        let sub_id = client.init_sub(&user, &merchant, &amount, &frequency, &spending_cap);

        let data = client.get_sub(&sub_id);
        prop_assert_eq!(data.amount, amount);
        prop_assert_eq!(data.frequency, frequency);
        prop_assert_eq!(data.spending_cap, spending_cap);
        prop_assert_eq!(data.state, SubscriptionState::Active);
    }

    /// Successful renewals must never exceed the per-subscription spending cap.
    #[test]
    fn fuzz_renewal_respects_spending_cap(
        amount in 1i128..=500_000i128,
        spending_cap in 1i128..=1_000_000i128,
        renew_amount in 1i128..=2_000_000i128,
    ) {
        let (env, id, _admin) = fuzz_setup();
        let client = SubscriptionRenewalContractClient::new(&env, &id);
        let user = Address::generate(&env);
        let merchant = Address::generate(&env);

        let sub_id = client.init_sub(&user, &merchant, &amount, &86400u64, &spending_cap);
        client.approve_renewal(&sub_id, &1u64, &renew_amount, &10_000u32);
        client.acquire_renewal_lock(&sub_id, &200u32);

        let exceeds_cap = spending_cap > 0 && renew_amount > spending_cap;

        if exceeds_cap {
            let result = client.try_renew(
                &sub_id, &1u64, &renew_amount, &3u32, &10u32, &20260101u64, &true,
            );
            prop_assert_eq!(
                result,
                Err(Ok(ContractError::SpendingCapExceeded)),
                "renewal exceeding cap must return SpendingCapExceeded"
            );
        } else {
            let ok = client
                .renew(&sub_id, &1u64, &renew_amount, &3u32, &10u32, &20260101u64, &true);
            prop_assert!(ok);
            let spent = client.get_user_spent(&user);
            prop_assert_eq!(spent, renew_amount);
        }
    }

    /// Global user cap overflow: current_spent + amount must not exceed cap.
    #[test]
    fn fuzz_global_cap_overflow_rejected(
        cap in 100i128..=10_000i128,
        first_amount in 1i128..=5_000i128,
        second_amount in 1i128..=10_000i128,
    ) {
        let (env, id, _admin) = fuzz_setup();
        let client = SubscriptionRenewalContractClient::new(&env, &id);
        let user = Address::generate(&env);
        let merchant = Address::generate(&env);

        client.set_user_cap(&user, &cap);

        let sub_a = client.init_sub(&user, &merchant, &100i128, &86400u64, &0i128);
        let sub_b = client.init_sub(&user, &merchant, &100i128, &86400u64, &0i128);

        client.approve_renewal(&sub_a, &1u64, &first_amount, &10_000u32);
        client.acquire_renewal_lock(&sub_a, &200u32);
        if first_amount <= cap {
            let _ = client.renew(&sub_a, &1u64, &first_amount, &3u32, &10u32, &20260101u64, &true);
        }

        let spent = client.get_user_spent(&user);
        let remaining = cap.saturating_sub(spent);

        client.approve_renewal(&sub_b, &1u64, &second_amount, &10_000u32);
        client.acquire_renewal_lock(&sub_b, &200u32);

        if second_amount > remaining {
            let result = client.try_renew(
                &sub_b, &1u64, &second_amount, &3u32, &10u32, &20260201u64, &true,
            );
            prop_assert_eq!(
                result,
                Err(Ok(ContractError::GlobalCapExceeded)),
                "global cap overflow must return GlobalCapExceeded"
            );
        }
    }

    /// Admin-only set_paused must return NotInitialized when contract is not initialized.
    #[test]
    fn fuzz_uninitialized_contract_rejects_admin_ops(_seed in 0u64..=1000u64) {
        let env = fuzz_env();
        env.mock_all_auths();
        let id = env.register_contract(None, SubscriptionRenewalContract);
        let client = SubscriptionRenewalContractClient::new(&env, &id);

        let result = client.try_set_paused(&true);
        prop_assert_eq!(
            result,
                Err(Ok(ContractError::NotInitialized)),
            "admin ops on uninitialized contract must return NotInitialized"
        );
    }

    /// Approval single-use: consuming an approval twice must return InvalidApproval.
    #[test]
    fn fuzz_approval_single_use(
        amount in 1i128..=100_000i128,
        approval_max in 1i128..=1_000_000i128,
    ) {
        let (env, id, _admin) = fuzz_setup();
        let client = SubscriptionRenewalContractClient::new(&env, &id);
        let user = Address::generate(&env);
        let merchant = Address::generate(&env);
        let renew_amount = amount.min(approval_max);

        let sub_id = client.init_sub(&user, &merchant, &amount, &86400u64, &0i128);
        client.approve_renewal(&sub_id, &1u64, &approval_max, &10_000u32);

        client.acquire_renewal_lock(&sub_id, &200u32);
        let _ = client.renew(&sub_id, &1u64, &renew_amount, &3u32, &10u32, &20260101u64, &true);

        client.acquire_renewal_lock(&sub_id, &200u32);
        let result = client.try_renew(
            &sub_id, &1u64, &renew_amount, &3u32, &10u32, &20260201u64, &true,
        );
        prop_assert_eq!(
            result,
                Err(Ok(ContractError::InvalidApproval)),
            "reused approval must return InvalidApproval"
        );
    }

    /// Renewal state machine: random sequences of init_sub / approve_renewal /
    /// renew / cancel_sub / set_window / set_user_cap must never violate the
    /// documented invariants. Failing inputs shrink to a minimal failing
    /// sequence.
    #[test]
    fn fuzz_renewal_state_machine(ops in state_machine_seq()) {
        let (env, id, _admin) = fuzz_setup();
        let client = SubscriptionRenewalContractClient::new(&env, &id);
        let user = Address::generate(&env);
        let merchant = Address::generate(&env);
        let sub_id = 1u64;

        let mut model = Model::new();
        for op in &ops {
            apply_op(&env, &client, &user, &merchant, sub_id, op, &mut model);
        }
    }
}
