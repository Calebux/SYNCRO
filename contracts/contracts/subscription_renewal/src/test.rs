#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, EnvTestConfig, Ledger},
    Address, BytesN, Bytes, Env,
};

// ── Helper ────────────────────────────────────────────────────────────────────

fn setup() -> (Env, SubscriptionRenewalContractClient<'static>, Address) {
    let mut env = Env::default();
    env.mock_all_auths();
    env.set_config(EnvTestConfig { capture_snapshot_at_drop: false });
    let contract_id = env.register(SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.init(&admin);
    (env, client, admin)
}

fn zero_pubkey(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

fn zero_sig(env: &Env) -> BytesN<64> {
    BytesN::from_array(env, &[0u8; 64])
}

// ── Pause / admin tests ───────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Protocol is paused")]
fn test_renew_blocked_when_paused() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 100u64;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &100, &zero_pubkey(&env));
    client.acquire_renewal_lock(&sub_id, &200);
    client.set_paused(&true);
    client.renew(&user, &sub_id, &1, &500, &3, &10, &20260101u64, &true, &zero_pubkey(&env), &zero_sig(&env));
}

#[test]
fn test_renew_works_after_unpause() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 101u64;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &100, &zero_pubkey(&env));
    client.set_paused(&true);
    client.set_paused(&false);
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&user, &sub_id, &1, &500, &3, &10, &20260101u64, &true, &zero_pubkey(&env), &zero_sig(&env));
    assert!(result);
}

#[test]
#[should_panic(expected = "Already initialized")]
fn test_cannot_init_twice() {
    let (env, client, _admin) = setup();
    let another = Address::generate(&env);
    client.init(&another);
}

// ── Renewal tests ─────────────────────────────────────────────────────────────

#[test]
fn test_renewal_success() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 123u64;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &100, &zero_pubkey(&env));
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&user, &sub_id, &1, &500, &3, &10, &20260115u64, &true, &zero_pubkey(&env), &zero_sig(&env));
    assert!(result);

    let data = client.get_sub(&sub_id);
    assert_eq!(data.state, SubscriptionState::Active);
    assert_eq!(data.failure_count, 0);
}

#[test]
fn test_retry_logic() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 456u64;
    let max_retries = 2u32;
    let cooldown = 10u32;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    client.approve_renewal(&sub_id, &1, &1000, &200, &zero_pubkey(&env));
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&user, &sub_id, &1, &500, &max_retries, &cooldown, &20260201u64, &false, &zero_pubkey(&env), &zero_sig(&env));
    assert!(!result);

    let data = client.get_sub(&sub_id);
    assert_eq!(data.state, SubscriptionState::Retrying);
    assert_eq!(data.failure_count, 1);

    env.ledger().with_mut(|li| { li.sequence_number = 100; });

    client.approve_renewal(&sub_id, &2, &1000, &200, &zero_pubkey(&env));
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&user, &sub_id, &2, &500, &max_retries, &cooldown, &20260201u64, &false, &zero_pubkey(&env), &zero_sig(&env));

    env.ledger().with_mut(|li| { li.sequence_number = 120; });

    client.approve_renewal(&sub_id, &3, &1000, &200, &zero_pubkey(&env));
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&user, &sub_id, &3, &500, &max_retries, &cooldown, &20260201u64, &false, &zero_pubkey(&env), &zero_sig(&env));

    let data = client.get_sub(&sub_id);
    assert_eq!(data.state, SubscriptionState::Failed);
    assert_eq!(data.failure_count, 3);
}

#[test]
#[should_panic(expected = "Cooldown period active")]
fn test_cooldown_enforcement() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 789u64;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    client.approve_renewal(&sub_id, &1, &1000, &100, &zero_pubkey(&env));
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&user, &sub_id, &1, &500, &3, &10, &20260301u64, &false, &zero_pubkey(&env), &zero_sig(&env));

    client.approve_renewal(&sub_id, &2, &1000, &100, &zero_pubkey(&env));
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&user, &sub_id, &2, &500, &3, &10, &20260301u64, &false, &zero_pubkey(&env), &zero_sig(&env));
}

#[test]
fn test_zero_max_retries() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 111u64;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &100, &zero_pubkey(&env));
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&user, &sub_id, &1, &500, &0u32, &10, &20260401u64, &false, &zero_pubkey(&env), &zero_sig(&env));
    assert!(!result);

    let data = client.get_sub(&sub_id);
    assert_eq!(data.state, SubscriptionState::Failed);
    assert_eq!(data.failure_count, 1);
}

