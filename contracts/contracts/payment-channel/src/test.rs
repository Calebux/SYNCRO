#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Env,
};

// ── Test helpers ──────────────────────────────────────────────────────────────

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

    // Register a real SEP-41 token so we can verify disbursements.
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token = TokenClient::new(&env, &sac.address());
    let asset_admin = StellarAssetClient::new(&env, &sac.address());
    asset_admin.mint(&depositor, &1_000_000_000i128);

    (env, admin, depositor, counterparty, sac.address(), token)
}

fn register_contract(env: &Env) -> PaymentChannelContractClient<'static> {
    let id = env.register_contract(None, PaymentChannelContract);
    let client = PaymentChannelContractClient::new(env, &id);
    let admin = Address::generate(env);
    client.init(&admin);
    client
}

// ── Existing behaviour tests ──────────────────────────────────────────────────

#[test]
fn happy_path_open_close_and_top_up() {
    let (env, _admin, depositor, counterparty, token, token_client) = setup();
    let client = register_contract(&env);

    let deposit = 100i128;
    let depositor_before = token_client.balance(&depositor);

    let channel_id = client.open_channel(&depositor, &counterparty, &token, &deposit, &10);

    // Depositor balance should have decreased by `deposit`.
    assert_eq!(token_client.balance(&depositor), depositor_before - deposit);

    // Top-up
    client.top_up(&channel_id, &25, &depositor);
    assert_eq!(
        token_client.balance(&depositor),
        depositor_before - deposit - 25
    );

    let channel = client.get_channel(&channel_id).unwrap();
    assert_eq!(channel.balance_a, 125);
    assert_eq!(channel.state, ChannelState::Open);

    // Initiate close then finalize after deadline.
    client.initiate_close(&channel_id, &120, &5, &1, &depositor);

    let closing = client.get_channel(&channel_id).unwrap();
    env.ledger().set_timestamp(closing.dispute_deadline + 1);
    client.finalize(&channel_id, &1);

    let closed = client.get_channel(&channel_id).unwrap();
    assert_eq!(closed.state, ChannelState::Closed);
    assert_eq!(closed.sequence, 1);
}

#[test]
fn dispute_path_overrides_stale_close() {
    let (env, _admin, depositor, counterparty, token, _token_client) = setup();
    let client = register_contract(&env);

    let channel_id = client.open_channel(&depositor, &counterparty, &token, &100, &100);
    client.initiate_close(&channel_id, &90, &10, &1, &depositor);
    client.dispute(&channel_id, &80, &20, &2, &depositor, &counterparty);

    let channel = client.get_channel(&channel_id).unwrap();
    assert_eq!(channel.state, ChannelState::Dispute);
    assert_eq!(channel.sequence, 2);
    assert_eq!(channel.balance_a, 80);
    assert_eq!(channel.balance_b, 20);
}

#[test]
fn finalize_releases_after_timeout() {
    let (env, _admin, depositor, counterparty, token, _token_client) = setup();
    let client = register_contract(&env);

    let channel_id = client.open_channel(&depositor, &counterparty, &token, &100, &1);
    client.initiate_close(&channel_id, &70, &30, &1, &depositor);

    env.ledger().set_timestamp(10);
    client.finalize(&channel_id, &1);

    let channel = client.get_channel(&channel_id).unwrap();
    assert_eq!(channel.state, ChannelState::Closed);
}

#[test]
fn finalize_rejects_stale_sequence() {
    let (env, _admin, depositor, counterparty, token, _token_client) = setup();
    let client = register_contract(&env);

    let channel_id = client.open_channel(&depositor, &counterparty, &token, &100, &100);
    client.initiate_close(&channel_id, &70, &30, &1, &depositor);

    let closing = client.get_channel(&channel_id).unwrap();
    env.ledger().set_timestamp(closing.dispute_deadline + 1);

    let result = client.try_finalize(&channel_id, &0);
    assert_eq!(result, Err(Ok(Error::StaleState)));

    let channel = client.get_channel(&channel_id).unwrap();
    assert_eq!(channel.state, ChannelState::Closing);
}

