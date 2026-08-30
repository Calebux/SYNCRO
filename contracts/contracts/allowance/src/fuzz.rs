#![cfg(test)]
extern crate std;

use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, EnvTestConfig, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};
use std::panic::{catch_unwind, AssertUnwindSafe};

use super::{AllowanceContract, AllowanceContractClient};

const PERIOD: u64 = 30 * 86_400;

fn fuzz_env() -> Env {
    Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
        ..EnvTestConfig::default()
    })
}

struct Ctx {
    env: Env,
    owner: Address,
    merchant: Address,
    token: Address,
    token_client: TokenClient<'static>,
    allowance: AllowanceContractClient<'static>,
}

fn fuzz_setup() -> Ctx {
    let env = fuzz_env();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let merchant = Address::generate(&env);

    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token = sac.address();
    let token_client = TokenClient::new(&env, &token);
    StellarAssetClient::new(&env, &token).mint(&owner, &1_000_000_000_000i128);

    let contract_id = env.register(AllowanceContract, ());
    let allowance = AllowanceContractClient::new(&env, &contract_id);
    allowance.init(&admin);
    token_client.approve(&owner, &contract_id, &1_000_000_000_000i128, &1_000_000u32);

    Ctx {
        env,
        owner,
        merchant,
        token,
        token_client,
        allowance,
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(16))]

    /// A single pull within both caps always moves exactly `amount` and updates
    /// both counters consistently.
    #[test]
    fn fuzz_single_consume_conserves(
        period_cap in 1i128..=1_000_000i128,
        amount in 1i128..=1_000_000i128,
    ) {
        let ctx = fuzz_setup();
        let absolute = period_cap; // absolute >= period_cap required
        let id = ctx.allowance.grant_allowance(
            &ctx.owner, &ctx.merchant, &ctx.token, &period_cap, &absolute, &PERIOD,
        );

        let result = catch_unwind(AssertUnwindSafe(|| ctx.allowance.consume(&id, &amount)));
        if amount <= period_cap {
            prop_assert!(result.is_ok());
            let a = ctx.allowance.get_allowance(&id);
            prop_assert_eq!(a.period_spent, amount);
            prop_assert_eq!(a.total_spent, amount);
            prop_assert_eq!(ctx.token_client.balance(&ctx.merchant), amount);
        } else {
            prop_assert!(result.is_err(), "over-cap pull must panic");
            prop_assert_eq!(ctx.token_client.balance(&ctx.merchant), 0);
        }
    }

    /// The sum of pulls in a single period can never exceed the period cap, and
    /// total_spent never exceeds the absolute cap.
    #[test]
    fn fuzz_caps_never_breached(
        period_cap in 1i128..=10_000i128,
        pulls in prop::collection::vec(1i128..=5_000i128, 1..8),
    ) {
        let ctx = fuzz_setup();
        let absolute = period_cap * 4;
        let id = ctx.allowance.grant_allowance(
            &ctx.owner, &ctx.merchant, &ctx.token, &period_cap, &absolute, &PERIOD,
        );

        for amount in pulls {
            let _ = catch_unwind(AssertUnwindSafe(|| ctx.allowance.consume(&id, &amount)));
            let a = ctx.allowance.get_allowance(&id);
            prop_assert!(a.period_spent <= a.period_cap);
            prop_assert!(a.total_spent <= a.absolute_cap);
            prop_assert_eq!(ctx.token_client.balance(&ctx.merchant), a.total_spent);
        }
    }

    /// After advancing a whole period the per-period budget is fully replenished
    /// (subject only to the absolute cap).
    #[test]
    fn fuzz_period_replenishes(cap in 1i128..=100_000i128) {
        let ctx = fuzz_setup();
        let absolute = cap * 10;
        let id = ctx.allowance.grant_allowance(
            &ctx.owner, &ctx.merchant, &ctx.token, &cap, &absolute, &PERIOD,
        );

        ctx.allowance.consume(&id, &cap); // exhaust the period
        prop_assert!(catch_unwind(AssertUnwindSafe(|| ctx.allowance.consume(&id, &1))).is_err());

        ctx.env.ledger().set_timestamp(ctx.env.ledger().timestamp() + PERIOD);
        prop_assert!(catch_unwind(AssertUnwindSafe(|| ctx.allowance.consume(&id, &cap))).is_ok());

        let a = ctx.allowance.get_allowance(&id);
        prop_assert_eq!(a.total_spent, cap * 2);
    }

    /// A revoked allowance can never be consumed again.
    #[test]
    fn fuzz_revoked_never_consumes(cap in 1i128..=100_000i128, amount in 1i128..=100_000i128) {
        let ctx = fuzz_setup();
        let id = ctx.allowance.grant_allowance(
            &ctx.owner, &ctx.merchant, &ctx.token, &cap, &cap, &PERIOD,
        );
        ctx.allowance.revoke_allowance(&id);

        let result = catch_unwind(AssertUnwindSafe(|| ctx.allowance.consume(&id, &amount)));
        prop_assert!(result.is_err(), "revoked allowance must reject consume");
        prop_assert_eq!(ctx.token_client.balance(&ctx.merchant), 0);
    }
}