#[test]
fn test_multiple_failures_then_success() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 222u64;
    let max_retries = 3u32;
    let cooldown = 10u32;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    client.approve_renewal(&sub_id, &1, &1000, &200, &zero_pubkey(&env));
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&user, &sub_id, &1, &500, &max_retries, &cooldown, &20260501u64, &false, &zero_pubkey(&env), &zero_sig(&env));
    assert_eq!(client.get_sub(&sub_id).failure_count, 1);

    env.ledger().with_mut(|li| { li.sequence_number = 20; });
    client.approve_renewal(&sub_id, &2, &1000, &200, &zero_pubkey(&env));
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&user, &sub_id, &2, &500, &max_retries, &cooldown, &20260501u64, &false, &zero_pubkey(&env), &zero_sig(&env));
    assert_eq!(client.get_sub(&sub_id).failure_count, 2);

    env.ledger().with_mut(|li| { li.sequence_number = 40; });
    client.approve_renewal(&sub_id, &3, &1000, &200, &zero_pubkey(&env));
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&user, &sub_id, &3, &500, &max_retries, &cooldown, &20260501u64, &true, &zero_pubkey(&env), &zero_sig(&env));
    assert!(result);

    let data = client.get_sub(&sub_id);
    assert_eq!(data.state, SubscriptionState::Active);
    assert_eq!(data.failure_count, 0);
}

#[test]
#[should_panic(expected = "Subscription is in FAILED state")]
fn test_cannot_renew_failed_subscription() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 333u64;
    let max_retries = 1u32;
    let cooldown = 10u32;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    client.approve_renewal(&sub_id, &1, &1000, &200, &zero_pubkey(&env));
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&user, &sub_id, &1, &500, &max_retries, &cooldown, &20260601u64, &false, &zero_pubkey(&env), &zero_sig(&env));

    env.ledger().with_mut(|li| { li.sequence_number = 20; });
    client.approve_renewal(&sub_id, &2, &1000, &200, &zero_pubkey(&env));
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&user, &sub_id, &2, &500, &max_retries, &cooldown, &20260601u64, &false, &zero_pubkey(&env), &zero_sig(&env));

    env.ledger().with_mut(|li| { li.sequence_number = 40; });
    client.approve_renewal(&sub_id, &3, &1000, &200, &zero_pubkey(&env));
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&user, &sub_id, &3, &500, &max_retries, &cooldown, &20260701u64, &true, &zero_pubkey(&env), &zero_sig(&env));
}

// ── Approval tests ────────────────────────────────────────────────────────────

#[test]
fn test_approval_required_for_renewal() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 500u64;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &100, &zero_pubkey(&env));
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&user, &sub_id, &1, &500, &3, &10, &20260801u64, &true, &zero_pubkey(&env), &zero_sig(&env));
    assert!(result);
}

#[test]
#[should_panic(expected = "Invalid or expired approval")]
fn test_renewal_without_approval_fails() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 501u64;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&user, &sub_id, &999, &500, &3, &10, &20260901u64, &true, &zero_pubkey(&env), &zero_sig(&env));
}

#[test]
#[should_panic(expected = "Invalid or expired approval")]
fn test_approval_cannot_be_reused() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 502u64;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &2, &1000, &100, &zero_pubkey(&env));

    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&user, &sub_id, &2, &500, &3, &10, &20261001u64, &true, &zero_pubkey(&env), &zero_sig(&env));

    env.ledger().with_mut(|li| { li.sequence_number = 20; });
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&user, &sub_id, &2, &500, &3, &10, &20261101u64, &true, &zero_pubkey(&env), &zero_sig(&env));
}

#[test]
#[should_panic(expected = "Invalid or expired approval")]
fn test_expired_approval_rejected() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 503u64;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &3, &1000, &50, &zero_pubkey(&env));

    env.ledger().with_mut(|li| { li.sequence_number = 51; });
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&user, &sub_id, &3, &500, &3, &10, &20261201u64, &true, &zero_pubkey(&env), &zero_sig(&env));
}