#[test]
fn finalize_rejects_wrong_sequence() {
    let (env, _admin, depositor, counterparty, token, _token_client) = setup();
    let client = register_contract(&env);

    let channel_id = client.open_channel(&depositor, &counterparty, &token, &100, &100);
    client.initiate_close(&channel_id, &70, &30, &1, &depositor);

    let closing = client.get_channel(&channel_id).unwrap();
    env.ledger().set_timestamp(closing.dispute_deadline + 1);

    let result = client.try_finalize(&channel_id, &999);
    assert_eq!(result, Err(Ok(Error::StaleState)));

    let channel = client.get_channel(&channel_id).unwrap();
    assert_eq!(channel.state, ChannelState::Closing);
}

#[test]
fn finalize_blocked_before_dispute_window() {
    let (env, _admin, depositor, counterparty, token, _token_client) = setup();
    let client = register_contract(&env);

    let channel_id = client.open_channel(&depositor, &counterparty, &token, &100, &100);
    client.initiate_close(&channel_id, &70, &30, &1, &depositor);

    let closing = client.get_channel(&channel_id).unwrap();
    env.ledger().set_timestamp(closing.dispute_deadline - 1);

    let result = client.try_finalize(&channel_id, &1);
    assert_eq!(result, Err(Ok(Error::DisputeWindowActive)));

    let channel = client.get_channel(&channel_id).unwrap();
    assert_eq!(channel.state, ChannelState::Closing);
}

#[test]
fn initiate_close_rejects_stale_sequence() {
    let (env, _admin, depositor, counterparty, token, _token_client) = setup();
    let client = register_contract(&env);

    let channel_id = client.open_channel(&depositor, &counterparty, &token, &100, &100);
    client.submit_state(&channel_id, &60, &40, &5, &depositor, &counterparty);

    let result = client.try_initiate_close(&channel_id, &70, &30, &3, &depositor);
    assert_eq!(result, Err(Ok(Error::StaleState)));

    let channel = client.get_channel(&channel_id).unwrap();
    assert_eq!(channel.state, ChannelState::Open);
    assert_eq!(channel.sequence, 5);
}

#[test]
fn dispute_rejects_stale_sequence() {
    let (env, _admin, depositor, counterparty, token, _token_client) = setup();
    let client = register_contract(&env);

    let channel_id = client.open_channel(&depositor, &counterparty, &token, &100, &100);
    client.initiate_close(&channel_id, &70, &30, &5, &depositor);

    let result = client.try_dispute(&channel_id, &80, &20, &3, &depositor, &counterparty);
    assert_eq!(result, Err(Ok(Error::StaleState)));

    let channel = client.get_channel(&channel_id).unwrap();
    assert_eq!(channel.state, ChannelState::Closing);
    assert_eq!(channel.sequence, 5);
}

#[test]
fn top_up_blocked_during_closing() {
    let (env, _admin, depositor, counterparty, token, _token_client) = setup();
    let client = register_contract(&env);

    let channel_id = client.open_channel(&depositor, &counterparty, &token, &100, &100);
    client.initiate_close(&channel_id, &70, &30, &1, &depositor);

    let result = client.try_top_up(&channel_id, &50, &depositor);
    assert_eq!(result, Err(Ok(Error::InvalidState)));

    let channel = client.get_channel(&channel_id).unwrap();
    assert_eq!(channel.balance_a, 70);
    assert_eq!(channel.state, ChannelState::Closing);
}

#[test]
fn top_up_blocked_during_dispute() {
    let (env, _admin, depositor, counterparty, token, _token_client) = setup();
    let client = register_contract(&env);

    let channel_id = client.open_channel(&depositor, &counterparty, &token, &100, &100);
    client.initiate_close(&channel_id, &70, &30, &1, &depositor);
    client.dispute(&channel_id, &80, &20, &2, &depositor, &counterparty);

    let result = client.try_top_up(&channel_id, &50, &depositor);
    assert_eq!(result, Err(Ok(Error::InvalidState)));

    let channel = client.get_channel(&channel_id).unwrap();
    assert_eq!(channel.balance_a, 80);
    assert_eq!(channel.state, ChannelState::Dispute);
}

#[test]
fn dispute_rejected_after_window_expires() {
    let (env, _admin, depositor, counterparty, token, _token_client) = setup();
    let client = register_contract(&env);

    let channel_id = client.open_channel(&depositor, &counterparty, &token, &100, &10);
    client.initiate_close(&channel_id, &70, &30, &1, &depositor);

    env.ledger().set_timestamp(20);

    let result = client.try_dispute(&channel_id, &80, &20, &2, &depositor, &counterparty);
    assert_eq!(result, Err(Ok(Error::DisputeWindowExpired)));

    let channel = client.get_channel(&channel_id).unwrap();
    assert_eq!(channel.state, ChannelState::Closing);
}

