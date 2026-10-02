#![cfg(test)]

use soroban_sdk::{testutils::{Address as _, Ledger as _}, Address, Env, Symbol};

use super::{
    ContractError, ContractKey, PersistentKey, SubscriptionDataV1, SubscriptionRenewalContract,
    SubscriptionRenewalContractClient, SubscriptionState, SUBSCRIPTION_SCHEMA_VERSION,
    STORAGE_VERSION,
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

// ── Init tests ────────────────────────────────────────────────────

#[test]
fn test_cannot_init_twice() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let another = Address::generate(&env);
    let res = client.try_init(&another);
    assert_eq!(res, Err(Ok(ContractError::AlreadyInitialized)));
}

#[test]
fn test_init_sub_issues_ids_internally() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);

    // Ids are contract-issued (starting at 1), not caller-chosen.
    let first = client.init_sub(&user, &merchant, &500, &86400, &1000);
    let second = client.init_sub(&user, &merchant, &500, &86400, &1000);
    assert_eq!(first, 1);
    assert_eq!(second, 2);
}

#[test]
fn test_init_sub_rejects_existing_id() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    // First init issues id 1.
    assert_eq!(client.init_sub(&user, &merchant, &500, &86400, &1000), 1);

    // Rewind the shared counter so the next issued id collides with the
    // existing subscription and initialize with a different owner.
    env.as_contract(&id, || {
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "SubscriptionCounter"), &0u64);
    });

    let res = client.try_init_sub(&user, &merchant, &700, &86400, &1000);
    assert_eq!(res, Err(Ok(ContractError::SubscriptionAlreadyExists)));
}

#[test]
fn test_init_sub_counter_overflow_returns_typed_error() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    // Force the shared counter to the maximum so the next id overflows u64.
    env.as_contract(&id, || {
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "SubscriptionCounter"), &u64::MAX);
    });

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let res = client.try_init_sub(&user, &merchant, &500, &86400, &1000);
    assert_eq!(res, Err(Ok(ContractError::CounterOverflow)));
}

#[test]
fn test_v1_subscription_survives_storage_migration() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let owner = Address::generate(&env);
    let merchant = Address::generate(&env);
    let legacy = SubscriptionDataV1 {
        owner: owner.clone(),
        merchant: merchant.clone(),
        amount: 500,
        frequency: 86_400,
        spending_cap: 2_000,
        integrity_hash: soroban_sdk::BytesN::from_array(&env, &[7; 32]),
        state: SubscriptionState::Active,
        failure_count: 1,
        last_attempt_ledger: 42,
    };

    env.as_contract(&id, || {
        env.storage().instance().set(&ContractKey::StorageVersion, &1u32);
        env.storage()
            .persistent()
            .set(&PersistentKey::Subscription(1u64), &legacy);
    });

    client.migrate(&1u32);
    let subscription = client.get_sub(&1u64);
    assert_eq!(subscription.schema_version, SUBSCRIPTION_SCHEMA_VERSION);
    assert_eq!(subscription.owner, owner);
    assert_eq!(subscription.merchant, merchant);
    assert_eq!(subscription.amount, 500);
    assert_eq!(subscription.frequency, 86_400);
    assert_eq!(subscription.failure_count, 1);
    assert_eq!(client.get_storage_version(), STORAGE_VERSION);
}

// ── Renewal success / failure ─────────────────────────────────────

#[test]
fn test_renew_works_after_unpause() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);
    client.approve_renewal(&sub_id, &1, &1000, &100);

    client.set_paused(&true);
    client.set_paused(&false);

    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &1, &500, &3, &10, &20260101, &true);
    assert!(result);
}

#[test]
fn test_renewal_success() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);
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
    let max_retries = 2u32;
    let cooldown = 10u32;
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);

    client.approve_renewal(&sub_id, &1, &1000, &200);
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &1, &500, &max_retries, &cooldown, &20260201, &false);
    assert!(!result);

    let data = client.get_sub(&sub_id);
    assert_eq!(data.state, SubscriptionState::Retrying);
    assert_eq!(data.failure_count, 1);

    env.ledger().with_mut(|li| { li.sequence_number = 100; });

    client.approve_renewal(&sub_id, &2, &1000, &200);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &2, &500, &max_retries, &cooldown, &20260201, &false);

    env.ledger().with_mut(|li| { li.sequence_number = 120; });

    client.approve_renewal(&sub_id, &3, &1000, &200);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &3, &500, &max_retries, &cooldown, &20260201, &false);

    let data = client.get_sub(&sub_id);
    assert_eq!(data.state, SubscriptionState::Failed);
    assert_eq!(data.failure_count, 3);
}

