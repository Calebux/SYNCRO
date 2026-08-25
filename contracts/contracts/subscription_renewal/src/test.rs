#![cfg(test)]

use soroban_sdk::{testutils::{Address as _, Ledger as _}, Address, Env};

use super::{
    ContractError, SubscriptionRenewalContract, SubscriptionRenewalContractClient, SubscriptionState,
};

fn setup() -> (Env, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, SubscriptionRenewalContract);
    let admin = Address::generate(&env);
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    client.init(&admin).unwrap();
    (env, id, admin)
}

// ── Init tests ────────────────────────────────────────────────────

#[test]
fn test_cannot_init_twice() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let another = Address::generate(&env);
    let err = client.try_init(&another).unwrap_err().unwrap();
    assert_eq!(err, ContractError::AlreadyInitialized);
}

// ── Renewal success / failure ─────────────────────────────────────

#[test]
fn test_renew_works_after_unpause() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 101u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &100).unwrap();

    client.set_paused(&true).unwrap();
    client.set_paused(&false).unwrap();

    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let result = client.renew(&sub_id, &1, &500, &3, &10, &20260101, &true).unwrap();
    assert!(result);
}

#[test]
fn test_renewal_success() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 123u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &100).unwrap();

    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let result = client.renew(&sub_id, &1, &500, &3, &10, &20260115, &true).unwrap();
    assert!(result);

    let data = client.get_sub(&sub_id).unwrap();
    assert_eq!(data.state, SubscriptionState::Active);
    assert_eq!(data.failure_count, 0);
}

#[test]
fn test_retry_logic() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 456u64;
    let max_retries = 2u32;
    let cooldown = 10u32;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    client.approve_renewal(&sub_id, &1, &1000, &200).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let result = client.renew(&sub_id, &1, &500, &max_retries, &cooldown, &20260201, &false).unwrap();
    assert!(!result);

    let data = client.get_sub(&sub_id).unwrap();
    assert_eq!(data.state, SubscriptionState::Retrying);
    assert_eq!(data.failure_count, 1);

    env.ledger().with_mut(|li| { li.sequence_number = 100; });

    client.approve_renewal(&sub_id, &2, &1000, &200).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    client.renew(&sub_id, &2, &500, &max_retries, &cooldown, &20260201, &false).unwrap();

    env.ledger().with_mut(|li| { li.sequence_number = 120; });

    client.approve_renewal(&sub_id, &3, &1000, &200).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    client.renew(&sub_id, &3, &500, &max_retries, &cooldown, &20260201, &false).unwrap();

    let data = client.get_sub(&sub_id).unwrap();
    assert_eq!(data.state, SubscriptionState::Failed);
    assert_eq!(data.failure_count, 3);
}

#[test]
fn test_cooldown_enforcement() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 789u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    client.approve_renewal(&sub_id, &1, &1000, &100).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    client.renew(&sub_id, &1, &500, &3, &10, &20260301, &false).unwrap();

    client.approve_renewal(&sub_id, &2, &1000, &100).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let err = client
        .try_renew(&sub_id, &2, &500, &3, &10, &20260301, &false)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::CooldownActive);
}

#[test]
fn test_event_emission_on_success() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 999u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &100).unwrap();

    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let result = client.renew(&sub_id, &1, &500, &3, &10, &20260315, &true).unwrap();
    assert!(result);

    let data = client.get_sub(&sub_id).unwrap();
    assert_eq!(data.state, SubscriptionState::Active);
    assert_eq!(data.failure_count, 0);
}

#[test]
fn test_zero_max_retries() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 111u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &100).unwrap();

    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let result = client.renew(&sub_id, &1, &500, &0, &10, &20260401, &false).unwrap();
    assert!(!result);

    let data = client.get_sub(&sub_id).unwrap();
    assert_eq!(data.state, SubscriptionState::Failed);
    assert_eq!(data.failure_count, 1);
}