#[test]
#[should_panic(expected = "Invalid or expired approval")]
fn test_amount_exceeds_max_spend() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 504u64;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &4, &1000, &100, &zero_pubkey(&env));
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&user, &sub_id, &4, &1500, &3, &10, &20270101u64, &true, &zero_pubkey(&env), &zero_sig(&env));
}

// ── Cycle guard tests ─────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Duplicate renewal for cycle")]
fn test_duplicate_cycle_rejected_after_success() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 600u64;
    let cycle_id = 20260315u64;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &100, &zero_pubkey(&env));
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&user, &sub_id, &1, &500, &3, &10, &cycle_id, &true, &zero_pubkey(&env), &zero_sig(&env));
    assert!(result);

    client.approve_renewal(&sub_id, &2, &1000, &100, &zero_pubkey(&env));
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&user, &sub_id, &2, &500, &3, &10, &cycle_id, &true, &zero_pubkey(&env), &zero_sig(&env));
}

#[test]
fn test_retry_same_cycle_allowed_after_failure() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 601u64;
    let cycle_id = 20260315u64;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    client.approve_renewal(&sub_id, &1, &1000, &200, &zero_pubkey(&env));
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&user, &sub_id, &1, &500, &3, &10, &cycle_id, &false, &zero_pubkey(&env), &zero_sig(&env));
    assert!(!result);

    env.ledger().with_mut(|li| { li.sequence_number = 20; });
    client.approve_renewal(&sub_id, &2, &1000, &200, &zero_pubkey(&env));
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&user, &sub_id, &2, &500, &3, &10, &cycle_id, &true, &zero_pubkey(&env), &zero_sig(&env));
    assert!(result);
}

// ── Cancel tests ──────────────────────────────────────────────────────────────

#[test]
fn test_cancel_sub() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 700u64;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.cancel_sub(&sub_id);
    assert_eq!(client.get_sub(&sub_id).state, SubscriptionState::Cancelled);
}

#[test]
#[should_panic(expected = "Subscription already cancelled")]
fn test_cannot_cancel_twice() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 701u64;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.cancel_sub(&sub_id);
    client.cancel_sub(&sub_id);
}

#[test]
#[should_panic(expected = "Subscription not found")]
fn test_cancel_non_existent_sub() {
    let (_env, client, _admin) = setup();
    client.cancel_sub(&999u64);
}

// ── Spending cap tests ────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Per-subscription spending cap exceeded")]
fn test_per_subscription_spending_cap() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 800u64;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &2000, &100, &zero_pubkey(&env));
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&user, &sub_id, &1, &1500, &3, &10, &20270101u64, &true, &zero_pubkey(&env), &zero_sig(&env));
}

#[test]
#[should_panic(expected = "Global user spending cap exceeded")]
fn test_global_user_spending_cap() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);

    client.set_user_cap(&user, &2000);

    let sub_id_1 = 801u64;
    let sub_id_2 = 802u64;

    client.init_sub(&user, &merchant, &1500, &86400, &5000, &sub_id_1);
    client.init_sub(&user, &merchant, &1000, &86400, &5000, &sub_id_2);

    client.approve_renewal(&sub_id_1, &1, &2000, &100, &zero_pubkey(&env));
    client.approve_renewal(&sub_id_2, &1, &2000, &100, &zero_pubkey(&env));

    client.acquire_renewal_lock(&sub_id_1, &200);
    client.renew(&user, &sub_id_1, &1, &1500, &3, &10, &20260101u64, &true, &zero_pubkey(&env), &zero_sig(&env));

    client.acquire_renewal_lock(&sub_id_2, &200);
    client.renew(&user, &sub_id_2, &1, &1000, &3, &10, &20260101u64, &true, &zero_pubkey(&env), &zero_sig(&env));
}

// ── Renewal lock tests ────────────────────────────────────────────────────────

#[test]
fn test_acquire_renewal_lock() {
    let (_env, client, _admin) = setup();
    let sub_id = 900u64;

    client.acquire_renewal_lock(&sub_id, &200);
    let lock = client.get_renewal_lock(&sub_id).unwrap();
    assert_eq!(lock.locked_at, 0);
    assert_eq!(lock.lock_timeout, 200);
}

#[test]
#[should_panic(expected = "Renewal lock active")]
fn test_lock_prevents_concurrent_acquisition() {
    let (_env, client, _admin) = setup();
    let sub_id = 901u64;

    client.acquire_renewal_lock(&sub_id, &200);
    client.acquire_renewal_lock(&sub_id, &200);
}