#[test]
fn test_cooldown_enforcement() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);

    client.approve_renewal(&sub_id, &1, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &1, &500, &3, &10, &20260301, &false);

    client.approve_renewal(&sub_id, &2, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    let res = client.try_renew(&sub_id, &2, &500, &3, &10, &20260301, &false);
    assert_eq!(res, Err(Ok(ContractError::CooldownActive)));
}

#[test]
fn test_event_emission_on_success() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);
    client.approve_renewal(&sub_id, &1, &1000, &100);

    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &1, &500, &3, &10, &20260315, &true);
    assert!(result);

    let data = client.get_sub(&sub_id);
    assert_eq!(data.state, SubscriptionState::Active);
    assert_eq!(data.failure_count, 0);
}

#[test]
fn test_zero_max_retries() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);
    client.approve_renewal(&sub_id, &1, &1000, &100);

    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &1, &500, &0, &10, &20260401, &false);
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
    let max_retries = 3u32;
    let cooldown = 10u32;
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);

    client.approve_renewal(&sub_id, &1, &1000, &200);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &1, &500, &max_retries, &cooldown, &20260501, &false);
    assert_eq!(client.get_sub(&sub_id).state, SubscriptionState::Retrying);

    env.ledger().with_mut(|li| { li.sequence_number = 20; });

    client.approve_renewal(&sub_id, &2, &1000, &200);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &2, &500, &max_retries, &cooldown, &20260501, &false);
    assert_eq!(client.get_sub(&sub_id).state, SubscriptionState::Retrying);

    env.ledger().with_mut(|li| { li.sequence_number = 40; });

    client.approve_renewal(&sub_id, &3, &1000, &200);
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &3, &500, &max_retries, &cooldown, &20260501, &true);
    assert!(result);

    let data = client.get_sub(&sub_id);
    assert_eq!(data.state, SubscriptionState::Active);
    assert_eq!(data.failure_count, 0);
}

#[test]
fn test_cannot_renew_failed_subscription() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);

    client.approve_renewal(&sub_id, &1, &1000, &200);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &1, &500, &1, &10, &20260601, &false);

    env.ledger().with_mut(|li| { li.sequence_number = 20; });

    client.approve_renewal(&sub_id, &2, &1000, &200);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &2, &500, &1, &10, &20260601, &false);

    assert_eq!(client.get_sub(&sub_id).state, SubscriptionState::Failed);

    env.ledger().with_mut(|li| { li.sequence_number = 40; });

    client.approve_renewal(&sub_id, &3, &1000, &200);
    client.acquire_renewal_lock(&sub_id, &200);
    let res = client.try_renew(&sub_id, &3, &500, &1, &10, &20260701, &true);
    assert_eq!(res, Err(Ok(ContractError::SubscriptionFailed)));
}

// ── Approval system tests ─────────────────────────────────────────

#[test]
fn test_approval_required_for_renewal() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);
    client.approve_renewal(&sub_id, &1, &1000, &100);

    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &1, &500, &3, &10, &20260801, &true);
    assert!(result);
}

#[test]
fn test_renewal_without_approval_fails() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);

    client.acquire_renewal_lock(&sub_id, &200);
    let res = client.try_renew(&sub_id, &999, &500, &3, &10, &20260901, &true);
    assert_eq!(res, Err(Ok(ContractError::InvalidApproval)));
}

#[test]
fn test_approval_cannot_be_reused() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);
    client.approve_renewal(&sub_id, &2, &1000, &100);

    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &2, &500, &3, &10, &20261001, &true);

    env.ledger().with_mut(|li| { li.sequence_number = 20; });

    client.acquire_renewal_lock(&sub_id, &200);
    let res = client.try_renew(&sub_id, &2, &500, &3, &10, &20261101, &true);
    assert_eq!(res, Err(Ok(ContractError::InvalidApproval)));
}

#[test]
fn test_expired_approval_rejected() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);
    client.approve_renewal(&sub_id, &3, &1000, &50);

    env.ledger().with_mut(|li| { li.sequence_number = 51; });

    client.acquire_renewal_lock(&sub_id, &200);
    let res = client.try_renew(&sub_id, &3, &500, &3, &10, &20261201, &true);
    assert_eq!(res, Err(Ok(ContractError::InvalidApproval)));
}