#[test]
fn test_multiple_failures_then_success() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 222u64;
    let max_retries = 3u32;
    let cooldown = 10u32;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    client.approve_renewal(&sub_id, &1, &1000, &200).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    client.renew(&sub_id, &1, &500, &max_retries, &cooldown, &20260501, &false).unwrap();
    assert_eq!(client.get_sub(&sub_id).unwrap().state, SubscriptionState::Retrying);

    env.ledger().with_mut(|li| { li.sequence_number = 20; });

    client.approve_renewal(&sub_id, &2, &1000, &200).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    client.renew(&sub_id, &2, &500, &max_retries, &cooldown, &20260501, &false).unwrap();
    assert_eq!(client.get_sub(&sub_id).unwrap().state, SubscriptionState::Retrying);

    env.ledger().with_mut(|li| { li.sequence_number = 40; });

    client.approve_renewal(&sub_id, &3, &1000, &200).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let result = client.renew(&sub_id, &3, &500, &max_retries, &cooldown, &20260501, &true).unwrap();
    assert!(result);

    let data = client.get_sub(&sub_id).unwrap();
    assert_eq!(data.state, SubscriptionState::Active);
    assert_eq!(data.failure_count, 0);
}

#[test]
fn test_cannot_renew_failed_subscription() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 333u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    client.approve_renewal(&sub_id, &1, &1000, &200).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    client.renew(&sub_id, &1, &500, &1, &10, &20260601, &false).unwrap();

    env.ledger().with_mut(|li| { li.sequence_number = 20; });

    client.approve_renewal(&sub_id, &2, &1000, &200).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    client.renew(&sub_id, &2, &500, &1, &10, &20260601, &false).unwrap();

    assert_eq!(client.get_sub(&sub_id).unwrap().state, SubscriptionState::Failed);

    env.ledger().with_mut(|li| { li.sequence_number = 40; });

    client.approve_renewal(&sub_id, &3, &1000, &200).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let err = client
        .try_renew(&sub_id, &3, &500, &1, &10, &20260701, &true)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::SubscriptionFailed);
}

// ── Approval system tests ─────────────────────────────────────────

#[test]
fn test_approval_required_for_renewal() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 500u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &100).unwrap();

    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let result = client.renew(&sub_id, &1, &500, &3, &10, &20260801, &true).unwrap();
    assert!(result);
}

#[test]
fn test_renewal_without_approval_fails() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 501u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let err = client
        .try_renew(&sub_id, &999, &500, &3, &10, &20260901, &true)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::InvalidApproval);
}

#[test]
fn test_approval_cannot_be_reused() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 502u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &2, &1000, &100).unwrap();

    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    client.renew(&sub_id, &2, &500, &3, &10, &20261001, &true).unwrap();

    env.ledger().with_mut(|li| { li.sequence_number = 20; });

    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let err = client
        .try_renew(&sub_id, &2, &500, &3, &10, &20261101, &true)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::InvalidApproval);
}

#[test]
fn test_expired_approval_rejected() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 503u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &3, &1000, &50).unwrap();

    env.ledger().with_mut(|li| { li.sequence_number = 51; });

    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let err = client
        .try_renew(&sub_id, &3, &500, &3, &10, &20261201, &true)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::InvalidApproval);
}

#[test]
fn test_amount_exceeds_max_spend() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 504u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &4, &1000, &100).unwrap();

    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let err = client
        .try_renew(&sub_id, &4, &1500, &3, &10, &20270101, &true)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::InvalidApproval);
}

#[test]
fn test_multiple_approvals_for_same_subscription() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 505u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &5000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &100).unwrap();
    client.approve_renewal(&sub_id, &2, &2000, &200).unwrap();

    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    client.renew(&sub_id, &1, &500, &3, &10, &20270201, &true).unwrap();

    env.ledger().with_mut(|li| { li.sequence_number = 20; });

    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let result = client.renew(&sub_id, &2, &1500, &3, &10, &20270301, &true).unwrap();
    assert!(result);
}

