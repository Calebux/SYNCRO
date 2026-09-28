#![cfg(test)]
extern crate std;

use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, EnvTestConfig, Ledger},
    token::StellarAssetClient,
    Address, Env,
};
use std::panic::{catch_unwind, AssertUnwindSafe};

use super::{ChannelState, PaymentChannelContract, PaymentChannelContractClient};

fn fuzz_env() -> Env {
    Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
        ..EnvTestConfig::default()
    })
}

fn fuzz_setup() -> (
    Env,
    PaymentChannelContractClient<'static>,
    Address,
    Address,
    Address,
    Address, // token address
) {
    let env = fuzz_env();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PaymentChannelContract);
    let client = PaymentChannelContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let depositor = Address::generate(&env);
    let counterparty = Address::generate(&env);

    // Register a real SEP-41 token and mint a generous balance.
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let asset_admin = StellarAssetClient::new(&env, &sac.address());
    asset_admin.mint(&depositor, &1_000_000_000_000i128);

    client.init(&admin);
    (env, client, depositor, counterparty, admin, sac.address())
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(8))]

    #[test]
    fn fuzz_open_channel_random_deposits(
        deposit in 1i128..=1_000_000_000i128,
        dispute_window in 1u64..=1_000_000u64,
    ) {
        let (env, client, depositor, counterparty, _admin, token) = fuzz_setup();
        let channel_id =
            client.open_channel(&depositor, &counterparty, &token, &deposit, &dispute_window);

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
        let (_env, client, depositor, counterparty, _admin, token) = fuzz_setup();
        let channel_id = client.open_channel(&depositor, &counterparty, &token, &initial, &100u64);

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
        let (_env, client, depositor, counterparty, _admin, token) = fuzz_setup();
        let channel_id = client.open_channel(&depositor, &counterparty, &token, &deposit, &100u64);

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
        let (_env, client, depositor, counterparty, _admin, token) = fuzz_setup();
        let channel_id = client.open_channel(&depositor, &counterparty, &token, &deposit, &100u64);

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
        let (_env, client, depositor, counterparty, _admin, token) = fuzz_setup();
        let channel_id = client.open_channel(&depositor, &counterparty, &token, &deposit, &100u64);

        let result = catch_unwind(AssertUnwindSafe(|| {
            client.top_up(&channel_id, &top_up_amount, &counterparty);
        }));
        prop_assert!(result.is_err(), "unauthorized top-up must be rejected");

        let channel = client.get_channel(&channel_id).unwrap();
        prop_assert_eq!(channel.balance_a, deposit);
    }

    #[test]
    fn fuzz_invalid_deposit_amounts_rejected(amount in -1_000_000i128..=0i128) {
        let (_env, client, depositor, counterparty, _admin, token) = fuzz_setup();
        let result = catch_unwind(AssertUnwindSafe(|| {
            client.open_channel(&depositor, &counterparty, &token, &amount, &100u64);
        }));
        prop_assert!(result.is_err(), "invalid deposit amount must be rejected");
    }

    #[test]
    fn fuzz_close_state_transitions(
        deposit in 100i128..=1_000_000i128,
        balance_b in 0i128..=100i128,
    ) {
        let (env, client, depositor, counterparty, _admin, token) = fuzz_setup();
        let balance_b = balance_b.min(deposit);
        let balance_a = deposit - balance_b;

        let channel_id = client.open_channel(&depositor, &counterparty, &token, &deposit, &1u64);

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
        client.finalize(&channel_id, &closing.sequence);

        let closed = client.get_channel(&channel_id).unwrap();
        prop_assert_eq!(closed.state, ChannelState::Closed);
        prop_assert_eq!(
            closed.balance_a.saturating_add(closed.balance_b),
            deposit
        );
    }

    #[test]
    fn fuzz_finalize_sequence_mismatch_rejected(
        deposit in 100i128..=1_000_000i128,
        balance_b in 0i128..=100i128,
        wrong_seq in 0u64..=100u64,
    ) {
        let (env, client, depositor, counterparty, _admin, token) = fuzz_setup();
        let balance_b = balance_b.min(deposit);
        let balance_a = deposit - balance_b;

        let channel_id =
            client.open_channel(&depositor, &counterparty, &token, &deposit, &1u64);
        client.initiate_close(&channel_id, &balance_a, &balance_b, &5u64, &depositor);

        let closing = client.get_channel(&channel_id).unwrap();
        env.ledger().set_timestamp(closing.dispute_deadline + 1);

        if wrong_seq != 5 {
            let result = catch_unwind(AssertUnwindSafe(|| {
                client.finalize(&channel_id, &wrong_seq);
            }));
            prop_assert!(result.is_err(), "finalize with wrong sequence must be rejected");
        } else {
            client.finalize(&channel_id, &5);
            let closed = client.get_channel(&channel_id).unwrap();
            prop_assert_eq!(closed.state, ChannelState::Closed);
        }
    }

    #[test]
    fn fuzz_finalize_before_window_rejected(
        deposit in 100i128..=1_000_000i128,
        balance_b in 0i128..=100i128,
        time_offset in 0u64..=100u64,
    ) {
        let (env, client, depositor, counterparty, _admin, token) = fuzz_setup();
        let balance_b = balance_b.min(deposit);
        let balance_a = deposit - balance_b;

        let channel_id =
            client.open_channel(&depositor, &counterparty, &token, &deposit, &100u64);
        client.initiate_close(&channel_id, &balance_a, &balance_b, &1u64, &depositor);

        let closing = client.get_channel(&channel_id).unwrap();
        env.ledger().set_timestamp(closing.dispute_deadline.saturating_sub(time_offset));

        if time_offset < 100 {
            let result = catch_unwind(AssertUnwindSafe(|| {
                client.finalize(&channel_id, &1);
            }));
            prop_assert!(result.is_err(), "finalize before window must be rejected");
        } else {
            client.finalize(&channel_id, &1);
            let closed = client.get_channel(&channel_id).unwrap();
            prop_assert_eq!(closed.state, ChannelState::Closed);
        }
    }

    #[test]
    fn fuzz_dispute_stale_sequence_rejected(
        deposit in 100i128..=1_000_000i128,
        close_seq in 1u64..=100u64,
        dispute_seq in 0u64..=100u64,
    ) {
        let (_env, client, depositor, counterparty, _admin, token) = fuzz_setup();
        let channel_id =
            client.open_channel(&depositor, &counterparty, &token, &deposit, &100u64);
        client.initiate_close(&channel_id, &deposit, &0i128, &close_seq, &depositor);

        if dispute_seq <= close_seq {
            let result = catch_unwind(AssertUnwindSafe(|| {
                client.dispute(&channel_id, &deposit, &0i128, &dispute_seq, &depositor, &counterparty);
            }));
            prop_assert!(result.is_err(), "dispute with stale sequence must be rejected");
        } else {
            client.dispute(&channel_id, &deposit, &0i128, &dispute_seq, &depositor, &counterparty);
            let channel = client.get_channel(&channel_id).unwrap();
            prop_assert_eq!(channel.state, ChannelState::Dispute);
        }
    }

    #[test]
    fn fuzz_initiate_close_stale_sequence_rejected(
        deposit in 100i128..=1_000_000i128,
        state_seq in 1u64..=100u64,
        close_seq in 0u64..=100u64,
    ) {
        let (_env, client, depositor, counterparty, _admin, token) = fuzz_setup();
        let channel_id =
            client.open_channel(&depositor, &counterparty, &token, &deposit, &100u64);
        client.submit_state(&channel_id, &deposit, &0i128, &state_seq, &depositor, &counterparty);

        if close_seq <= state_seq {
            let result = catch_unwind(AssertUnwindSafe(|| {
                client.initiate_close(&channel_id, &deposit, &0i128, &close_seq, &depositor);
            }));
            prop_assert!(result.is_err(), "initiate_close with stale sequence must be rejected");
        } else {
            client.initiate_close(&channel_id, &deposit, &0i128, &close_seq, &depositor);
            let channel = client.get_channel(&channel_id).unwrap();
            prop_assert_eq!(channel.state, ChannelState::Closing);
        }
    }

    #[test]
    fn fuzz_top_up_during_close_rejected(
        deposit in 100i128..=1_000_000i128,
        top_up in 1i128..=100_000i128,
    ) {
        let (_env, client, depositor, counterparty, _admin, token) = fuzz_setup();
        let channel_id =
            client.open_channel(&depositor, &counterparty, &token, &deposit, &100u64);
        client.initiate_close(&channel_id, &deposit, &0i128, &1u64, &depositor);

        let result = catch_unwind(AssertUnwindSafe(|| {
            client.top_up(&channel_id, &top_up, &depositor);
        }));
        prop_assert!(result.is_err(), "top_up during close must be rejected");

        let channel = client.get_channel(&channel_id).unwrap();
        prop_assert_eq!(channel.balance_a, deposit);
    }

    #[test]
    fn fuzz_top_up_during_dispute_rejected(
        deposit in 100i128..=1_000_000i128,
        top_up in 1i128..=100_000i128,
    ) {
        let (_env, client, depositor, counterparty, _admin, token) = fuzz_setup();
        let channel_id =
            client.open_channel(&depositor, &counterparty, &token, &deposit, &100u64);
        client.initiate_close(&channel_id, &deposit, &0i128, &1u64, &depositor);
        client.dispute(&channel_id, &deposit, &0i128, &2u64, &depositor, &counterparty);

        let result = catch_unwind(AssertUnwindSafe(|| {
            client.top_up(&channel_id, &top_up, &depositor);
        }));
        prop_assert!(result.is_err(), "top_up during dispute must be rejected");

        let channel = client.get_channel(&channel_id).unwrap();
        prop_assert_eq!(channel.balance_a, deposit);
    }

    #[test]
    fn fuzz_dispute_after_window_rejected(
        deposit in 100i128..=1_000_000i128,
        dispute_window in 1u64..=100u64,
        time_offset in 0u64..=200u64,
    ) {
        let (env, client, depositor, counterparty, _admin, token) = fuzz_setup();
        let channel_id =
            client.open_channel(&depositor, &counterparty, &token, &deposit, &dispute_window);
        client.initiate_close(&channel_id, &deposit, &0i128, &1u64, &depositor);

        let closing = client.get_channel(&channel_id).unwrap();
        env.ledger().set_timestamp(closing.dispute_deadline + time_offset);

        if time_offset > 0 {
            let result = catch_unwind(AssertUnwindSafe(|| {
                client.dispute(&channel_id, &deposit, &0i128, &2u64, &depositor, &counterparty);
            }));
            prop_assert!(result.is_err(), "dispute after window must be rejected");
        } else {
            client.dispute(&channel_id, &deposit, &0i128, &2u64, &depositor, &counterparty);
            let channel = client.get_channel(&channel_id).unwrap();
            prop_assert_eq!(channel.state, ChannelState::Dispute);
        }
    }

    /// Issue #1431: over a generated mix of `top_up` and `submit_state`, the
    /// two balances must always sum to what has been deposited, and neither may
    /// go negative. Asserted after every step, not just at the end.
    #[test]
    fn fuzz_operation_sequence_conserves_balance(
        initial in 100i128..=1_000_000i128,
        ops in prop::collection::vec((0u8..=1u8, 1i128..=50_000i128), 1..=8),
    ) {
        let (_env, client, depositor, counterparty, _admin, token) = fuzz_setup();
        let channel_id = client.open_channel(&depositor, &counterparty, &token, &initial, &100u64);

        let mut deposited = initial;
        let mut sequence = 0u64;

        for (kind, amount) in &ops {
            if *kind == 0 {
                client.top_up(&channel_id, amount, &depositor);
                deposited = deposited.saturating_add(*amount);
            } else {
                // Move part of the pot to B without changing the total.
                let to_b = (*amount).min(deposited);
                sequence += 1;
                client.submit_state(
                    &channel_id,
                    &(deposited - to_b),
                    &to_b,
                    &sequence,
                    &depositor,
                    &counterparty,
                );
            }

            let channel = client.get_channel(&channel_id).unwrap();
            prop_assert!(channel.balance_a >= 0, "balance_a went negative");
            prop_assert!(channel.balance_b >= 0, "balance_b went negative");
            prop_assert_eq!(
                channel.balance_a.saturating_add(channel.balance_b),
                deposited,
                "balances stopped summing to the deposited total"
            );
        }
    }

    /// Issue #1431: finalize must pay out the highest sequence submitted before
    /// the window closed, not the first or the last attempted.
    #[test]
    fn fuzz_finalize_pays_highest_submitted_sequence(
        deposit in 100i128..=1_000_000i128,
        splits in prop::collection::vec(0i128..=100i128, 2..=6),
    ) {
        let (env, client, depositor, counterparty, _admin, token) = fuzz_setup();
        let channel_id = client.open_channel(&depositor, &counterparty, &token, &deposit, &100u64);

        let mut last = (deposit, 0i128, 0u64);
        for (i, split) in splits.iter().enumerate() {
            let to_b = (*split).min(deposit);
            let sequence = (i as u64) + 1;
            client.submit_state(
                &channel_id,
                &(deposit - to_b),
                &to_b,
                &sequence,
                &depositor,
                &counterparty,
            );
            last = (deposit - to_b, to_b, sequence);
        }

        client.initiate_close(&channel_id, &last.2, &depositor);
        env.ledger().set_timestamp(env.ledger().timestamp() + 1_000);
        client.finalize(&channel_id, &last.2);

        let channel = client.get_channel(&channel_id).unwrap();
        prop_assert_eq!(channel.sequence, last.2);
        prop_assert_eq!(channel.balance_a, last.0);
        prop_assert_eq!(channel.balance_b, last.1);
    }
}
