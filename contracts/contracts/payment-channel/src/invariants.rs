//! State-machine invariant tests for the payment channel.
//!
//! See [`PAYMENT_CHANNEL_INVARIANTS.md`](../PAYMENT_CHANNEL_INVARIANTS.md) for
//! the full mapping of invariant IDs to these tests.

#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

/// Minimum valid dispute window (1 hour).
const W: u64 = MIN_DISPUTE_WINDOW_SECS;

fn setup() -> (
    Env,
    Address,
    Address,
    Address,
    Address,
    TokenClient<'static>,
) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let depositor = Address::generate(&env);
    let counterparty = Address::generate(&env);

    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token = TokenClient::new(&env, &sac.address());
    let asset_admin = StellarAssetClient::new(&env, &sac.address());
    asset_admin.mint(&depositor, &1_000_000_000i128);

    (env, admin, depositor, counterparty, sac.address(), token)
}

fn register_contract(env: &Env) -> PaymentChannelContractClient<'static> {
    let id = env.register(PaymentChannelContract, ());
    let client = PaymentChannelContractClient::new(env, &id);
    let admin = Address::generate(env);
    client.init(&admin);
    client
}

fn setup_watchtower() -> (
    Env,
    PaymentChannelContractClient<'static>,
    Address,
    Address,
    Address,
    Address,
    TokenClient<'static>,
    u64,
) {
    let (env, _admin, depositor, counterparty, token, token_client) = setup();
    let client = register_contract(&env);
    let watchtower = Address::generate(&env);
    let channel_id = client.open_channel(&depositor, &counterparty, &token, &1_000, &W);
    (
        env,
        client,
        depositor,
        counterparty,
        watchtower,
        token,
        token_client,
        channel_id,
    )
}

/// I-C1: escrow in equals party payouts on finalize; balances sum to deposits.
#[test]
fn invariant_funds_conserved_through_lifecycle() {
    let (env, _admin, depositor, counterparty, token, token_client) = setup();
    let client = register_contract(&env);
    let deposit = 200i128;
    let top_up = 50i128;
    let channel_id = client.open_channel(&depositor, &counterparty, &token, &deposit, &W);
    client.top_up(&channel_id, &top_up, &depositor);

    let deposited = deposit + top_up;
    let channel = client.get_channel(&channel_id).unwrap();
    assert_eq!(channel.balance_a + channel.balance_b, deposited);

    client.initiate_close(&channel_id, &180, &70, &1, &depositor);
    let closing = client.get_channel(&channel_id).unwrap();
    assert_eq!(closing.balance_a + closing.balance_b, deposited);

    let dep_before = token_client.balance(&depositor);
    let cp_before = token_client.balance(&counterparty);
    assert_eq!(token_client.balance(&client.address), deposited);

    env.ledger().set_timestamp(closing.dispute_deadline + 1);
    client.finalize(&channel_id, &1);

    assert_eq!(token_client.balance(&depositor), dep_before + 180);
    assert_eq!(token_client.balance(&counterparty), cp_before + 70);
    assert_eq!(token_client.balance(&client.address), 0);
}

/// I-N1: sequence / nonce is strictly monotonic across submit_state.
#[test]
fn invariant_sequence_strictly_monotonic() {
    let (env, _admin, depositor, counterparty, token, _token_client) = setup();
    let client = register_contract(&env);
    let channel_id = client.open_channel(&depositor, &counterparty, &token, &100, &W);

    client.submit_state(&channel_id, &70, &30, &1, &depositor, &counterparty);
    client.submit_state(&channel_id, &60, &40, &2, &depositor, &counterparty);

    let equal = client.try_submit_state(&channel_id, &55, &45, &2, &depositor, &counterparty);
    assert_eq!(equal, Err(Ok(Error::StaleState)));

    let stale = client.try_submit_state(&channel_id, &80, &20, &1, &depositor, &counterparty);
    assert_eq!(stale, Err(Ok(Error::StaleState)));

    let ch = client.get_channel(&channel_id).unwrap();
    assert_eq!(ch.sequence, 2);
    assert_eq!(ch.balance_a, 60);
}