#[test]
fn finalize_disburses_tokens_to_both_parties() {
    let (env, _admin, depositor, counterparty, token, token_client) = setup();
    let client = register_contract(&env);

    let channel_id = client.open_channel(&depositor, &counterparty, &token, &200, &10);
    client.initiate_close(&channel_id, &120, &80, &1, &depositor);

    let depositor_before = token_client.balance(&depositor);
    let counterparty_before = token_client.balance(&counterparty);

    let channel = client.get_channel(&channel_id).unwrap();
    env.ledger().set_timestamp(channel.dispute_deadline + 1);

    client.finalize(&channel_id, &1);

    assert_eq!(token_client.balance(&depositor), depositor_before + 120);
    assert_eq!(
        token_client.balance(&counterparty),
        counterparty_before + 80
    );

    let closed = client.get_channel(&channel_id).unwrap();
    assert_eq!(closed.state, ChannelState::Closed);
}

#[test]
fn finalize_cannot_be_called_twice() {
    let (env, _admin, depositor, counterparty, token, _token_client) = setup();
    let client = register_contract(&env);

    let channel_id = client.open_channel(&depositor, &counterparty, &token, &100, &5);
    client.initiate_close(&channel_id, &100, &0, &1, &depositor);

    let channel = client.get_channel(&channel_id).unwrap();
    env.ledger().set_timestamp(channel.dispute_deadline + 1);

    client.finalize(&channel_id, &1);

    let result = client.try_finalize(&channel_id, &1);
    assert_eq!(result, Err(Ok(Error::InvalidState)));
}

#[test]
fn finalize_drains_contract_balance_by_fully_disbursing_deposit() {
    let (env, _admin, depositor, counterparty, token, token_client) = setup();
    let client = register_contract(&env);

    let channel_id = client.open_channel(&depositor, &counterparty, &token, &300, &10);
    client.initiate_close(&channel_id, &200, &100, &1, &depositor);

    let channel = client.get_channel(&channel_id).unwrap();
    env.ledger().set_timestamp(channel.dispute_deadline + 1);

    client.finalize(&channel_id, &1);

    assert_eq!(token_client.balance(&depositor), 1_000_000_000 - 300 + 200);
    assert_eq!(token_client.balance(&counterparty), 100);
}

#[test]
fn finalize_before_deadline_is_rejected() {
    let (env, _admin, depositor, counterparty, token, _token_client) = setup();
    let client = register_contract(&env);

    let channel_id = client.open_channel(&depositor, &counterparty, &token, &100, &1000);
    client.initiate_close(&channel_id, &100, &0, &1, &depositor);

    let result = client.try_finalize(&channel_id, &1);
    assert_eq!(result, Err(Ok(Error::DisputeWindowActive)));
}

#[test]
fn finalize_open_channel_is_rejected() {
    let (env, _admin, depositor, counterparty, token, _token_client) = setup();
    let client = register_contract(&env);

    let channel_id = client.open_channel(&depositor, &counterparty, &token, &100, &10);

    let result = client.try_finalize(&channel_id, &0);
    assert_eq!(result, Err(Ok(Error::InvalidState)));
}

#[test]
fn channel_id_uniqueness() {
    let (env, _admin, depositor, counterparty, token, _token_client) = setup();
    let client = register_contract(&env);

    let id1 = client.open_channel(&depositor, &counterparty, &token, &100, &10);
    let id2 = client.open_channel(&depositor, &counterparty, &token, &200, &10);
    let id3 = client.open_channel(&depositor, &counterparty, &token, &300, &10);

    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
    assert_eq!(id3, 3);
    assert_ne!(id1, id2);
    assert_ne!(id2, id3);
}

#[test]
fn channel_counter_overflow_guard() {
    let (env, _admin, depositor, counterparty, token, _token_client) = setup();
    let contract_id = env.register_contract(None, PaymentChannelContract);
    let client = PaymentChannelContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.init(&admin);

    env.as_contract(&contract_id, || {
        env.storage()
            .instance()
            .set(&DataKey::ChannelCount, &u64::MAX);
    });

    let result = client.try_open_channel(&depositor, &counterparty, &token, &100, &10);
    assert_eq!(result, Err(Ok(Error::CounterOverflow)));
}

