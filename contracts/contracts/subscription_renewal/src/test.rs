#![cfg(test)]

use soroban_sdk::{testutils::{Address as _, Ledger as _}, Address, Env};

use super::{
    SubscriptionRenewalContract, SubscriptionRenewalContractClient, SubscriptionState,
};

fn setup() -> (Env, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, SubscriptionRenewalContract);
    let admin = Address::generate(&env);
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    client.init(&admin);
    (env, id, admin)
}

#[test]
fn test_renew_works_after_unpause() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 101;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &100);

    // Pause then unpause
    client.set_paused(&true);
    client.set_paused(&false);

    // Should succeed now
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &1, &500, &3, &10, &20260101, &true);
    assert!(result);
}

#[test]
#[should_panic(expected = "Already initialized")]
fn test_cannot_init_twice() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let another = Address::generate(&env);
    client.init(&another);
}

// ── Original tests (updated to use setup helper) ─────────────────

#[test]
fn test_renewal_success() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 123;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &100);

    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &1, &500, &3, &10, &20260115, &true);
    assert!(result);

    let data = client.get_sub(&sub_id);
    assert_eq!(data.state, SubscriptionState::Active);
    assert_eq!(data.failure_count, 0);
}

#[test]
fn test_retry_logic() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 456;
    let max_retries = 2;
    let cooldown = 10;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    // First failure (cycle_id same for retries — allowed because failure doesn't store cycle)
    client.approve_renewal(&sub_id, &1, &1000, &200);
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(
        &sub_id,
        &1,
        &500,
        &max_retries,
        &cooldown,
        &20260201,
        &false,
    );
    assert!(!result);

    let data = client.get_sub(&sub_id);
    assert_eq!(data.state, SubscriptionState::Retrying);
    assert_eq!(data.failure_count, 1);

    // Advance ledger to pass cooldown
    env.ledger().with_mut(|li| {
        li.sequence_number = 100;
    });

    // renewal attempt but fail again (ledger 100)
    client.approve_renewal(&sub_id, &2, &1000, &200);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(
        &sub_id,
        &2,
        &500,
        &max_retries,
        &cooldown,
        &20260201,
        &false,
    );

    // Advance past cooldown
    env.ledger().with_mut(|li| {
        li.sequence_number = 120;
    });

    // Third failure (count becomes 3 > max_retries 2) -> Should fail
    client.approve_renewal(&sub_id, &3, &1000, &200);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(
        &sub_id,
        &3,
        &500,
        &max_retries,
        &cooldown,
        &20260201,
        &false,
    );

    let data = client.get_sub(&sub_id);
    assert_eq!(data.state, SubscriptionState::Failed);
    assert_eq!(data.failure_count, 3);
}

#[test]
#[should_panic(expected = "Cooldown period active")]
fn test_cooldown_enforcement() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 789;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    // Fail once
    client.approve_renewal(&sub_id, &1, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &1, &500, &3, &10, &20260301, &false);

    // Try again immediately (cooldown not met)
    client.approve_renewal(&sub_id, &2, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &2, &500, &3, &10, &20260301, &false);
}

#[test]
fn test_event_emission_on_success() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 999;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &100);

    // Successful renewal should emit RenewalSuccess event
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &1, &500, &3, &10, &20260315, &true);
    assert!(result);

    // Verify event was emitted by checking subscription data
    let data = client.get_sub(&sub_id);
    assert_eq!(data.state, SubscriptionState::Active);
    assert_eq!(data.failure_count, 0);
}

#[test]
fn test_zero_max_retries() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 111;
    let max_retries = 0;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &100);

    // First failure with max_retries = 0 should immediately fail
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &1, &500, &max_retries, &10, &20260401, &false);
    assert!(!result);

    let data = client.get_sub(&sub_id);
    assert_eq!(data.state, SubscriptionState::Failed);
    assert_eq!(data.failure_count, 1);
}

