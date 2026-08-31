#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

// Assuming subscription-registry is exported as subscription_registry
use subscription_registry::{
    SubscriptionRegistry, SubscriptionRegistryClient, SubscriptionStatus, MIN_INTERVAL
};
use virtual_card::{VirtualCardContract, VirtualCardContractClient};

struct TestSetup<'a> {
    env: Env,
    admin: Address,
    user: Address,
    merchant: Address,
    token: TokenClient<'a>,
    _asset: StellarAssetClient<'a>,
    registry_client: SubscriptionRegistryClient<'a>,
    virtual_card_client: VirtualCardContractClient<'a>,
}

fn setup_environment<'a>() -> TestSetup<'a> {
    let env = Env::default();
    env.mock_all_auths();
    
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);
    
    // Setup token
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token = TokenClient::new(&env, &sac.address());
    let asset = StellarAssetClient::new(&env, &sac.address());
    
    // Fund user
    asset.mint(&user, &1_000_000_000i128);
    
    // Register contracts
    let registry_id = env.register(SubscriptionRegistry, ());
    let registry_client = SubscriptionRegistryClient::new(&env, &registry_id);
    
    let vc_id = env.register(VirtualCardContract, ());
    let virtual_card_client = VirtualCardContractClient::new(&env, &vc_id);
    
    // Initialize admin and Virtual Card integration
    registry_client.init_admin(&admin);
    registry_client.set_virtual_card_contract(&admin, &vc_id);
    
    TestSetup {
        env,
        admin,
        user,
        merchant,
        token,
        _asset: asset,
        registry_client,
        virtual_card_client,
    }
}

#[test]
fn test_registration_renewal_and_virtual_card_funding() {
    let setup = setup_environment();
    
    let initial_time = 100_000_000u64;
    setup.env.ledger().set_timestamp(initial_time);
    
    let amount = 5_000i128;
    let interval = MIN_INTERVAL;
    
    let sub_id = setup.registry_client.register_subscription(
        &setup.user,
        &setup.merchant,
        &setup.token.address,
        &amount,
        &interval
    );
    
    let sub = setup.registry_client.get_core_subscription(&sub_id).unwrap();
    assert_eq!(sub.status, SubscriptionStatus::Active);
    assert_eq!(setup.token.balance(&setup.user), 1_000_000_000i128);
    assert_eq!(setup.token.balance(&setup.merchant), 0i128);
    
    // Advance to renewal window
    setup.env.ledger().set_timestamp(sub.next_renewal_date + 100);
    
    // Renew subscription
    setup.registry_client.renew_subscription(&sub_id);
    
    // Verify balances
    assert_eq!(setup.token.balance(&setup.merchant), amount);
    assert_eq!(setup.token.balance(&setup.user), 1_000_000_000i128 - amount);
    
    // Verify Virtual Card issuance (disposable card should be created for user)
    // The issue_card method starts IDs at 1
    let card_id = 1u32;
    let card = setup.virtual_card_client.get_card(&card_id);
    
    assert_eq!(card.holder, setup.user);
    assert_eq!(card.balance, amount);
}

#[test]
fn test_registration_and_cancellation() {
    let setup = setup_environment();
    
    let amount = 5_000i128;
    let interval = MIN_INTERVAL;
    
    let sub_id = setup.registry_client.register_subscription(
        &setup.user,
        &setup.merchant,
        &setup.token.address,
        &amount,
        &interval
    );
    
    setup.registry_client.cancel_subscription(&sub_id, &setup.user);
    
    let sub = setup.registry_client.get_core_subscription(&sub_id).unwrap();
    assert_eq!(sub.status, SubscriptionStatus::Canceled);
    
    // Attempting renewal should fail
    let res = setup.registry_client.try_renew_subscription(&sub_id);
    assert!(res.is_err());
}
