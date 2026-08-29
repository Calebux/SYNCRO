#![cfg(test)]
extern crate std;

use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, EnvTestConfig},
    Address, Env,
};

use super::{
    ContractError, SubscriptionRenewalContract, SubscriptionRenewalContractClient,
    SubscriptionState,
};

fn fuzz_env() -> Env {
    Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
        ..EnvTestConfig::default()
    })
}

fn fuzz_setup() -> (Env, Address, Address) {
    let env = fuzz_env();
    env.mock_all_auths();
    let id = env.register_contract(None, SubscriptionRenewalContract);
    let admin = Address::generate(&env);
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    client.init(&admin).unwrap();
    (env, id, admin)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(8))]

    /// Fuzz subscription init with random amounts and billing intervals.
    #[test]
    fn fuzz_init_sub_amounts_and_intervals(
        amount in 1i128..=1_000_000_000i128,
        frequency in 1u64..=31_536_000u64,
        spending_cap in 0i128..=10_000_000_000i128,
        sub_id in 1u64..=10_000u64,
    ) {
        let (env, id, _admin) = fuzz_setup();
        let client = SubscriptionRenewalContractClient::new(&env, &id);
        let user = Address::generate(&env);
        let merchant = Address::generate(&env);

        client.init_sub(&user, &merchant, &amount, &frequency, &spending_cap, &sub_id);

        let data = client.get_sub(&sub_id).unwrap();
        prop_assert_eq!(data.amount, amount);
        prop_assert_eq!(data.frequency, frequency);
        prop_assert_eq!(data.spending_cap, spending_cap);
        prop_assert_eq!(data.state, SubscriptionState::Active);
    }

    /// Successful renewals must never exceed the per-subscription spending cap.
    #[test]
    fn fuzz_renewal_respects_spending_cap(
        amount in 1i128..=500_000i128,
        spending_cap in 1i128..=1_000_000i128,
        renew_amount in 1i128..=2_000_000i128,
    ) {
        let (env, id, _admin) = fuzz_setup();
        let client = SubscriptionRenewalContractClient::new(&env, &id);
        let user = Address::generate(&env);
        let merchant = Address::generate(&env);
        let sub_id = 42u64;

        client.init_sub(&user, &merchant, &amount, &86400u64, &spending_cap, &sub_id);
        client.approve_renewal(&sub_id, &1u64, &renew_amount, &10_000u32).unwrap();
        client.acquire_renewal_lock(&sub_id, &200u32, &admin).unwrap();

        let exceeds_cap = spending_cap > 0 && renew_amount > spending_cap;

        if exceeds_cap {
            let result = client.try_renew(
                &sub_id, &1u64, &renew_amount, &3u32, &10u32, &20260101u64, &true,
            );
            prop_assert_eq!(
                result.unwrap_err().unwrap(),
                ContractError::SpendingCapExceeded,
                "renewal exceeding cap must return SpendingCapExceeded"
            );
        } else {
            let ok = client
                .renew(&sub_id, &1u64, &renew_amount, &3u32, &10u32, &20260101u64, &true)
                .unwrap();
            prop_assert!(ok);
            let spent = client.get_user_spent(&user);
            prop_assert_eq!(spent, renew_amount);
        }
    }

    /// Global user cap overflow: current_spent + amount must not exceed cap.
    #[test]
    fn fuzz_global_cap_overflow_rejected(
        cap in 100i128..=10_000i128,
        first_amount in 1i128..=5_000i128,
        second_amount in 1i128..=10_000i128,
    ) {
        let (env, id, _admin) = fuzz_setup();
        let client = SubscriptionRenewalContractClient::new(&env, &id);
        let user = Address::generate(&env);
        let merchant = Address::generate(&env);

        client.set_user_cap(&user, &cap).unwrap();

        let sub_a = 1u64;
        let sub_b = 2u64;
        client.init_sub(&user, &merchant, &100i128, &86400u64, &0i128, &sub_a);
        client.init_sub(&user, &merchant, &100i128, &86400u64, &0i128, &sub_b);

        client.approve_renewal(&sub_a, &1u64, &first_amount, &10_000u32).unwrap();
        client.acquire_renewal_lock(&sub_a, &200u32, &admin).unwrap();
        if first_amount <= cap {
            let _ = client.renew(&sub_a, &1u64, &first_amount, &3u32, &10u32, &20260101u64, &true);
        }

        let spent = client.get_user_spent(&user);
        let remaining = cap.saturating_sub(spent);

        client.approve_renewal(&sub_b, &1u64, &second_amount, &10_000u32).unwrap();
        client.acquire_renewal_lock(&sub_b, &200u32, &admin).unwrap();

        if second_amount > remaining {
            let result = client.try_renew(
                &sub_b, &1u64, &second_amount, &3u32, &10u32, &20260201u64, &true,
            );
            prop_assert_eq!(
                result.unwrap_err().unwrap(),
                ContractError::GlobalCapExceeded,
                "global cap overflow must return GlobalCapExceeded"
            );
        }
    }

    /// Admin-only set_paused must return NotInitialized when contract is not initialized.
    #[test]
    fn fuzz_uninitialized_contract_rejects_admin_ops(_seed in 0u64..=1000u64) {
        let env = fuzz_env();
        env.mock_all_auths();
        let id = env.register_contract(None, SubscriptionRenewalContract);
        let client = SubscriptionRenewalContractClient::new(&env, &id);

        let result = client.try_set_paused(&true);
        prop_assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::NotInitialized,
            "admin ops on uninitialized contract must return NotInitialized"
        );
    }

    /// Approval single-use: consuming an approval twice must return InvalidApproval.
    #[test]
    fn fuzz_approval_single_use(
        amount in 1i128..=100_000i128,
        approval_max in 1i128..=1_000_000i128,
    ) {
        let (env, id, _admin) = fuzz_setup();
        let client = SubscriptionRenewalContractClient::new(&env, &id);
        let user = Address::generate(&env);
        let merchant = Address::generate(&env);
        let sub_id = 7u64;
        let renew_amount = amount.min(approval_max);

        client.init_sub(&user, &merchant, &amount, &86400u64, &0i128, &sub_id);
        client.approve_renewal(&sub_id, &1u64, &approval_max, &10_000u32).unwrap();

        client.acquire_renewal_lock(&sub_id, &200u32, &admin).unwrap();
        let _ = client.renew(&sub_id, &1u64, &renew_amount, &3u32, &10u32, &20260101u64, &true);

        client.acquire_renewal_lock(&sub_id, &200u32, &admin).unwrap();
        let result = client.try_renew(
            &sub_id, &1u64, &renew_amount, &3u32, &10u32, &20260201u64, &true,
        );
        prop_assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::InvalidApproval,
            "reused approval must return InvalidApproval"
        );
    }
}