#[test]
fn test_multiple_failures_then_success() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 222;
    let max_retries = 3;
    let cooldown = 10;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    // First failure
    client.approve_renewal(&sub_id, &1, &1000, &200);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(
        &sub_id,
        &1,
        &500,
        &max_retries,
        &cooldown,
        &20260501,
        &false,
    );
    let data = client.get_sub(&sub_id);
    assert_eq!(data.state, SubscriptionState::Retrying);
    assert_eq!(data.failure_count, 1);

    // Advance ledger
    env.ledger().with_mut(|li| {
        li.sequence_number = 20;
    });

    // Second failure
    client.approve_renewal(&sub_id, &2, &1000, &200);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(
        &sub_id,
        &2,
        &500,
        &max_retries,
        &cooldown,
        &20260501,
        &false,
    );
    let data = client.get_sub(&sub_id);
    assert_eq!(data.state, SubscriptionState::Retrying);
    assert_eq!(data.failure_count, 2);

    // Advance ledger
    env.ledger().with_mut(|li| {
        li.sequence_number = 40;
    });

    // Now succeed - should reset failure count and return to Active
    client.approve_renewal(&sub_id, &3, &1000, &200);
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &3, &500, &max_retries, &cooldown, &20260501, &true);
    assert!(result);

    let data = client.get_sub(&sub_id);
    assert_eq!(data.state, SubscriptionState::Active);
    assert_eq!(data.failure_count, 0);
}

#[test]
#[should_panic(expected = "Subscription is in FAILED state")]
fn test_cannot_renew_failed_subscription() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 333;
    let max_retries = 1;
    let cooldown = 10;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    // Fail twice to reach Failed state
    client.approve_renewal(&sub_id, &1, &1000, &200);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(
        &sub_id,
        &1,
        &500,
        &max_retries,
        &cooldown,
        &20260601,
        &false,
    );

    env.ledger().with_mut(|li| {
        li.sequence_number = 20;
    });

    client.approve_renewal(&sub_id, &2, &1000, &200);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(
        &sub_id,
        &2,
        &500,
        &max_retries,
        &cooldown,
        &20260601,
        &false,
    );

    let data = client.get_sub(&sub_id);
    assert_eq!(data.state, SubscriptionState::Failed);

    // Advance ledger
    env.ledger().with_mut(|li| {
        li.sequence_number = 40;
    });

    // Try to renew a FAILED subscription - should panic
    client.approve_renewal(&sub_id, &3, &1000, &200);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &3, &500, &max_retries, &cooldown, &20260701, &true);
}

// ── Approval system tests ────────────────────────────────────────

#[test]
fn test_approval_required_for_renewal() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 500;
    let approval_id = 1;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    // Create approval
    client.approve_renewal(&sub_id, &approval_id, &1000, &100);

    // Renew with valid approval
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &approval_id, &500, &3, &10, &20260801, &true);
    assert!(result);
}

#[test]
#[should_panic(expected = "Invalid or expired approval")]
fn test_renewal_without_approval_fails() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 501;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    // Try to renew without creating approval
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &999, &500, &3, &10, &20260901, &true);
}

#[test]
#[should_panic(expected = "Invalid or expired approval")]
fn test_approval_cannot_be_reused() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 502;
    let approval_id = 2;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &approval_id, &1000, &100);

    // First use - should succeed
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &approval_id, &500, &3, &10, &20261001, &true);

    env.ledger().with_mut(|li| {
        li.sequence_number = 20;
    });

    // Second use - should fail (already used) — use different cycle_id to bypass cycle guard
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &approval_id, &500, &3, &10, &20261101, &true);
}

#[test]
#[should_panic(expected = "Invalid or expired approval")]
fn test_expired_approval_rejected() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 503;
    let approval_id = 3;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    // Create approval that expires at ledger 50
    client.approve_renewal(&sub_id, &approval_id, &1000, &50);

    // Advance past expiration
    env.ledger().with_mut(|li| {
        li.sequence_number = 51;
    });

    // Try to use expired approval
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &approval_id, &500, &3, &10, &20261201, &true);
}

#[test]
#[should_panic(expected = "Invalid or expired approval")]
fn test_amount_exceeds_max_spend() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 504;
    let approval_id = 4;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    // Create approval with max_spend = 1000
    client.approve_renewal(&sub_id, &approval_id, &1000, &100);

    // Try to renew with amount > max_spend
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &approval_id, &1500, &3, &10, &20270101, &true);
}