#[test]
fn test_amount_exceeds_max_spend() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);
    client.approve_renewal(&sub_id, &4, &1000, &100);

    client.acquire_renewal_lock(&sub_id, &200);
    let res = client.try_renew(&sub_id, &4, &1500, &3, &10, &20270101, &true);
    assert_eq!(res, Err(Ok(ContractError::InvalidApproval)));
}

#[test]
fn test_multiple_approvals_for_same_subscription() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &5000);
    client.approve_renewal(&sub_id, &1, &1000, &100);
    client.approve_renewal(&sub_id, &2, &2000, &200);

    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &1, &500, &3, &10, &20270201, &true);

    env.ledger().with_mut(|li| { li.sequence_number = 20; });

    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &2, &1500, &3, &10, &20270301, &true);
    assert!(result);
}

// ── Cycle guard tests ─────────────────────────────────────────────

#[test]
fn test_duplicate_cycle_rejected_after_success() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let cycle_id = 20260315u64;
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);

    client.approve_renewal(&sub_id, &1, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &1, &500, &3, &10, &cycle_id, &true);
    assert!(result);

    client.approve_renewal(&sub_id, &2, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    let res = client.try_renew(&sub_id, &2, &500, &3, &10, &cycle_id, &true);
    assert_eq!(res, Err(Ok(ContractError::DuplicateCycle)));
}

#[test]
fn test_retry_same_cycle_allowed_after_failure() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let cycle_id = 20260315u64;
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);

    client.approve_renewal(&sub_id, &1, &1000, &200);
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &1, &500, &3, &10, &cycle_id, &false);
    assert!(!result);

    env.ledger().with_mut(|li| { li.sequence_number = 20; });

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
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);

    client.approve_renewal(&sub_id, &1, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &1, &500, &3, &10, &20260315, &true);
    assert!(result);

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
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);

    client.approve_renewal(&sub_id, &1, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &1, &500, &3, &10, &20260101, &true);
    assert!(result);

    let data = client.get_sub(&sub_id);
    assert_eq!(data.state, SubscriptionState::Active);
}

// ── Cancel sub tests ──────────────────────────────────────────────

#[test]
fn test_cancel_sub() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);

    client.cancel_sub(&sub_id);

    let data = client.get_sub(&sub_id);
    assert_eq!(data.state, SubscriptionState::Cancelled);
}

#[test]
fn test_cannot_cancel_twice() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);

    client.cancel_sub(&sub_id);
    let res = client.try_cancel_sub(&sub_id);
    assert_eq!(res, Err(Ok(ContractError::AlreadyCancelled)));
}

#[test]
fn test_cancel_non_existent_sub() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let res = client.try_cancel_sub(&999);
    assert_eq!(res, Err(Ok(ContractError::SubscriptionNotFound)));
}

// ── Spending cap tests ────────────────────────────────────────────

#[test]
fn test_per_subscription_spending_cap() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);
    client.approve_renewal(&sub_id, &1, &2000, &100);

    client.acquire_renewal_lock(&sub_id, &200);
    let res = client.try_renew(&sub_id, &1, &1500, &3, &10, &20270101, &true);
    assert_eq!(res, Err(Ok(ContractError::SpendingCapExceeded)));
}

#[test]
fn test_global_user_spending_cap() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    client.set_user_cap(&user, &2000);

    let sub_id_1 = client.init_sub(&user, &merchant, &1500, &86400, &5000);
    let sub_id_2 = client.init_sub(&user, &merchant, &1000, &86400, &5000);

    client.approve_renewal(&sub_id_1, &1, &2000, &100);
    client.approve_renewal(&sub_id_2, &1, &2000, &100);

    client.acquire_renewal_lock(&sub_id_1, &200);
    client.renew(&sub_id_1, &1, &1500, &3, &10, &20260101, &true);

    client.acquire_renewal_lock(&sub_id_2, &200);
    let res = client.try_renew(&sub_id_2, &1, &1000, &3, &10, &20260101, &true);
    assert_eq!(res, Err(Ok(ContractError::GlobalCapExceeded)));
}

// ── Renewal lock tests ────────────────────────────────────────────

#[test]
fn test_acquire_renewal_lock() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let sub_id = 710u64;
    client.acquire_renewal_lock(&sub_id, &200);

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
    client.acquire_renewal_lock(&sub_id, &200);

    let res = client.try_acquire_renewal_lock(&sub_id, &200);
    assert_eq!(res, Err(Ok(ContractError::RenewalLockActive)));
}

