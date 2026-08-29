use soroban_sdk::{testutils::Address as _, Address, Env};

use agent_registry::{AgentRegistry, AgentRegistryClient};
use subscription_renewal::{
    ContractError, SubscriptionRenewalContract, SubscriptionRenewalContractClient,
};

#[test]
fn test_lock_anti_griefing_cooldown_and_authorization() {
    let env = Env::default();
    env.mock_all_auths();

    // Setup contracts
    let renewal_id = env.register_contract(None, SubscriptionRenewalContract);
    let renewal = SubscriptionRenewalContractClient::new(&env, &renewal_id);
    let admin = Address::generate(&env);
    let _ = renewal.try_init(&admin).unwrap();

    let registry_id = env.register_contract(None, AgentRegistry);
    let registry = AgentRegistryClient::new(&env, &registry_id);
    let _ = registry.try_init(&admin).unwrap();
    let _ = renewal.try_set_agent_registry(&registry_id).unwrap();

    let owner = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 9001u64;

    // Initialize subscription
    renewal.init_sub(&owner, &merchant, &500, &86400, &1000, &sub_id);

    // ─── Test 1: Owner acquires lock successfully
    let _ = renewal
        .try_acquire_renewal_lock(&sub_id, &200, &owner)
        .unwrap();
    assert!(renewal.get_renewal_lock(&sub_id).is_some());

    // ─── Test 2: Owner releases lock
    let _ = renewal.try_release_renewal_lock(&sub_id).unwrap();
    assert!(renewal.get_renewal_lock(&sub_id).is_none());

    // ─── Test 3: Immediate re-acquisition by same owner triggers cooldown rejection
    let err = renewal
        .try_acquire_renewal_lock(&sub_id, &200, &owner)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::RenewalLockCooldown);

    // ─── Test 4: Unauthorized attacker is rejected
    let attacker = Address::generate(&env);
    let err = renewal
        .try_acquire_renewal_lock(&sub_id, &200, &attacker)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::RenewalLockUnauthorized);

    println!("✅ anti-griefing lock test passed");
}