#[test]
fn test_lock_auto_expires_and_reacquirable() {
    let (env, client, _admin) = setup();
    let sub_id = 902u64;

    client.acquire_renewal_lock(&sub_id, &50);
    env.ledger().with_mut(|li| { li.sequence_number = 60; });
    client.acquire_renewal_lock(&sub_id, &200);

    let lock = client.get_renewal_lock(&sub_id).unwrap();
    assert_eq!(lock.locked_at, 60);
    assert_eq!(lock.lock_timeout, 200);
}

#[test]
fn test_release_renewal_lock() {
    let (_env, client, _admin) = setup();
    let sub_id = 903u64;

    client.acquire_renewal_lock(&sub_id, &200);
    client.release_renewal_lock(&sub_id);
    assert!(client.get_renewal_lock(&sub_id).is_none());
}

#[test]
#[should_panic(expected = "No renewal lock to release")]
fn test_release_nonexistent_lock_panics() {
    let (_env, client, _admin) = setup();
    client.release_renewal_lock(&904u64);
}

#[test]
#[should_panic(expected = "Renewal lock required")]
fn test_renew_without_lock_panics() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 905u64;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &100, &zero_pubkey(&env));
    client.renew(&user, &sub_id, &1, &500, &3, &10, &20260101u64, &true, &zero_pubkey(&env), &zero_sig(&env));
}

#[test]
fn test_renew_with_lock_succeeds_and_auto_releases() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 906u64;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &100, &zero_pubkey(&env));
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&user, &sub_id, &1, &500, &3, &10, &20260101u64, &true, &zero_pubkey(&env), &zero_sig(&env));
    assert!(result);
    assert!(client.get_renewal_lock(&sub_id).is_none());
}

#[test]
#[should_panic(expected = "Renewal lock expired")]
fn test_renew_with_expired_lock_panics() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 907u64;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &200, &zero_pubkey(&env));
    client.acquire_renewal_lock(&sub_id, &50);
    env.ledger().with_mut(|li| { li.sequence_number = 60; });
    client.renew(&user, &sub_id, &1, &500, &3, &10, &20260101u64, &true, &zero_pubkey(&env), &zero_sig(&env));
}

#[test]
#[should_panic(expected = "Protocol is paused")]
fn test_acquire_lock_blocked_when_paused() {
    let (_env, client, _admin) = setup();
    client.set_paused(&true);
    client.acquire_renewal_lock(&908u64, &200);
}

// ── Lifecycle tests ───────────────────────────────────────────────────────────

#[test]
fn test_lifecycle_created_on_init() {
    let (env, client, _admin) = setup();
    env.ledger().with_mut(|li| { li.timestamp = 1700000000; });

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 1000u64;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    let lc = client.get_lifecycle(&sub_id);
    assert_eq!(lc.created_at, 1700000000);
    assert_eq!(lc.activated_at, 1700000000);
    assert_eq!(lc.last_renewed_at, 0);
    assert_eq!(lc.canceled_at, 0);
}

#[test]
fn test_lifecycle_renewed_at_updated_on_success() {
    let (env, client, _admin) = setup();
    env.ledger().with_mut(|li| { li.timestamp = 1700000000; });

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 1001u64;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    env.ledger().with_mut(|li| { li.timestamp = 1700100000; });
    client.approve_renewal(&sub_id, &1, &1000, &100, &zero_pubkey(&env));
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&user, &sub_id, &1, &500, &3, &10, &20260101u64, &true, &zero_pubkey(&env), &zero_sig(&env));

    let lc = client.get_lifecycle(&sub_id);
    assert_eq!(lc.last_renewed_at, 1700100000);
    assert_eq!(lc.activated_at, 1700000000);
}

#[test]
fn test_lifecycle_canceled_at_set_on_cancel() {
    let (env, client, _admin) = setup();
    env.ledger().with_mut(|li| { li.timestamp = 1700000000; });

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 1002u64;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    env.ledger().with_mut(|li| { li.timestamp = 1700200000; });
    client.cancel_sub(&sub_id);

    let lc = client.get_lifecycle(&sub_id);
    assert_eq!(lc.canceled_at, 1700200000);
}