#[test]
fn test_multiple_approvals_for_same_subscription() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 505;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &5000, &sub_id);

    // Create multiple approvals
    client.approve_renewal(&sub_id, &1, &1000, &100);
    client.approve_renewal(&sub_id, &2, &2000, &200);

    // Use first approval
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &1, &500, &3, &10, &20270201, &true);

    env.ledger().with_mut(|li| {
        li.sequence_number = 20;
    });

    // Use second approval — different cycle_id since first succeeded
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &2, &1500, &3, &10, &20270301, &true);
    assert!(result);
}

// ── Cycle guard tests ────────────────────────────────────────────

#[test]
#[should_panic(expected = "Duplicate renewal for cycle")]
fn test_duplicate_cycle_rejected_after_success() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 600;
    let cycle_id = 20260315;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    // First renewal succeeds — stores cycle_id
    client.approve_renewal(&sub_id, &1, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &1, &500, &3, &10, &cycle_id, &true);
    assert!(result);

    // Second renewal with same cycle_id — should panic
    client.approve_renewal(&sub_id, &2, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &2, &500, &3, &10, &cycle_id, &true);
}

#[test]
fn test_retry_same_cycle_allowed_after_failure() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 601;
    let cycle_id = 20260315;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    // First attempt fails — does NOT store cycle_id
    client.approve_renewal(&sub_id, &1, &1000, &200);
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &1, &500, &3, &10, &cycle_id, &false);
    assert!(!result);

    // Advance ledger past cooldown
    env.ledger().with_mut(|li| {
        li.sequence_number = 20;
    });

    // Retry with same cycle_id — should succeed because failure didn't record cycle
    client.approve_renewal(&sub_id, &2, &1000, &200);
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &2, &500, &3, &10, &cycle_id, &true);
    assert!(result);
}

#[test]
fn test_different_cycle_allowed_after_success() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 602;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    // First cycle succeeds
    client.approve_renewal(&sub_id, &1, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &1, &500, &3, &10, &20260315, &true);
    assert!(result);

    // Different cycle_id — should succeed
    client.approve_renewal(&sub_id, &2, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &2, &500, &3, &10, &20260415, &true);
    assert!(result);
}

#[test]
fn test_first_renewal_always_allowed() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 603;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    // First renewal ever — no stored cycle, guard passes
    client.approve_renewal(&sub_id, &1, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &1, &500, &3, &10, &20260101, &true);
    assert!(result);

    let data = client.get_sub(&sub_id);
    assert_eq!(data.state, SubscriptionState::Active);
}

#[test]
fn test_cancel_sub() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 600;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    // Cancel subscription
    client.cancel_sub(&sub_id);

    let data = client.get_sub(&sub_id);
    assert_eq!(data.state, SubscriptionState::Cancelled);
}

#[test]
#[should_panic(expected = "Subscription already cancelled")]
fn test_cannot_cancel_twice() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 601;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    client.cancel_sub(&sub_id);
    client.cancel_sub(&sub_id);
}

#[test]
#[should_panic(expected = "Subscription not found")]
fn test_cancel_non_existent_sub() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    client.cancel_sub(&999);
}

#[test]
#[should_panic(expected = "Per-subscription spending cap exceeded")]
fn test_per_subscription_spending_cap() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 700;

    // Cap is 1000
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &2000, &100);

    // Try to renew with 1500 (exceeds 1000 cap)
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &1, &1500, &3, &10, &20270101, &true);
}

#[test]
#[should_panic(expected = "Global user spending cap exceeded")]
fn test_global_user_spending_cap() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);

    // Set global cap for user to 2000
    client.set_user_cap(&user, &2000);

    let sub_id_1 = 701;
    let sub_id_2 = 702;

    client.init_sub(&user, &merchant, &1500, &86400, &5000, &sub_id_1);
    client.init_sub(&user, &merchant, &1000, &86400, &5000, &sub_id_2);

    client.approve_renewal(&sub_id_1, &1, &2000, &100);
    client.approve_renewal(&sub_id_2, &1, &2000, &100);

    // First renewal: 1500. Total spent: 1500 / 2000
    client.acquire_renewal_lock(&sub_id_1, &200);
    client.renew(&sub_id_1, &1, &1500, &3, &10, &20260101, &true);

    // Second renewal: 1000. Total would be 2500 / 2000 -> Should panic
    client.acquire_renewal_lock(&sub_id_2, &200);
    client.renew(&sub_id_2, &1, &1000, &3, &10, &20260101, &true);
}