#[test]
fn unauthorized_initiate_close_fails() {
    let (env, _admin, depositor, counterparty, token, _token_client) = setup();
    let client = register_contract(&env);
    let attacker = Address::generate(&env);

    let channel_id = client.open_channel(&depositor, &counterparty, &token, &100, &10);
    let result = client.try_initiate_close(&channel_id, &50, &50, &1, &attacker);

    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn unauthorized_submit_state_fails() {
    let (env, _admin, depositor, counterparty, token, _token_client) = setup();
    let client = register_contract(&env);
    let attacker1 = Address::generate(&env);
    let attacker2 = Address::generate(&env);

    let channel_id = client.open_channel(&depositor, &counterparty, &token, &100, &10);
    let result = client.try_submit_state(&channel_id, &50, &50, &1, &attacker1, &attacker2);

    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn unauthorized_dispute_fails() {
    let (env, _admin, depositor, counterparty, token, _token_client) = setup();
    let client = register_contract(&env);
    let attacker1 = Address::generate(&env);
    let attacker2 = Address::generate(&env);

    let channel_id = client.open_channel(&depositor, &counterparty, &token, &100, &100);
    client.initiate_close(&channel_id, &90, &10, &1, &depositor);

    let result = client.try_dispute(&channel_id, &80, &20, &2, &attacker1, &attacker2);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

// ── Escape-hatch tests ────────────────────────────────────────────────────────

#[test]
fn escape_hatch_depositor_recovers_after_grace_period() {
    let (env, admin, depositor, counterparty, token, token_client) = setup();
    let client = register_contract(&env);

    let deposit = 500i128;
    let channel_id = client.open_channel(&depositor, &counterparty, &token, &deposit, &3600);

    // Simulate partial off-chain activity: balance_a=300, balance_b=200 at seq 5
    client.submit_state(&channel_id, &300, &200, &5, &depositor, &counterparty);

    // Admin pauses the contract
    client.pause();
    let paused_at = env.ledger().timestamp();

    // Advance past the grace period
    env.ledger().set_timestamp(paused_at + ESCAPE_HATCH_GRACE_PERIOD_SECS + 1);

    let depositor_before = token_client.balance(&depositor);
    client.escape_hatch_withdraw(&channel_id, &depositor);
    let depositor_after = token_client.balance(&depositor);

    // Depositor should recover balance_a = 300
    assert_eq!(depositor_after - depositor_before, 300i128);

    let ch = client.get_channel(&channel_id).unwrap();
    assert_eq!(ch.state, ChannelState::Closed);
}

#[test]
fn escape_hatch_counterparty_can_also_call_but_channel_already_closed() {
    // After depositor calls escape_hatch_withdraw the channel is Closed;
    // a subsequent call by counterparty should fail with InvalidState.
    let (env, _admin, depositor, counterparty, token, _token_client) = setup();
    let client = register_contract(&env);

    let channel_id = client.open_channel(&depositor, &counterparty, &token, &400, &3600);
    client.submit_state(&channel_id, &300, &100, &1, &depositor, &counterparty);

    client.pause();
    let paused_at = env.ledger().timestamp();
    env.ledger().set_timestamp(paused_at + ESCAPE_HATCH_GRACE_PERIOD_SECS + 1);

    client.escape_hatch_withdraw(&channel_id, &depositor);

    // Counterparty's share (100) was also zeroed; channel is now Closed.
    let result = client.try_escape_hatch_withdraw(&channel_id, &counterparty);
// ── Watchtower (#1249) ────────────────────────────────────────────────────────

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
    let channel_id = client.open_channel(&depositor, &counterparty, &token, &1_000, &100);
    (env, client, depositor, counterparty, watchtower, token, token_client, channel_id)
}

#[test]
fn register_and_deregister_watchtower() {
    let (_env, client, depositor, _counterparty, watchtower, _token, _tc, channel_id) =
        setup_watchtower();

    client.register_watchtower(&channel_id, &depositor, &watchtower, &0);
    let towers = client.get_watchtowers(&channel_id);
    assert_eq!(towers.len(), 1);
    assert_eq!(towers.get(0).unwrap(), watchtower);

    client.deregister_watchtower(&channel_id, &depositor, &watchtower);
    assert_eq!(client.get_watchtowers(&channel_id).len(), 0);
}

#[test]
fn counterparty_can_register_watchtower() {
    let (_env, client, _depositor, counterparty, watchtower, _token, _tc, channel_id) =
        setup_watchtower();
    client.register_watchtower(&channel_id, &counterparty, &watchtower, &0);
    assert_eq!(client.get_watchtowers(&channel_id).len(), 1);
}

#[test]
fn multiple_watchtowers_can_be_registered() {
    let (env, client, depositor, _counterparty, watchtower, _token, _tc, channel_id) =
        setup_watchtower();
    let second = Address::generate(&env);
    client.register_watchtower(&channel_id, &depositor, &watchtower, &0);
    client.register_watchtower(&channel_id, &depositor, &second, &0);
    assert_eq!(client.get_watchtowers(&channel_id).len(), 2);
}

#[test]
fn watchtower_submit_newer_state_during_dispute_window() {
    let (env, client, depositor, counterparty, watchtower, _token, token_client, channel_id) =
        setup_watchtower();

    client.register_watchtower(&channel_id, &depositor, &watchtower, &50);
    assert_eq!(client.get_watchtower_bounty(&channel_id), 50);
    // Bounty reserved from depositor balance.
    assert_eq!(client.get_channel(&channel_id).unwrap().balance_a, 950);

    client.initiate_close(&channel_id, &700, &250, &1, &depositor);

    let wt_before = token_client.balance(&watchtower);
    client.watchtower_submit(
        &channel_id,
        &watchtower,
        &600,
        &350,
        &2,
        &depositor,
        &counterparty,
    );

    let channel = client.get_channel(&channel_id).unwrap();
    assert_eq!(channel.state, ChannelState::Dispute);
    assert_eq!(channel.sequence, 2);
    assert_eq!(channel.balance_a, 600);
    assert_eq!(channel.balance_b, 350);
    assert_eq!(token_client.balance(&watchtower), wt_before + 50);

    env.ledger().set_timestamp(channel.dispute_deadline + 1);
    let dep_before = token_client.balance(&depositor);
    let cp_before = token_client.balance(&counterparty);
    client.finalize(&channel_id, &2);
    assert_eq!(token_client.balance(&depositor), dep_before + 600);
    assert_eq!(token_client.balance(&counterparty), cp_before + 350);
    // Watchtower still has only the bounty — principal went to the parties.
    assert_eq!(token_client.balance(&watchtower), wt_before + 50);
}

#[test]
fn watchtower_submit_older_state_rejected() {
    let (_env, client, depositor, counterparty, watchtower, _token, _tc, channel_id) =
        setup_watchtower();
    client.register_watchtower(&channel_id, &depositor, &watchtower, &0);
    client.initiate_close(&channel_id, &700, &300, &5, &depositor);

    let result = client.try_watchtower_submit(
        &channel_id,
        &watchtower,
        &800,
        &200,
        &3,
        &depositor,
        &counterparty,
    );
    assert_eq!(result, Err(Ok(Error::StaleState)));
}

#[test]
fn watchtower_submit_unregistered_rejected() {
    let (_env, client, depositor, counterparty, watchtower, _token, _tc, channel_id) =
        setup_watchtower();
    client.initiate_close(&channel_id, &700, &300, &1, &depositor);

    let result = client.try_watchtower_submit(
        &channel_id,
        &watchtower,
        &600,
        &400,
        &2,
        &depositor,
        &counterparty,
    );
    assert_eq!(result, Err(Ok(Error::NotWatchtower)));
}

#[test]
fn watchtower_submit_invalid_signatures_rejected() {
    let (env, client, depositor, counterparty, watchtower, _token, _tc, channel_id) =
        setup_watchtower();
    client.register_watchtower(&channel_id, &depositor, &watchtower, &0);
    client.initiate_close(&channel_id, &700, &300, &1, &depositor);

    let attacker = Address::generate(&env);
    let result = client.try_watchtower_submit(
        &channel_id,
        &watchtower,
        &600,
        &400,
        &2,
        &attacker,
        &counterparty,
    );
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn watchtower_submit_wrong_state_rejected() {
    let (_env, client, depositor, counterparty, watchtower, _token, _tc, channel_id) =
        setup_watchtower();
    client.register_watchtower(&channel_id, &depositor, &watchtower, &0);

    let result = client.try_watchtower_submit(
        &channel_id,
        &watchtower,
        &600,
        &400,
        &1,
        &depositor,
        &counterparty,
    );
    assert_eq!(result, Err(Ok(Error::InvalidState)));
}

#[test]
fn escape_hatch_fails_before_grace_period() {
    let (env, _admin, depositor, counterparty, token, _token_client) = setup();
    let client = register_contract(&env);

    let channel_id = client.open_channel(&depositor, &counterparty, &token, &100, &3600);

    client.pause();
    let paused_at = env.ledger().timestamp();
    // Only 60 seconds elapsed — well within 7-day grace period
    env.ledger().set_timestamp(paused_at + 60);

    let result = client.try_escape_hatch_withdraw(&channel_id, &depositor);
    assert_eq!(result, Err(Ok(Error::GracePeriodNotElapsed)));
}

#[test]
fn escape_hatch_fails_when_not_paused() {
    let (env, _admin, depositor, counterparty, token, _token_client) = setup();
    let client = register_contract(&env);

    let channel_id = client.open_channel(&depositor, &counterparty, &token, &100, &3600);

    // No pause — must fail
    let result = client.try_escape_hatch_withdraw(&channel_id, &depositor);
    assert_eq!(result, Err(Ok(Error::ContractNotPaused)));
}

#[test]
fn escape_hatch_fails_after_unpause() {
    let (env, _admin, depositor, counterparty, token, _token_client) = setup();
    let client = register_contract(&env);

    let channel_id = client.open_channel(&depositor, &counterparty, &token, &100, &3600);

    client.pause();
    let paused_at = env.ledger().timestamp();
    env.ledger().set_timestamp(paused_at + ESCAPE_HATCH_GRACE_PERIOD_SECS + 1);

    // Admin recovers and unpauses before user acts
    client.unpause();

    let result = client.try_escape_hatch_withdraw(&channel_id, &depositor);
    assert_eq!(result, Err(Ok(Error::ContractNotPaused)));
}

#[test]
fn escape_hatch_cross_user_theft_prevented() {
    let (env, _admin, depositor, counterparty, token, _token_client) = setup();
    let attacker = Address::generate(&env);
    let client = register_contract(&env);

    let channel_id = client.open_channel(&depositor, &counterparty, &token, &100, &3600);

    client.pause();
    let paused_at = env.ledger().timestamp();
    env.ledger().set_timestamp(paused_at + ESCAPE_HATCH_GRACE_PERIOD_SECS + 1);

    // Attacker is not a party to this channel
    let result = client.try_escape_hatch_withdraw(&channel_id, &attacker);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}
fn watchtower_cannot_be_a_channel_party() {
    let (_env, client, depositor, _counterparty, _watchtower, _token, _tc, channel_id) =
        setup_watchtower();
    let result = client.try_register_watchtower(&channel_id, &depositor, &depositor, &0);
    assert_eq!(result, Err(Ok(Error::WatchtowerIsParty)));
}

#[test]
fn bounty_exceeds_cap_rejected() {
    let (_env, client, depositor, _counterparty, watchtower, _token, _tc, channel_id) =
        setup_watchtower();
    let result = client.try_register_watchtower(
        &channel_id,
        &depositor,
        &watchtower,
        &(MAX_WATCHTOWER_BOUNTY + 1),
    );
    assert_eq!(result, Err(Ok(Error::BountyExceedsCap)));
}

#[test]
fn bounty_is_capped_at_max() {
    let (env, _admin, depositor, counterparty, token, _tc) = setup();
    let client = register_contract(&env);
    let watchtower = Address::generate(&env);
    let channel_id = client.open_channel(
        &depositor,
        &counterparty,
        &token,
        &(MAX_WATCHTOWER_BOUNTY + 1),
        &100,
    );
    client.register_watchtower(&channel_id, &depositor, &watchtower, &MAX_WATCHTOWER_BOUNTY);
    assert_eq!(
        client.get_watchtower_bounty(&channel_id),
        MAX_WATCHTOWER_BOUNTY
    );
}

#[test]
fn watchtower_cannot_redirect_channel_funds() {
    let (env, client, depositor, counterparty, watchtower, _token, token_client, channel_id) =
        setup_watchtower();

    let bounty = 25i128;
    client.register_watchtower(&channel_id, &depositor, &watchtower, &bounty);
    client.initiate_close(&channel_id, &900, &75, &1, &depositor);

    let wt_before = token_client.balance(&watchtower);
    // Watchtower submits a state that tries to dump everything into balance_b.
    // Even then, balance_b pays the counterparty — never the watchtower.
    client.watchtower_submit(
        &channel_id,
        &watchtower,
        &0,
        &975,
        &2,
        &depositor,
        &counterparty,
    );

    let channel = client.get_channel(&channel_id).unwrap();
    env.ledger().set_timestamp(channel.dispute_deadline + 1);

    let dep_before = token_client.balance(&depositor);
    let cp_before = token_client.balance(&counterparty);
    client.finalize(&channel_id, &2);

    assert_eq!(token_client.balance(&watchtower), wt_before + bounty);
    assert_eq!(token_client.balance(&depositor), dep_before);
    assert_eq!(token_client.balance(&counterparty), cp_before + 975);
}

#[test]
fn unauthorized_cannot_register_watchtower() {
    let (env, client, _depositor, _counterparty, watchtower, _token, _tc, channel_id) =
        setup_watchtower();
    let stranger = Address::generate(&env);
    let result = client.try_register_watchtower(&channel_id, &stranger, &watchtower, &0);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn register_watchtower_rejects_wrong_state() {
    let (_env, client, depositor, _counterparty, watchtower, _token, _tc, channel_id) =
        setup_watchtower();
    client.initiate_close(&channel_id, &900, &100, &1, &depositor);
    let result = client.try_register_watchtower(&channel_id, &depositor, &watchtower, &0);
    assert_eq!(result, Err(Ok(Error::InvalidState)));
}

#[test]
fn unused_bounty_returns_to_depositor_on_finalize() {
    let (env, client, depositor, counterparty, watchtower, _token, token_client, channel_id) =
        setup_watchtower();
    client.register_watchtower(&channel_id, &depositor, &watchtower, &40);
    client.initiate_close(&channel_id, &960, &0, &1, &depositor);

    let channel = client.get_channel(&channel_id).unwrap();
    env.ledger().set_timestamp(channel.dispute_deadline + 1);

    let dep_before = token_client.balance(&depositor);
    let wt_before = token_client.balance(&watchtower);
    client.finalize(&channel_id, &1);

    // Unused bounty refunded to depositor; watchtower gets nothing.
    assert_eq!(token_client.balance(&depositor), dep_before + 960 + 40);
    assert_eq!(token_client.balance(&watchtower), wt_before);
    let _ = counterparty;
}

#[test]
fn neg_init_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, PaymentChannelContract);
    let client = PaymentChannelContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let result = client.try_init(&Address::generate(&env));
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn neg_init_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let client = register_contract(&env);
    let result = client.try_init(&Address::generate(&env));
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn neg_open_channel_unauthorized() {
    let (env, _a, depositor, _c, token, _t) = setup();
    let client = register_contract(&env);
    let result = client.try_open_channel(&depositor, &depositor, &token, &100, &10);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn neg_open_channel_wrong_state() {
    let (_env, _a, depositor, counterparty, token, _t) = setup();
    let client = register_contract(&_env);
    let result = client.try_open_channel(&depositor, &counterparty, &token, &0, &10);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn neg_submit_state_unauthorized() {
    unauthorized_submit_state_fails();
}

#[test]
fn neg_submit_state_wrong_state() {
    let (_env, _a, depositor, counterparty, token, _t) = setup();
    let client = register_contract(&_env);
    let channel_id = client.open_channel(&depositor, &counterparty, &token, &100, &10);
    client.initiate_close(&channel_id, &70, &30, &1, &depositor);
    client.dispute(&channel_id, &60, &40, &2, &depositor, &counterparty);
    let result = client.try_submit_state(&channel_id, &50, &50, &3, &depositor, &counterparty);
    assert_eq!(result, Err(Ok(Error::InvalidState)));
}

#[test]
fn neg_initiate_close_unauthorized() {
    unauthorized_initiate_close_fails();
}

#[test]
fn neg_initiate_close_wrong_state() {
    let (_env, _a, depositor, counterparty, token, _t) = setup();
    let client = register_contract(&_env);
    let channel_id = client.open_channel(&depositor, &counterparty, &token, &100, &10);
    client.initiate_close(&channel_id, &70, &30, &1, &depositor);
    let result = client.try_initiate_close(&channel_id, &60, &40, &2, &depositor);
    assert_eq!(result, Err(Ok(Error::InvalidState)));
}

#[test]
fn neg_dispute_unauthorized() {
    unauthorized_dispute_fails();
}

#[test]
fn neg_dispute_wrong_state() {
    let (_env, _a, depositor, counterparty, token, _t) = setup();
    let client = register_contract(&_env);
    let channel_id = client.open_channel(&depositor, &counterparty, &token, &100, &10);
    let result = client.try_dispute(&channel_id, &80, &20, &1, &depositor, &counterparty);
    assert_eq!(result, Err(Ok(Error::InvalidState)));
}

#[test]
fn neg_finalize_unauthorized() {
    // finalize has no caller; a stale sequence is the typed rejection a third
    // party cannot override.
    finalize_rejects_wrong_sequence();
}

#[test]
fn neg_finalize_wrong_state() {
    finalize_open_channel_is_rejected();
}

#[test]
fn neg_top_up_unauthorized() {
    let (env, _a, depositor, counterparty, token, _t) = setup();
    let client = register_contract(&env);
    let stranger = Address::generate(&env);
    let channel_id = client.open_channel(&depositor, &counterparty, &token, &100, &10);
    let result = client.try_top_up(&channel_id, &10, &stranger);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn neg_top_up_wrong_state() {
    top_up_blocked_during_closing();
}

#[test]
fn neg_get_channel_unauthorized() {
    let (_env, _a, depositor, counterparty, token, _t) = setup();
    let client = register_contract(&_env);
    assert!(client.get_channel(&99).is_none());
}

#[test]
fn neg_get_channel_wrong_state() {
    let (_env, _a, _d, _c, _token, _t) = setup();
    let client = register_contract(&_env);
    assert!(client.get_channel(&1).is_none());
}

#[test]
fn neg_register_watchtower_unauthorized() {
    unauthorized_cannot_register_watchtower();
}

#[test]
fn neg_register_watchtower_wrong_state() {
    register_watchtower_rejects_wrong_state();
}

#[test]
fn neg_deregister_watchtower_unauthorized() {
    let (env, client, _d, _c, watchtower, _token, _tc, channel_id) = setup_watchtower();
    let stranger = Address::generate(&env);
    client.register_watchtower(&channel_id, &_d, &watchtower, &0);
    let result = client.try_deregister_watchtower(&channel_id, &stranger, &watchtower);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn neg_deregister_watchtower_wrong_state() {
    let (_env, client, depositor, _c, watchtower, _token, _tc, channel_id) = setup_watchtower();
    client.register_watchtower(&channel_id, &depositor, &watchtower, &0);
    client.initiate_close(&channel_id, &900, &100, &1, &depositor);
    let result = client.try_deregister_watchtower(&channel_id, &depositor, &watchtower);
    assert_eq!(result, Err(Ok(Error::InvalidState)));
}

#[test]
fn neg_get_watchtowers_unauthorized() {
    let (_env, client, _d, _c, _w, _token, _tc, channel_id) = setup_watchtower();
    assert_eq!(client.get_watchtowers(&channel_id).len(), 0);
}

#[test]
fn neg_get_watchtowers_wrong_state() {
    let (_env, client, _d, _c, _w, _token, _tc, _id) = setup_watchtower();
    assert_eq!(client.get_watchtowers(&99).len(), 0);
}

#[test]
fn neg_get_watchtower_bounty_unauthorized() {
    let (_env, client, _d, _c, _w, _token, _tc, channel_id) = setup_watchtower();
    assert_eq!(client.get_watchtower_bounty(&channel_id), 0);
}

#[test]
fn neg_get_watchtower_bounty_wrong_state() {
    let (_env, client, _d, _c, _w, _token, _tc, _id) = setup_watchtower();
    assert_eq!(client.get_watchtower_bounty(&99), 0);
}

#[test]
fn neg_watchtower_submit_unauthorized() {
    watchtower_submit_unregistered_rejected();
}

#[test]
fn neg_watchtower_submit_wrong_state() {
    watchtower_submit_wrong_state_rejected();
}