// ── Cycle guard tests ─────────────────────────────────────────────

#[test]
fn test_duplicate_cycle_rejected_after_success() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 600u64;
    let cycle_id = 20260315u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    client.approve_renewal(&sub_id, &1, &1000, &100).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let result = client.renew(&sub_id, &1, &500, &3, &10, &cycle_id, &true).unwrap();
    assert!(result);

    client.approve_renewal(&sub_id, &2, &1000, &100).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let err = client
        .try_renew(&sub_id, &2, &500, &3, &10, &cycle_id, &true)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::DuplicateCycle);
}

#[test]
fn test_retry_same_cycle_allowed_after_failure() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 601u64;
    let cycle_id = 20260315u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    client.approve_renewal(&sub_id, &1, &1000, &200).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let result = client.renew(&sub_id, &1, &500, &3, &10, &cycle_id, &false).unwrap();
    assert!(!result);

    env.ledger().with_mut(|li| { li.sequence_number = 20; });

    client.approve_renewal(&sub_id, &2, &1000, &200).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let result = client.renew(&sub_id, &2, &500, &3, &10, &cycle_id, &true).unwrap();
    assert!(result);
}

#[test]
fn test_different_cycle_allowed_after_success() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 602u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    client.approve_renewal(&sub_id, &1, &1000, &100).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let result = client.renew(&sub_id, &1, &500, &3, &10, &20260315, &true).unwrap();
    assert!(result);

    client.approve_renewal(&sub_id, &2, &1000, &100).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let result = client.renew(&sub_id, &2, &500, &3, &10, &20260415, &true).unwrap();
    assert!(result);
}

#[test]
fn test_first_renewal_always_allowed() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 603u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    client.approve_renewal(&sub_id, &1, &1000, &100).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let result = client.renew(&sub_id, &1, &500, &3, &10, &20260101, &true).unwrap();
    assert!(result);

    let data = client.get_sub(&sub_id).unwrap();
    assert_eq!(data.state, SubscriptionState::Active);
}

// ── Cancel sub tests ──────────────────────────────────────────────

#[test]
fn test_cancel_sub() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 604u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    client.cancel_sub(&sub_id).unwrap();

    let data = client.get_sub(&sub_id).unwrap();
    assert_eq!(data.state, SubscriptionState::Cancelled);
}

#[test]
fn test_cannot_cancel_twice() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 605u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    client.cancel_sub(&sub_id).unwrap();
    let err = client.try_cancel_sub(&sub_id).unwrap_err().unwrap();
    assert_eq!(err, ContractError::AlreadyCancelled);
}

#[test]
fn test_cancel_non_existent_sub() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let err = client.try_cancel_sub(&999).unwrap_err().unwrap();
    assert_eq!(err, ContractError::SubscriptionNotFound);
}

// ── Spending cap tests ────────────────────────────────────────────

#[test]
fn test_per_subscription_spending_cap() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 700u64;
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &2000, &100).unwrap();

    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let err = client
        .try_renew(&sub_id, &1, &1500, &3, &10, &20270101, &true)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::SpendingCapExceeded);
}

#[test]
fn test_global_user_spending_cap() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    client.set_user_cap(&user, &2000).unwrap();

    let sub_id_1 = 701u64;
    let sub_id_2 = 702u64;
    client.init_sub(&user, &merchant, &1500, &86400, &5000, &sub_id_1);
    client.init_sub(&user, &merchant, &1000, &86400, &5000, &sub_id_2);

    client.approve_renewal(&sub_id_1, &1, &2000, &100).unwrap();
    client.approve_renewal(&sub_id_2, &1, &2000, &100).unwrap();

    client.acquire_renewal_lock(&sub_id_1, &200).unwrap();
    client.renew(&sub_id_1, &1, &1500, &3, &10, &20260101, &true).unwrap();

    client.acquire_renewal_lock(&sub_id_2, &200).unwrap();
    let err = client
        .try_renew(&sub_id_2, &1, &1000, &3, &10, &20260101, &true)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::GlobalCapExceeded);
}