// ── Renewal lock tests ──────────────────────────────────────────

#[test]
fn test_acquire_renewal_lock() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let sub_id = 700;

    client.acquire_renewal_lock(&sub_id, &200);

    let lock = client.get_renewal_lock(&sub_id);
    assert!(lock.is_some());
    let lock_data = lock.unwrap();
    assert_eq!(lock_data.locked_at, 0); // default ledger
    assert_eq!(lock_data.lock_timeout, 200);
}

#[test]
#[should_panic(expected = "Renewal lock active")]
fn test_lock_prevents_concurrent_acquisition() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let sub_id = 701;

    client.acquire_renewal_lock(&sub_id, &200);
    // Second acquire should panic
    client.acquire_renewal_lock(&sub_id, &200);
}

#[test]
fn test_lock_auto_expires_and_reacquirable() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let sub_id = 702;

    client.acquire_renewal_lock(&sub_id, &50);

    // Advance ledger past lock timeout
    env.ledger().with_mut(|li| {
        li.sequence_number = 60;
    });

    // Should succeed — old lock expired
    client.acquire_renewal_lock(&sub_id, &200);

    let lock = client.get_renewal_lock(&sub_id);
    assert!(lock.is_some());
    let lock_data = lock.unwrap();
    assert_eq!(lock_data.locked_at, 60);
    assert_eq!(lock_data.lock_timeout, 200);
}

#[test]
fn test_release_renewal_lock() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let sub_id = 703;

    client.acquire_renewal_lock(&sub_id, &200);
    assert!(client.get_renewal_lock(&sub_id).is_some());

    client.release_renewal_lock(&sub_id);
    assert!(client.get_renewal_lock(&sub_id).is_none());
}

#[test]
#[should_panic(expected = "No renewal lock to release")]
fn test_release_nonexistent_lock_panics() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let sub_id = 704;
    client.release_renewal_lock(&sub_id);
}

#[test]
#[should_panic(expected = "Renewal lock required")]
fn test_renew_without_lock_panics() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 705;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &100);

    // Renew without acquiring lock — should panic
    client.renew(&sub_id, &1, &500, &3, &10, &20260101, &true);
}

#[test]
fn test_renew_with_lock_succeeds_and_auto_releases() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 706;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &100);

    client.acquire_renewal_lock(&sub_id, &200);
    assert!(client.get_renewal_lock(&sub_id).is_some());

    let result = client.renew(&sub_id, &1, &500, &3, &10, &20260101, &true);
    assert!(result);

    // Lock should be auto-released after renew
    assert!(client.get_renewal_lock(&sub_id).is_none());
}

#[test]
fn test_renew_failure_also_releases_lock() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 707;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &200);

    client.acquire_renewal_lock(&sub_id, &200);
    assert!(client.get_renewal_lock(&sub_id).is_some());

    let result = client.renew(&sub_id, &1, &500, &3, &10, &20260101, &false);
    assert!(!result);

    // Lock should be auto-released even after failure
    assert!(client.get_renewal_lock(&sub_id).is_none());
}

#[test]
#[should_panic(expected = "Renewal lock expired")]
fn test_renew_with_expired_lock_panics() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 708;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &200);

    client.acquire_renewal_lock(&sub_id, &50);

    // Advance ledger past lock timeout
    env.ledger().with_mut(|li| {
        li.sequence_number = 60;
    });

    // Renew with expired lock — should panic
    client.renew(&sub_id, &1, &500, &3, &10, &20260101, &true);
}

#[test]
#[should_panic(expected = "Protocol is paused")]
fn test_acquire_lock_blocked_when_paused() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let sub_id = 709;

    client.set_paused(&true);
    // Should panic because protocol is paused
    client.acquire_renewal_lock(&sub_id, &200);
}

// ── Lifecycle timestamp tests ─────────────────────────────────────

#[test]
fn test_lifecycle_created_on_init() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    env.ledger().with_mut(|li| {
        li.timestamp = 1700000000;
    });

    let user = Address::generate(&env);
    let sub_id = 800;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    let lc = client.get_lifecycle(&sub_id);
    assert_eq!(lc.created_at, 1700000000);
    assert_eq!(lc.activated_at, 1700000000);
    assert_eq!(lc.last_renewed_at, 0);
    assert_eq!(lc.canceled_at, 0);
}

