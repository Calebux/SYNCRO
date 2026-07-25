#![cfg(test)]
extern crate std;

use proptest::prelude::*;
use soroban_sdk::{testutils::{Address as _, EnvTestConfig, Ledger}, Address, Env};
use std::panic::{catch_unwind, AssertUnwindSafe};

use super::{
    ChannelState, PaymentChannelContract, PaymentChannelContractClient,
};

fn fuzz_env() -> Env {
    Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
        ..EnvTestConfig::default()
    })
}

fn fuzz_setup() -> (Env, PaymentChannelContractClient<'static>, Address, Address, Address) {
    let env = fuzz_env();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PaymentChannelContract);
    let client = PaymentChannelContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let depositor = Address::generate(&env);
    let counterparty = Address::generate(&env);

    client.init(&admin);
    (env, client, admin, depositor, counterparty)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(8))]

    #[test]
    fn fuzz_open_channel_random_deposits(
        deposit in 1i128..=1_000_000_000i128,
        dispute_window in 1u64..=1_000_000u64,
    ) {
        let (env, client, _admin, depositor, counterparty) = fuzz_setup();
        let channel_id =
            client.open_channel(&depositor, &counterparty, &deposit, &dispute_window);

        let channel = client.get_channel(&channel_id).unwrap();
        prop_assert_eq!(channel.balance_a, deposit);
        prop_assert_eq!(channel.balance_b, 0);
        prop_assert_eq!(channel.state, ChannelState::Open);
        prop_assert_eq!(channel.sequence, 0);
        prop_assert!(channel.dispute_deadline >= env.ledger().timestamp());
    }

    #[test]
    fn fuzz_top_up_balance_conservation(
        initial in 1i128..=1_000_000i128,
        top_ups in prop::collection::vec(1i128..=100_000i128, 1..=5),
    ) {
        let (_env, client, _admin, depositor, counterparty) = fuzz_setup();
        let channel_id = client.open_channel(&depositor, &counterparty, &initial, &100u64);

        let mut expected_a = initial;
        for amount in &top_ups {
            client.top_up(&channel_id, amount, &depositor);
            expected_a = expected_a.saturating_add(*amount);
        }

        let channel = client.get_channel(&channel_id).unwrap();
        let total = channel.balance_a.saturating_add(channel.balance_b);
        prop_assert_eq!(channel.balance_a, expected_a);
        prop_assert_eq!(total, expected_a);
    }

    #[test]
    fn fuzz_state_transition_sequence_monotonic(
        deposit in 100i128..=1_000_000i128,
        seq_delta in 1u64..=100u64,
        split in 0i128..=100i128,
    ) {
        let (_env, client, _admin, depositor, counterparty) = fuzz_setup();
        let channel_id = client.open_channel(&depositor, &counterparty, &deposit, &100u64);

        let balance_b = split.min(deposit);
        let balance_a = deposit - balance_b;
        let seq = seq_delta;

        client.submit_state(
            &channel_id,
            &balance_a,
            &balance_b,
            &seq,
            &depositor,
            &counterparty,
        );

        let channel = client.get_channel(&channel_id).unwrap();
        prop_assert_eq!(channel.sequence, seq);
        prop_assert_eq!(channel.balance_a, balance_a);
        prop_assert_eq!(channel.balance_b, balance_b);
        prop_assert_eq!(
            channel.balance_a.saturating_add(channel.balance_b),
            deposit
        );
    }

    #[test]
    fn fuzz_stale_sequence_rejected(
        deposit in 100i128..=1_000_000i128,
        stale_seq in 0u64..=5u64,
    ) {
        let (_env, client, _admin, depositor, counterparty) = fuzz_setup();
        let channel_id = client.open_channel(&depositor, &counterparty, &deposit, &100u64);

        client.submit_state(
            &channel_id,
            &deposit,
            &0i128,
            &10u64,
            &depositor,
            &counterparty,
        );

        let result = catch_unwind(AssertUnwindSafe(|| {
            client.submit_state(
                &channel_id,
                &deposit,
                &0i128,
                &stale_seq,
                &depositor,
                &counterparty,
            );
        }));
        prop_assert!(result.is_err(), "stale sequence must be rejected");
    }

    #[test]
    fn fuzz_unauthorized_top_up_rejected(
        deposit in 1i128..=1_000_000i128,
        top_up_amount in 1i128..=100_000i128,
    ) {
        let (_env, client, _admin, depositor, counterparty) = fuzz_setup();
        let channel_id = client.open_channel(&depositor, &counterparty, &deposit, &100u64);

        let result = catch_unwind(AssertUnwindSafe(|| {
            client.top_up(&channel_id, &top_up_amount, &counterparty);
        }));
        prop_assert!(result.is_err(), "unauthorized top-up must be rejected");

        let channel = client.get_channel(&channel_id).unwrap();
        prop_assert_eq!(channel.balance_a, deposit);
    }

    #[test]
    fn fuzz_invalid_deposit_amounts_rejected(amount in -1_000_000i128..=0i128) {
        let (_env, client, _admin, depositor, counterparty) = fuzz_setup();
        let result = catch_unwind(AssertUnwindSafe(|| {
            client.open_channel(&depositor, &counterparty, &amount, &100u64);
        }));
        prop_assert!(result.is_err(), "invalid deposit amount must be rejected");
    }

    #[test]
    fn fuzz_close_state_transitions(
        deposit in 100i128..=1_000_000i128,
        balance_b in 0i128..=100i128,
    ) {
        let (env, client, _admin, depositor, counterparty) = fuzz_setup();
        let balance_b = balance_b.min(deposit);
        let balance_a = deposit - balance_b;

        let channel_id = client.open_channel(&depositor, &counterparty, &deposit, &1u64);

        client.initiate_close(
            &channel_id,
            &balance_a,
            &balance_b,
            &1u64,
            &depositor,
        );

        let closing = client.get_channel(&channel_id).unwrap();
        prop_assert_eq!(closing.state, ChannelState::Closing);

        env.ledger().set_timestamp(closing.dispute_deadline + 1);
        client.finalize(&channel_id);

        let closed = client.get_channel(&channel_id).unwrap();
        prop_assert_eq!(closed.state, ChannelState::Closed);
        prop_assert_eq!(
            closed.balance_a.saturating_add(closed.balance_b),
            deposit
        );
    }
}