/// I-X1: a channel can be finalized (closed) at most once.
#[test]
fn invariant_close_only_once() {
    let (env, _admin, depositor, counterparty, token, _token_client) = setup();
    let client = register_contract(&env);
    let channel_id = client.open_channel(&depositor, &counterparty, &token, &100, &W);

    client.initiate_close(&channel_id, &100, &0, &1, &depositor);
    let again_close = client.try_initiate_close(&channel_id, &90, &10, &2, &depositor);
    assert_eq!(again_close, Err(Ok(Error::InvalidState)));

    let channel = client.get_channel(&channel_id).unwrap();
    env.ledger().set_timestamp(channel.dispute_deadline + 1);
    client.finalize(&channel_id, &1);

    let again_finalize = client.try_finalize(&channel_id, &1);
    assert_eq!(again_finalize, Err(Ok(Error::InvalidState)));
    assert_eq!(
        client.get_channel(&channel_id).unwrap().state,
        ChannelState::Closed
    );
}

/// I-D1: dispute succeeds inside the window and fails after expiry.
#[test]
fn invariant_dispute_only_within_window() {
    let (env, _admin, depositor, counterparty, token, _token_client) = setup();
    let client = register_contract(&env);
    let channel_id = client.open_channel(&depositor, &counterparty, &token, &100, &W);
    client.initiate_close(&channel_id, &70, &30, &1, &depositor);

    client.dispute(&channel_id, &60, &40, &2, &depositor, &counterparty);
    assert_eq!(
        client.get_channel(&channel_id).unwrap().state,
        ChannelState::Dispute
    );

    let channel_id2 = client.open_channel(&depositor, &counterparty, &token, &100, &W);
    client.initiate_close(&channel_id2, &70, &30, &1, &depositor);
    let closing = client.get_channel(&channel_id2).unwrap();
    env.ledger().set_timestamp(closing.dispute_deadline + 1);
    let expired = client.try_dispute(&channel_id2, &60, &40, &2, &depositor, &counterparty);
    assert_eq!(expired, Err(Ok(Error::DisputeWindowExpired)));
}

/// I-B1: watchtower bounty is non-negative, ≤ MAX_WATCHTOWER_BOUNTY, and ≤ balance_a.
#[test]
fn invariant_watchtower_bounty_bounds() {
    let (env, _admin, depositor, counterparty, token, _tc) = setup();
    let client = register_contract(&env);
    let watchtower = Address::generate(&env);
    let channel_id = client.open_channel(&depositor, &counterparty, &token, &100, &W);

    let negative = client.try_register_watchtower(&channel_id, &depositor, &watchtower, &-1);
    assert_eq!(negative, Err(Ok(Error::InvalidBounty)));

    let over_cap = client.try_register_watchtower(
        &channel_id,
        &depositor,
        &watchtower,
        &(MAX_WATCHTOWER_BOUNTY + 1),
    );
    assert_eq!(over_cap, Err(Ok(Error::BountyExceedsCap)));

    let small = client.open_channel(&depositor, &counterparty, &token, &50, &W);
    let wt2 = Address::generate(&env);
    let over_balance = client.try_register_watchtower(&small, &depositor, &wt2, &51);
    assert_eq!(over_balance, Err(Ok(Error::InsufficientBalance)));

    let funded = client.open_channel(
        &depositor,
        &counterparty,
        &token,
        &(MAX_WATCHTOWER_BOUNTY + 1),
        &W,
    );
    let wt3 = Address::generate(&env);
    client.register_watchtower(&funded, &depositor, &wt3, &MAX_WATCHTOWER_BOUNTY);
    assert_eq!(client.get_watchtower_bounty(&funded), MAX_WATCHTOWER_BOUNTY);
}

/// I-D1 (watchtower path): submit after the dispute window expires is rejected.
#[test]
fn invariant_watchtower_submit_only_within_window() {
    let (env, client, depositor, counterparty, watchtower, _token, _tc, channel_id) =
        setup_watchtower();
    client.register_watchtower(&channel_id, &depositor, &watchtower, &0);
    client.initiate_close(&channel_id, &700, &300, &1, &depositor);

    let closing = client.get_channel(&channel_id).unwrap();
    env.ledger().set_timestamp(closing.dispute_deadline + 1);

    let result = client.try_watchtower_submit(
        &channel_id,
        &watchtower,
        &600,
        &400,
        &2,
        &depositor,
        &counterparty,
    );
    assert_eq!(result, Err(Ok(Error::DisputeWindowExpired)));
}