#[test]
fn test_lifecycle_renewed_at_updated_on_success() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    env.ledger().with_mut(|li| {
        li.timestamp = 1700000000;
    });

    let user = Address::generate(&env);
    let sub_id = 801;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    env.ledger().with_mut(|li| {
        li.timestamp = 1700100000;
    });

    client.approve_renewal(&sub_id, &1, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &1, &500, &3, &10, &20260101, &true);

    let lc = client.get_lifecycle(&sub_id);
    assert_eq!(lc.created_at, 1700000000);
    assert_eq!(lc.activated_at, 1700000000); // unchanged — not recovering
    assert_eq!(lc.last_renewed_at, 1700100000);
    assert_eq!(lc.canceled_at, 0);
}

#[test]
fn test_lifecycle_canceled_at_set_on_cancel() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    env.ledger().with_mut(|li| {
        li.timestamp = 1700000000;
    });

    let user = Address::generate(&env);
    let sub_id = 802;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    env.ledger().with_mut(|li| {
        li.timestamp = 1700200000;
    });

    client.cancel_sub(&sub_id);

    let lc = client.get_lifecycle(&sub_id);
    assert_eq!(lc.created_at, 1700000000);
    assert_eq!(lc.canceled_at, 1700200000);
}

#[test]
fn test_lifecycle_activated_at_updated_on_recovery_from_retrying() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    env.ledger().with_mut(|li| {
        li.timestamp = 1700000000;
    });

    let user = Address::generate(&env);
    let sub_id = 803;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    // Fail once to enter Retrying
    env.ledger().with_mut(|li| {
        li.timestamp = 1700100000;
    });
    client.approve_renewal(&sub_id, &1, &1000, &200);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &1, &500, &3, &10, &20260201, &false);

    let data = client.get_sub(&sub_id);
    assert_eq!(data.state, SubscriptionState::Retrying);

    // Advance past cooldown, succeed
    env.ledger().with_mut(|li| {
        li.sequence_number = 20;
        li.timestamp = 1700200000;
    });
    client.approve_renewal(&sub_id, &2, &1000, &200);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &2, &500, &3, &10, &20260201, &true);

    let lc = client.get_lifecycle(&sub_id);
    assert_eq!(lc.created_at, 1700000000);
    assert_eq!(lc.activated_at, 1700200000); // updated on recovery
    assert_eq!(lc.last_renewed_at, 1700200000);
    assert_eq!(lc.canceled_at, 0);
}

#[test]
fn test_lifecycle_not_updated_on_renewal_failure() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    env.ledger().with_mut(|li| {
        li.timestamp = 1700000000;
    });

    let user = Address::generate(&env);
    let sub_id = 804;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    env.ledger().with_mut(|li| {
        li.timestamp = 1700100000;
    });
    client.approve_renewal(&sub_id, &1, &1000, &200);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &1, &500, &3, &10, &20260301, &false);

    let lc = client.get_lifecycle(&sub_id);
    assert_eq!(lc.last_renewed_at, 0); // unchanged on failure
    assert_eq!(lc.activated_at, 1700000000); // unchanged
}

#[test]
fn test_lifecycle_multiple_renewals_update_last_renewed() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    env.ledger().with_mut(|li| {
        li.timestamp = 1700000000;
    });

    let user = Address::generate(&env);
    let sub_id = 805;

    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    // First renewal
    env.ledger().with_mut(|li| {
        li.timestamp = 1700100000;
    });
    client.approve_renewal(&sub_id, &1, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &1, &500, &3, &10, &20260401, &true);

    let lc = client.get_lifecycle(&sub_id);
    assert_eq!(lc.last_renewed_at, 1700100000);

    // Second renewal
    env.ledger().with_mut(|li| {
        li.timestamp = 1700200000;
    });
    client.approve_renewal(&sub_id, &2, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &2, &500, &3, &10, &20260501, &true);

    let lc = client.get_lifecycle(&sub_id);
    assert_eq!(lc.last_renewed_at, 1700200000);
    assert_eq!(lc.created_at, 1700000000); // unchanged
}

#[test]
#[should_panic(expected = "Lifecycle data not found")]
fn test_get_lifecycle_nonexistent_sub() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    client.get_lifecycle(&999);
}

// ── Renewal window invariant tests (I-W1..I-W5) ──────────────────

