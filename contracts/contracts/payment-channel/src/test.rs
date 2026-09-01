#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Env,
};

// ── Test helpers ──────────────────────────────────────────────────────────────

fn setup() -> (Env, Address, Address, Address, Address, TokenClient<'static>) {
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

    let channel_id =
        client.open_channel(&depositor, &counterparty, &token, &deposit, &10);

    // Depositor balance should have decreased by `deposit`.
    assert_eq!(
        token_client.balance(&depositor),
        depositor_before - deposit
    );

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

    let channel_id =
        client.open_channel(&depositor, &counterparty, &token, &100, &100);
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

    let channel_id =
        client.open_channel(&depositor, &counterparty, &token, &100, &1);
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

    let channel_id =
        client.open_channel(&depositor, &counterparty, &token, &100, &100);
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

    let channel_id =
        client.open_channel(&depositor, &counterparty, &token, &100, &100);
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

    let channel_id =
        client.open_channel(&depositor, &counterparty, &token, &100, &100);
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

    let channel_id =
        client.open_channel(&depositor, &counterparty, &token, &100, &100);
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

    let channel_id =
        client.open_channel(&depositor, &counterparty, &token, &100, &100);
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

    let channel_id =
        client.open_channel(&depositor, &counterparty, &token, &100, &100);
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

    let channel_id =
        client.open_channel(&depositor, &counterparty, &token, &100, &100);
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

    let channel_id =
        client.open_channel(&depositor, &counterparty, &token, &100, &10);
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

    let channel_id =
        client.open_channel(&depositor, &counterparty, &token, &200, &10);
    client.initiate_close(&channel_id, &120, &80, &1, &depositor);

    let depositor_before = token_client.balance(&depositor);
    let counterparty_before = token_client.balance(&counterparty);

    let channel = client.get_channel(&channel_id).unwrap();
    env.ledger().set_timestamp(channel.dispute_deadline + 1);

    client.finalize(&channel_id, &1);

    assert_eq!(token_client.balance(&depositor), depositor_before + 120);
    assert_eq!(token_client.balance(&counterparty), counterparty_before + 80);

    let closed = client.get_channel(&channel_id).unwrap();
    assert_eq!(closed.state, ChannelState::Closed);
}

#[test]
fn finalize_cannot_be_called_twice() {
    let (env, _admin, depositor, counterparty, token, _token_client) = setup();
    let client = register_contract(&env);

    let channel_id =
        client.open_channel(&depositor, &counterparty, &token, &100, &5);
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

    let channel_id =
        client.open_channel(&depositor, &counterparty, &token, &300, &10);
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

    let channel_id =
        client.open_channel(&depositor, &counterparty, &token, &100, &1000);
    client.initiate_close(&channel_id, &100, &0, &1, &depositor);

    let result = client.try_finalize(&channel_id, &1);
    assert_eq!(result, Err(Ok(Error::DisputeWindowActive)));
}

#[test]
fn finalize_open_channel_is_rejected() {
    let (env, _admin, depositor, counterparty, token, _token_client) = setup();
    let client = register_contract(&env);

    let channel_id =
        client.open_channel(&depositor, &counterparty, &token, &100, &10);

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
        env.storage().instance().set(&DataKey::ChannelCount, &u64::MAX);
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