#[test]
fn test_lock_auto_expires_and_reacquirable() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let sub_id = 712u64;
    client.acquire_renewal_lock(&sub_id, &50);

    env.ledger().with_mut(|li| { li.sequence_number = 60; });

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

    let sub_id = 713u64;
    client.acquire_renewal_lock(&sub_id, &200);
    assert!(client.get_renewal_lock(&sub_id).is_some());

    client.release_renewal_lock(&sub_id);
    assert!(client.get_renewal_lock(&sub_id).is_none());
}

#[test]
fn test_release_nonexistent_lock() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let res = client.try_release_renewal_lock(&714u64);
    assert_eq!(res, Err(Ok(ContractError::NoRenewalLock)));
}

#[test]
fn test_renew_without_lock_fails() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);
    client.approve_renewal(&sub_id, &1, &1000, &100);

    let res = client.try_renew(&sub_id, &1, &500, &3, &10, &20260101, &true);
    assert_eq!(res, Err(Ok(ContractError::RenewalLockRequired)));
}

#[test]
fn test_renew_with_lock_succeeds_and_auto_releases() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);
    client.approve_renewal(&sub_id, &1, &1000, &100);

    client.acquire_renewal_lock(&sub_id, &200);
    assert!(client.get_renewal_lock(&sub_id).is_some());

    let result = client.renew(&sub_id, &1, &500, &3, &10, &20260101, &true);
    assert!(result);
    assert!(client.get_renewal_lock(&sub_id).is_none());
}

#[test]
fn test_renew_failure_also_releases_lock() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);
    client.approve_renewal(&sub_id, &1, &1000, &200);

    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &1, &500, &3, &10, &20260101, &false);
    assert!(!result);
    assert!(client.get_renewal_lock(&sub_id).is_none());
}

#[test]
fn test_renew_with_expired_lock_fails() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);
    client.approve_renewal(&sub_id, &1, &1000, &200);

    client.acquire_renewal_lock(&sub_id, &50);

    env.ledger().with_mut(|li| { li.sequence_number = 60; });

    let res = client.try_renew(&sub_id, &1, &500, &3, &10, &20260101, &true);
    assert_eq!(res, Err(Ok(ContractError::RenewalLockExpired)));
}

#[test]
fn test_acquire_lock_blocked_when_paused() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let sub_id = 719u64;
    client.set_paused(&true);

    let res = client.try_acquire_renewal_lock(&sub_id, &200);
    assert_eq!(res, Err(Ok(ContractError::ProtocolPaused)));
}

#[test]
fn test_renew_blocked_when_paused() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);
    client.approve_renewal(&sub_id, &1, &1000, &100);
    // acquire lock before pausing
    client.acquire_renewal_lock(&sub_id, &200);
    client.set_paused(&true);

    let res = client.try_renew(&sub_id, &1, &500, &3, &10, &20260101, &true);
    assert_eq!(res, Err(Ok(ContractError::ProtocolPaused)));
}

// ── Lifecycle timestamp tests ─────────────────────────────────────

#[test]
fn test_lifecycle_created_on_init() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    env.ledger().with_mut(|li| { li.timestamp = 1700000000; });

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);

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

    env.ledger().with_mut(|li| { li.timestamp = 1700000000; });
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);

    env.ledger().with_mut(|li| { li.timestamp = 1700100000; });
    client.approve_renewal(&sub_id, &1, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &1, &500, &3, &10, &20260101, &true);

    let lc = client.get_lifecycle(&sub_id);
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
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);

    env.ledger().with_mut(|li| { li.timestamp = 1700200000; });
    client.cancel_sub(&sub_id);

    let lc = client.get_lifecycle(&sub_id);
    assert_eq!(lc.created_at, 1700000000);
    assert_eq!(lc.canceled_at, 1700200000);
}

#[test]
fn test_lifecycle_activated_at_updated_on_recovery_from_retrying() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    env.ledger().with_mut(|li| { li.timestamp = 1700000000; });
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);

    env.ledger().with_mut(|li| { li.timestamp = 1700100000; });
    client.approve_renewal(&sub_id, &1, &1000, &200);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &1, &500, &3, &10, &20260201, &false);
    assert_eq!(client.get_sub(&sub_id).state, SubscriptionState::Retrying);

    env.ledger().with_mut(|li| { li.sequence_number = 20; li.timestamp = 1700200000; });
    client.approve_renewal(&sub_id, &2, &1000, &200);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &2, &500, &3, &10, &20260201, &true);

    let lc = client.get_lifecycle(&sub_id);
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
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);

    env.ledger().with_mut(|li| { li.timestamp = 1700100000; });
    client.approve_renewal(&sub_id, &1, &1000, &200);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &1, &500, &3, &10, &20260301, &false);

    let lc = client.get_lifecycle(&sub_id);
    assert_eq!(lc.last_renewed_at, 0);
    assert_eq!(lc.activated_at, 1700000000);
}