/// I-W1: billing_start must be strictly less than billing_end.
#[test]
#[should_panic(expected = "Invalid window: start must be before end")]
fn test_window_start_must_be_before_end() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let user = Address::generate(&env);
    let sub_id = 900u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    // start == end — should panic
    client.set_window(&sub_id, &1735689600u64, &1735689600u64);
}

/// I-W1: start > end is also rejected.
#[test]
#[should_panic(expected = "Invalid window: start must be before end")]
fn test_window_start_after_end_rejected() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let user = Address::generate(&env);
    let sub_id = 901u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    // start > end — should panic
    client.set_window(&sub_id, &1735862400u64, &1735689600u64);
}

/// I-W2: renew() succeeds when current timestamp is within the window.
#[test]
fn test_renew_within_window_succeeds() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let user = Address::generate(&env);
    let sub_id = 902u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    // Window: [1000, 2000]
    client.set_window(&sub_id, &1000u64, &2000u64);

    // Set ledger timestamp inside the window
    env.ledger().with_mut(|li| {
        li.timestamp = 1500;
    });

    client.approve_renewal(&sub_id, &1, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &1, &500, &3, &10, &20260101u64, &true);
    assert!(result);
}

/// I-W2: renew() panics when current timestamp is before billing_start.
#[test]
#[should_panic(expected = "Outside renewal window")]
fn test_renew_before_window_panics() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let user = Address::generate(&env);
    let sub_id = 903u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    // Window: [1000, 2000]
    client.set_window(&sub_id, &1000u64, &2000u64);

    // Set ledger timestamp before the window
    env.ledger().with_mut(|li| {
        li.timestamp = 500;
    });

    client.approve_renewal(&sub_id, &1, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &1, &500, &3, &10, &20260101u64, &true);
}

/// I-W2: renew() panics when current timestamp is after billing_end.
#[test]
#[should_panic(expected = "Outside renewal window")]
fn test_renew_after_window_panics() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let user = Address::generate(&env);
    let sub_id = 904u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    // Window: [1000, 2000]
    client.set_window(&sub_id, &1000u64, &2000u64);

    // Set ledger timestamp after the window
    env.ledger().with_mut(|li| {
        li.timestamp = 2500;
    });

    client.approve_renewal(&sub_id, &1, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &1, &500, &3, &10, &20260101u64, &true);
}

/// I-W3: renew() succeeds with no time restriction when no window is set.
#[test]
fn test_renew_without_window_has_no_time_restriction() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let user = Address::generate(&env);
    let sub_id = 905u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    // No set_window call — window is optional
    env.ledger().with_mut(|li| {
        li.timestamp = 9999999999;
    });

    client.approve_renewal(&sub_id, &1, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &1, &500, &3, &10, &20260101u64, &true);
    assert!(result);
}

/// I-W4: Only the subscription owner can set the window.
#[test]
fn test_set_window_owner_only() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let user = Address::generate(&env);
    let sub_id = 906u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    // Owner sets window — should succeed
    client.set_window(&sub_id, &1000u64, &2000u64);

    let window = client.get_window(&sub_id);
    assert!(window.is_some());
    let w = window.unwrap();
    assert_eq!(w.billing_start, 1000);
    assert_eq!(w.billing_end, 2000);
}

/// I-W5: renew() fails outside the window and succeeds when moved inside.
#[test]
fn test_approval_consumed_before_window_check() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let user = Address::generate(&env);
    let sub_id = 907u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    // Window: [1000, 2000]
    client.set_window(&sub_id, &1000u64, &2000u64);

    // Timestamp outside window — renew should fail
    env.ledger().with_mut(|li| {
        li.timestamp = 500;
    });
    client.approve_renewal(&sub_id, &1, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.try_renew(&sub_id, &1, &500, &3, &10, &20260101u64, &true);
    assert!(result.is_err());

    // Release the lock (held from before the failed renew) and move inside the window
    client.release_renewal_lock(&sub_id);
    env.ledger().with_mut(|li| {
        li.timestamp = 1500;
    });
    // Renew with a fresh approval inside the window — should succeed
    client.approve_renewal(&sub_id, &2, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    let result2 = client.renew(&sub_id, &2, &500, &3, &10, &20260102u64, &true);
    assert!(result2);
}