// ── Renewal lock tests ────────────────────────────────────────────

#[test]
fn test_acquire_renewal_lock() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let sub_id = 710u64;
    client.acquire_renewal_lock(&sub_id, &200).unwrap();

    let lock = client.get_renewal_lock(&sub_id);
    assert!(lock.is_some());
    let lock_data = lock.unwrap();
    assert_eq!(lock_data.locked_at, 0);
    assert_eq!(lock_data.lock_timeout, 200);
}

#[test]
fn test_lock_prevents_concurrent_acquisition() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let sub_id = 711u64;
    client.acquire_renewal_lock(&sub_id, &200).unwrap();

    let err = client
        .try_acquire_renewal_lock(&sub_id, &200)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::RenewalLockActive);
}

#[test]
fn test_lock_auto_expires_and_reacquirable() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let sub_id = 712u64;
    client.acquire_renewal_lock(&sub_id, &50).unwrap();

    env.ledger().with_mut(|li| { li.sequence_number = 60; });

    client.acquire_renewal_lock(&sub_id, &200).unwrap();

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

    let sub_id = 713u64;
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    assert!(client.get_renewal_lock(&sub_id).is_some());

    client.release_renewal_lock(&sub_id).unwrap();
    assert!(client.get_renewal_lock(&sub_id).is_none());
}

#[test]
fn test_release_nonexistent_lock() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let err = client
        .try_release_renewal_lock(&714u64)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::NoRenewalLock);
}

#[test]
fn test_renew_without_lock_fails() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 715u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &100).unwrap();

    let err = client
        .try_renew(&sub_id, &1, &500, &3, &10, &20260101, &true)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::RenewalLockRequired);
}

#[test]
fn test_renew_with_lock_succeeds_and_auto_releases() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 716u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &100).unwrap();

    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    assert!(client.get_renewal_lock(&sub_id).is_some());

    let result = client.renew(&sub_id, &1, &500, &3, &10, &20260101, &true).unwrap();
    assert!(result);
    assert!(client.get_renewal_lock(&sub_id).is_none());
}

#[test]
fn test_renew_failure_also_releases_lock() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 717u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &200).unwrap();

    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let result = client.renew(&sub_id, &1, &500, &3, &10, &20260101, &false).unwrap();
    assert!(!result);
    assert!(client.get_renewal_lock(&sub_id).is_none());
}

#[test]
fn test_renew_with_expired_lock_fails() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 718u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &200).unwrap();

    client.acquire_renewal_lock(&sub_id, &50).unwrap();

    env.ledger().with_mut(|li| { li.sequence_number = 60; });

    let err = client
        .try_renew(&sub_id, &1, &500, &3, &10, &20260101, &true)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::RenewalLockExpired);
}

#[test]
fn test_acquire_lock_blocked_when_paused() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let sub_id = 719u64;
    client.set_paused(&true).unwrap();

    let err = client
        .try_acquire_renewal_lock(&sub_id, &200)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::ProtocolPaused);
}

#[test]
fn test_renew_blocked_when_paused() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 720u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.approve_renewal(&sub_id, &1, &1000, &100).unwrap();
    // acquire lock before pausing
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    client.set_paused(&true).unwrap();

    let err = client
        .try_renew(&sub_id, &1, &500, &3, &10, &20260101, &true)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::ProtocolPaused);
}

// ── Lifecycle timestamp tests ─────────────────────────────────────

#[test]
fn test_lifecycle_created_on_init() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    env.ledger().with_mut(|li| { li.timestamp = 1700000000; });

    let user = Address::generate(&env);
    let sub_id = 800u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    let lc = client.get_lifecycle(&sub_id).unwrap();
    assert_eq!(lc.created_at, 1700000000);
    assert_eq!(lc.activated_at, 1700000000);
    assert_eq!(lc.last_renewed_at, 0);
    assert_eq!(lc.canceled_at, 0);
}