#[test]
#[should_panic(expected = "Lifecycle data not found")]
fn test_get_lifecycle_nonexistent_sub() {
    let (_env, client, _admin) = setup();
    client.get_lifecycle(&9999u64);
}


// ── Stealth proof tests ───────────────────────────────────────────────────────

fn make_stealth_proof(env: &Env, sub_id: u64, approval_id: u64) -> (BytesN<32>, BytesN<64>) {
    use ed25519_dalek::{Signer, SigningKey};
    use rand::rngs::OsRng;
    let signing_key = SigningKey::generate(&mut OsRng);
    let verifying_key = signing_key.verifying_key();
    let mut msg = [0u8; 16];
    msg[..8].copy_from_slice(&sub_id.to_le_bytes());
    msg[8..].copy_from_slice(&approval_id.to_le_bytes());
    let sig = signing_key.sign(&msg);
    (
        BytesN::from_array(env, verifying_key.as_bytes()),
        BytesN::from_array(env, &sig.to_bytes()),
    )
}


// ── Stealth proof tests ───────────────────────────────────────────────────────

fn make_stealth_proof(env: &Env, sub_id: u64, approval_id: u64) -> (Bytes, Bytes) {
    use ed25519_dalek::{Signer, SigningKey};
    use rand::rngs::OsRng;
    let signing_key = SigningKey::generate(&mut OsRng);
    let verifying_key = signing_key.verifying_key();
    let mut msg = [0u8; 16];
    msg[..8].copy_from_slice(&sub_id.to_le_bytes());
    msg[8..].copy_from_slice(&approval_id.to_le_bytes());
    let sig = signing_key.sign(&msg);
    (
        Bytes::from_array(env, verifying_key.as_bytes()),
        Bytes::from_array(env, &sig.to_bytes()),
    )
}

#[test]
fn test_stealth_renewal_accepted_with_valid_proof() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 2000u64;
    let approval_id = 1u64;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    let (pubkey, sig) = make_stealth_proof(&env, sub_id, approval_id);
    client.approve_renewal(&sub_id, &approval_id, &1000, &100, &pubkey);

    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(
        &user, &sub_id, &approval_id, &500, &3, &10, &20260101u64, &true,
        &pubkey, &sig,
    );
    assert!(result);
}

#[test]
#[should_panic(expected = "failed ED25519 verification")]
fn test_stealth_renewal_rejected_with_bad_signature() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 2001u64;
    let approval_id = 1u64;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    let (pubkey, _) = make_stealth_proof(&env, sub_id, approval_id);
    client.approve_renewal(&sub_id, &approval_id, &1000, &100, &pubkey);

    let bad_sig = Bytes::new(&env);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(
        &user, &sub_id, &approval_id, &500, &3, &10, &20260101u64, &true,
        &pubkey, &bad_sig,
    );
}

#[test]
#[should_panic(expected = "Stealth pubkey mismatch")]
fn test_stealth_renewal_rejected_with_wrong_pubkey() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 2002u64;
    let approval_id = 1u64;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    let (pubkey, _) = make_stealth_proof(&env, sub_id, approval_id);
    client.approve_renewal(&sub_id, &approval_id, &1000, &100, &pubkey);

    let (wrong_pubkey, wrong_sig) = make_stealth_proof(&env, sub_id, approval_id);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(
        &user, &sub_id, &approval_id, &500, &3, &10, &20260101u64, &true,
        &wrong_pubkey, &wrong_sig,
    );
}

#[test]
#[should_panic(expected = "No stealth address registered for this approval")]
fn test_stealth_proof_rejected_when_none_registered() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 2003u64;
    let approval_id = 1u64;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &approval_id, &1000, &100, &zero_pubkey(&env));

    let (pubkey, sig) = make_stealth_proof(&env, sub_id, approval_id);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(
        &user, &sub_id, &approval_id, &500, &3, &10, &20260101u64, &true,
        &pubkey, &sig,
    );
}

#[test]
fn test_non_stealth_renewal_still_works_without_proof() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 2004u64;

    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &100, &zero_pubkey(&env));
    client.acquire_renewal_lock(&sub_id, &200);
    let zero_sig = zero_sig(&env);
    let zero_pubkey = zero_pubkey(&env);
    let result = client.renew(
        &user, &sub_id, &1, &500, &3, &10, &20260101u64, &true, &zero_pubkey, &zero_sig,
    );
    assert!(result);
}
