/// Integration test for subscription_renewal cross-contract call to subscription_logging
/// Acceptance: Integration test invoking renewal that records a commitment in logging.
use soroban_sdk::{testutils::Address as _, Address, Env};

use subscription_logging::{SubscriptionLoggingContract, SubscriptionLoggingContractClient};
use subscription_renewal::{
    SubscriptionRenewalContract, SubscriptionRenewalContractClient, SubscriptionState,
};

#[test]
fn test_renewal_with_logging_integration() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    // Setup logging contract
    let log_id = env.register(SubscriptionLoggingContract, ());
    let log = SubscriptionLoggingContractClient::new(&env, &log_id);
    let admin = Address::generate(&env);
    log.init(&admin);

    // Setup renewal contract
    let renew_id = env.register(SubscriptionRenewalContract, ());
    let renew = SubscriptionRenewalContractClient::new(&env, &renew_id);
    renew.init(&admin);

    // KEY: Configure renewal contract to use logging contract for cross-contract calls
    renew.set_logging_contract(&log_id);

    // Verify no commitments yet
    assert_eq!(log.get_commitment_count(), 0);

    // Create subscription - this should automatically record a commitment via cross-contract call
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    renew.init_sub(&user, &merchant, &500, &86400, &1000, &1);

    // Verify initialization recorded a commitment automatically
    assert_eq!(log.get_commitment_count(), 1);
    let init_commitment = log.get_commitment(&0).unwrap();
    assert_eq!(init_commitment.commitment_index, 0);

    // Perform renewal - this should also record a commitment automatically
    renew.approve_renewal(&1, &1, &1000, &100);
    renew.acquire_renewal_lock(&1, &200, &admin);
    assert!(renew.renew(&1, &1, &500, &3, &10, &20260101, &true));

    // Verify renewal recorded a commitment automatically
    assert_eq!(log.get_commitment_count(), 2);
    let renewal_commitment = log.get_commitment(&1).unwrap();
    assert_eq!(renewal_commitment.commitment_index, 1);

    // Verify subscription state
    assert_eq!(renew.get_sub(&1).state, SubscriptionState::Active);
}

#[test]
fn test_cross_contract_call_on_cancellation() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    // Setup contracts
    let log_id = env.register(SubscriptionLoggingContract, ());
    let log = SubscriptionLoggingContractClient::new(&env, &log_id);
    let admin = Address::generate(&env);
    log.init(&admin);

    let renew_id = env.register(SubscriptionRenewalContract, ());
    let renew = SubscriptionRenewalContractClient::new(&env, &renew_id);
    renew.init(&admin);
    renew.set_logging_contract(&log_id);

    // Create subscription
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    renew.init_sub(&user, &merchant, &500, &86400, &1000, &2);

    assert_eq!(log.get_commitment_count(), 1);

    // Cancel subscription - should record another commitment
    renew.cancel_sub(&2);

    // Verify cancellation recorded a commitment
    assert_eq!(log.get_commitment_count(), 2);
    assert_eq!(renew.get_sub(&2).state, SubscriptionState::Cancelled);
}