#[test]
fn test_lifecycle_renewed_at_updated_on_success() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    env.ledger().with_mut(|li| { li.timestamp = 1700000000; });
    let user = Address::generate(&env);
    let sub_id = 801u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    env.ledger().with_mut(|li| { li.timestamp = 1700100000; });
    client.approve_renewal(&sub_id, &1, &1000, &100).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    client.renew(&sub_id, &1, &500, &3, &10, &20260101, &true).unwrap();

    let lc = client.get_lifecycle(&sub_id).unwrap();
    assert_eq!(lc.created_at, 1700000000);
    assert_eq!(lc.activated_at, 1700000000);
    assert_eq!(lc.last_renewed_at, 1700100000);
    assert_eq!(lc.canceled_at, 0);
}

#[test]
fn test_lifecycle_canceled_at_set_on_cancel() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    env.ledger().with_mut(|li| { li.timestamp = 1700000000; });
    let user = Address::generate(&env);
    let sub_id = 802u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    env.ledger().with_mut(|li| { li.timestamp = 1700200000; });
    client.cancel_sub(&sub_id).unwrap();

    let lc = client.get_lifecycle(&sub_id).unwrap();
    assert_eq!(lc.created_at, 1700000000);
    assert_eq!(lc.canceled_at, 1700200000);
}

#[test]
fn test_lifecycle_activated_at_updated_on_recovery_from_retrying() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    env.ledger().with_mut(|li| { li.timestamp = 1700000000; });
    let user = Address::generate(&env);
    let sub_id = 803u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    env.ledger().with_mut(|li| { li.timestamp = 1700100000; });
    client.approve_renewal(&sub_id, &1, &1000, &200).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    client.renew(&sub_id, &1, &500, &3, &10, &20260201, &false).unwrap();
    assert_eq!(client.get_sub(&sub_id).unwrap().state, SubscriptionState::Retrying);

    env.ledger().with_mut(|li| { li.sequence_number = 20; li.timestamp = 1700200000; });
    client.approve_renewal(&sub_id, &2, &1000, &200).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    client.renew(&sub_id, &2, &500, &3, &10, &20260201, &true).unwrap();

    let lc = client.get_lifecycle(&sub_id).unwrap();
    assert_eq!(lc.created_at, 1700000000);
    assert_eq!(lc.activated_at, 1700200000);
    assert_eq!(lc.last_renewed_at, 1700200000);
    assert_eq!(lc.canceled_at, 0);
}

#[test]
fn test_lifecycle_not_updated_on_renewal_failure() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    env.ledger().with_mut(|li| { li.timestamp = 1700000000; });
    let user = Address::generate(&env);
    let sub_id = 804u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    env.ledger().with_mut(|li| { li.timestamp = 1700100000; });
    client.approve_renewal(&sub_id, &1, &1000, &200).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    client.renew(&sub_id, &1, &500, &3, &10, &20260301, &false).unwrap();

    let lc = client.get_lifecycle(&sub_id).unwrap();
    assert_eq!(lc.last_renewed_at, 0);
    assert_eq!(lc.activated_at, 1700000000);
}

#[test]
fn test_lifecycle_multiple_renewals_update_last_renewed() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    env.ledger().with_mut(|li| { li.timestamp = 1700000000; });
    let user = Address::generate(&env);
    let sub_id = 805u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    env.ledger().with_mut(|li| { li.timestamp = 1700100000; });
    client.approve_renewal(&sub_id, &1, &1000, &100).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    client.renew(&sub_id, &1, &500, &3, &10, &20260401, &true).unwrap();
    assert_eq!(client.get_lifecycle(&sub_id).unwrap().last_renewed_at, 1700100000);

    env.ledger().with_mut(|li| { li.timestamp = 1700200000; });
    client.approve_renewal(&sub_id, &2, &1000, &100).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    client.renew(&sub_id, &2, &500, &3, &10, &20260501, &true).unwrap();

    let lc = client.get_lifecycle(&sub_id).unwrap();
    assert_eq!(lc.last_renewed_at, 1700200000);
    assert_eq!(lc.created_at, 1700000000);
}