#[test]
fn test_lifecycle_multiple_renewals_update_last_renewed() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    env.ledger().with_mut(|li| { li.timestamp = 1700000000; });
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);

    env.ledger().with_mut(|li| { li.timestamp = 1700100000; });
    client.approve_renewal(&sub_id, &1, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &1, &500, &3, &10, &20260401, &true);
    assert_eq!(client.get_lifecycle(&sub_id).last_renewed_at, 1700100000);

    env.ledger().with_mut(|li| { li.timestamp = 1700200000; });
    client.approve_renewal(&sub_id, &2, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    client.renew(&sub_id, &2, &500, &3, &10, &20260501, &true);

    let lc = client.get_lifecycle(&sub_id);
    assert_eq!(lc.last_renewed_at, 1700200000);
    assert_eq!(lc.created_at, 1700000000);
}

#[test]
fn test_get_lifecycle_nonexistent_sub() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let res = client.try_get_lifecycle(&999u64);
    assert_eq!(res, Err(Ok(ContractError::LifecycleNotFound)));
}

// ── Renewal window tests ──────────────────────────────────────────

#[test]
fn test_window_start_must_be_before_end() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let res = client.try_set_window(&900u64, &1735689600u64, &1735689600u64);
    assert_eq!(res, Err(Ok(ContractError::InvalidWindow)));
}

#[test]
fn test_window_start_after_end_rejected() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let res = client.try_set_window(&901u64, &1735862400u64, &1735689600u64);
    assert_eq!(res, Err(Ok(ContractError::InvalidWindow)));
}

#[test]
fn test_renew_within_window_succeeds() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);
    client.set_window(&sub_id, &1000u64, &2000u64);

    env.ledger().with_mut(|li| { li.timestamp = 1500; });
    client.approve_renewal(&sub_id, &1, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &1, &500, &3, &10, &20260101u64, &true);
    assert!(result);
}

#[test]
fn test_renew_before_window_fails() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);
    client.set_window(&sub_id, &1000u64, &2000u64);

    env.ledger().with_mut(|li| { li.timestamp = 500; });
    client.approve_renewal(&sub_id, &1, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    let res = client.try_renew(&sub_id, &1, &500, &3, &10, &20260101u64, &true);
    assert_eq!(res, Err(Ok(ContractError::OutsideRenewalWindow)));
}

#[test]
fn test_renew_after_window_fails() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);
    client.set_window(&sub_id, &1000u64, &2000u64);

    env.ledger().with_mut(|li| { li.timestamp = 2500; });
    client.approve_renewal(&sub_id, &1, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    let res = client.try_renew(&sub_id, &1, &500, &3, &10, &20260101u64, &true);
    assert_eq!(res, Err(Ok(ContractError::OutsideRenewalWindow)));
}

#[test]
fn test_renew_without_window_has_no_time_restriction() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);

    env.ledger().with_mut(|li| { li.timestamp = 9999999999; });
    client.approve_renewal(&sub_id, &1, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &1, &500, &3, &10, &20260101u64, &true);
    assert!(result);
}

#[test]
fn test_set_and_get_window() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);
    client.set_window(&sub_id, &1000u64, &2000u64);

    let w = client.get_window(&sub_id).unwrap();
    assert_eq!(w.billing_start, 1000);
    assert_eq!(w.billing_end, 2000);
}

#[test]
fn test_approval_consumed_before_window_check() {
    let (env, id, _admin) = setup();
    let client = SubscriptionRenewalContractClient::new(&env, &id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = client.init_sub(&user, &merchant, &500, &86400, &1000);
    client.set_window(&sub_id, &1000u64, &2000u64);

    // outside window — renew should fail with OutsideRenewalWindow
    env.ledger().with_mut(|li| { li.timestamp = 500; });
    client.approve_renewal(&sub_id, &1, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    let res = client.try_renew(&sub_id, &1, &500, &3, &10, &20260101u64, &true);
    assert_eq!(res, Err(Ok(ContractError::OutsideRenewalWindow)));

    // release lock, move inside window, use a fresh approval
    client.release_renewal_lock(&sub_id);
    env.ledger().with_mut(|li| { li.timestamp = 1500; });
    client.approve_renewal(&sub_id, &2, &1000, &100);
    client.acquire_renewal_lock(&sub_id, &200);
    let result = client.renew(&sub_id, &2, &500, &3, &10, &20260102u64, &true);
    assert!(result);
}
