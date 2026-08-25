#![cfg(test)]
extern crate std;

use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, EnvTestConfig, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

use super::{SubscriptionRegistry, SubscriptionRegistryClient, RENEWAL_WINDOW, MIN_INTERVAL};

fn fuzz_env() -> Env {
    Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
    })
}

fn setup_token(env: &Env) -> (Address, Address, Address, TokenClient<'static>) {
    let admin = Address::generate(env);
    let user = Address::generate(env);
    let merchant = Address::generate(env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token = TokenClient::new(env, &sac.address());
    let asset = StellarAssetClient::new(env, &sac.address());
    asset.mint(&user, &1_000_000_000i128);
    (user, merchant, sac.address(), token)
}

fn register_client(env: &Env) -> SubscriptionRegistryClient<'static> {
    let contract_id = env.register(SubscriptionRegistry, ());
    SubscriptionRegistryClient::new(env, &contract_id)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(50))]

    /// Fuzz test for renewal window timings
    #[test]
    fn fuzz_renewal_timing(
        time_offset in -86400i64..=1209600i64,
    ) {
        let env = fuzz_env();
        env.mock_all_auths();
        let client = register_client(&env);
        let (user, merchant, token, _) = setup_token(&env);

        let interval = MIN_INTERVAL;
        let amount = 1_000i128;
        
        let initial_ledger_time = 100_000_000u64;
        env.ledger().set_timestamp(initial_ledger_time);

        let sub_id = client.register_subscription(&user, &merchant, &token, &amount, &interval);
        
        let sub = client.get_core_subscription(&sub_id).unwrap();
        let next_renewal = sub.next_renewal_date;

        // Advance ledger to testing time
        let test_time = (next_renewal as i64 + time_offset).max(0) as u64;
        env.ledger().set_timestamp(test_time);

        let window_end = next_renewal + RENEWAL_WINDOW;
        let is_valid = test_time >= next_renewal && test_time <= window_end;

        if is_valid {
            // Should succeed
            client.renew_subscription(&sub_id);
            let updated_sub = client.get_core_subscription(&sub_id).unwrap();
            prop_assert_eq!(updated_sub.next_renewal_date, next_renewal + interval);
        } else {
            // Should panic
            let result = client.try_renew_subscription(&sub_id);
            prop_assert!(result.is_err(), "Expected failure outside renewal window");
        }
    }
}