#[test]
fn test_get_lifecycle_nonexistent_sub() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let err = client.try_get_lifecycle(&999u64).unwrap_err().unwrap();
    assert_eq!(err, ContractError::LifecycleNotFound);
}

// ── Renewal window tests ──────────────────────────────────────────

#[test]
fn test_window_start_must_be_before_end() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let err = client
        .try_set_window(&900u64, &1735689600u64, &1735689600u64)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::InvalidWindow);
}

#[test]
fn test_window_start_after_end_rejected() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let err = client
        .try_set_window(&901u64, &1735862400u64, &1735689600u64)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::InvalidWindow);
}

#[test]
fn test_renew_within_window_succeeds() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 902u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.set_window(&sub_id, &1000u64, &2000u64).unwrap();

    env.ledger().with_mut(|li| { li.timestamp = 1500; });
    client.approve_renewal(&sub_id, &1, &1000, &100).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let result = client.renew(&sub_id, &1, &500, &3, &10, &20260101u64, &true).unwrap();
    assert!(result);
}

#[test]
fn test_renew_before_window_fails() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 903u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.set_window(&sub_id, &1000u64, &2000u64).unwrap();

    env.ledger().with_mut(|li| { li.timestamp = 500; });
    client.approve_renewal(&sub_id, &1, &1000, &100).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let err = client
        .try_renew(&sub_id, &1, &500, &3, &10, &20260101u64, &true)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::OutsideRenewalWindow);
}

#[test]
fn test_renew_after_window_fails() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 904u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.set_window(&sub_id, &1000u64, &2000u64).unwrap();

    env.ledger().with_mut(|li| { li.timestamp = 2500; });
    client.approve_renewal(&sub_id, &1, &1000, &100).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let err = client
        .try_renew(&sub_id, &1, &500, &3, &10, &20260101u64, &true)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::OutsideRenewalWindow);
}

#[test]
fn test_renew_without_window_has_no_time_restriction() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 905u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);

    env.ledger().with_mut(|li| { li.timestamp = 9999999999; });
    client.approve_renewal(&sub_id, &1, &1000, &100).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let result = client.renew(&sub_id, &1, &500, &3, &10, &20260101u64, &true).unwrap();
    assert!(result);
}

#[test]
fn test_set_and_get_window() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 906u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.set_window(&sub_id, &1000u64, &2000u64).unwrap();

    let w = client.get_window(&sub_id).unwrap();
    assert_eq!(w.billing_start, 1000);
    assert_eq!(w.billing_end, 2000);
}

#[test]
fn test_approval_consumed_before_window_check() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let sub_id = 907u64;
    let merchant = Address::generate(&env);
    client.init_sub(&user, &merchant, &500, &86400, &1000, &sub_id);
    client.set_window(&sub_id, &1000u64, &2000u64).unwrap();

    // outside window — renew should fail with OutsideRenewalWindow
    env.ledger().with_mut(|li| { li.timestamp = 500; });
    client.approve_renewal(&sub_id, &1, &1000, &100).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let err = client
        .try_renew(&sub_id, &1, &500, &3, &10, &20260101u64, &true)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::OutsideRenewalWindow);

    // release lock, move inside window, use a fresh approval
    client.release_renewal_lock(&sub_id).unwrap();
    env.ledger().with_mut(|li| { li.timestamp = 1500; });
    client.approve_renewal(&sub_id, &2, &1000, &100).unwrap();
    client.acquire_renewal_lock(&sub_id, &200).unwrap();
    let result = client.renew(&sub_id, &2, &500, &3, &10, &20260102u64, &true).unwrap();
    assert!(result);
}
