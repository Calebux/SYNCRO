use soroban_sdk::{
    testutils::{Address as _, Events as _},
    Address, Env,
};

use agent_registry::{AgentRegistry, AgentRegistryClient, Scope};
use subscription_renewal::{
    ContractError, SubscriptionRenewalContract, SubscriptionRenewalContractClient,
};

fn main() {
    let env = Env::default();
    env.mock_all_auths();

    let renewal_id = env.register_contract(None, SubscriptionRenewalContract);
    let renewal = SubscriptionRenewalContractClient::new(&env, &renewal_id);
    let admin = Address::generate(&env);
    renewal.init(&admin);

    let registry_id = env.register_contract(None, AgentRegistry);
    let registry = AgentRegistryClient::new(&env, &registry_id);
    registry.init(&admin);
    let scoped_agent = Address::generate(&env);
    registry.register(&scoped_agent, &(Scope::Renewals as u32));
    renewal.set_agent_registry(&registry_id);

    let owner = Address::generate(&env);
    let merchant = Address::generate(&env);
    let sub_id = 9001u64;
    renewal.init_sub(&owner, &merchant, &500, &86400, &1000, &sub_id);

    renewal.acquire_renewal_lock(&sub_id, &200, &owner);
    renewal.release_renewal_lock(&sub_id);

    let err = renewal
        .try_acquire_renewal_lock(&sub_id, &200, &owner)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::RenewalLockCooldown);
    let events = env.events().all();
    println!("events after cooldown rejection: {:?}", events);
    assert!(
        events.events().len() >= 1,
        "missing rejection event: {:?}",
        events
    );

    let outsider = Address::generate(&env);
    let err = renewal
        .try_acquire_renewal_lock(&sub_id, &200, &outsider)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::RenewalLockUnauthorized);

    let err = renewal
        .try_acquire_renewal_lock(&sub_id, &200, &scoped_agent)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::RenewalLockUnauthorized);

    println!("lock_regression_ok");
}
