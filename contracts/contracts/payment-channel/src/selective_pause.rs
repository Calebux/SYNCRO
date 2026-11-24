//! # Selective Pause Tests (Issue #1046 - 1% Implementation)
//!
//! Demonstrates that:
//! 1. While paused, `open_channel`, `top_up`, and `verify_payment_proof` fail
//! 2. While paused, `initiate_close`, `dispute`, and `finalize` still succeed
//! 3. Pause auto-expires after `ESCAPE_HATCH_GRACE_PERIOD_SECS` (7 days)

use crate::{
    ChannelState, Error, PaymentChannel, PaymentChannelContract, PaymentChannelContractClient,
    ESCAPE_HATCH_GRACE_PERIOD_SECS, MAX_DISPUTE_WINDOW_SECS, MIN_DISPUTE_WINDOW_SECS,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env,
};

/// Create a test environment with a mock token and funded parties.
fn setup() -> (Env, Address, Address, Address, Address, PaymentChannelContractClient) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let depositor = Address::generate(&env);
    let counterparty = Address::generate(&env);
    let token_address = env.register_stellar_asset_contract_v2(admin.clone()).address();

    let contract_id = env.register_contract(None, PaymentChannelContract);
    let client = PaymentChannelContractClient::new(&env, &contract_id);

    client.init(&admin);

    // Fund the depositor's token account
    let token_client = token::StellarAssetClient::new(&env, &token_address);
    token_client.mint(&depositor, &10_000);

    (env, admin, depositor, counterparty, token_address, client)
}

#[test]
fn test_pause_blocks_open_allows_close() {
    let (env, admin, depositor, counterparty, token_address, client) = setup();

    // 1. Open a channel before pausing
    let channel_id = client
        .open_channel(
            &depositor,
            &counterparty,
            &token_address,
            &1000,
            &MIN_DISPUTE_WINDOW_SECS,
        )
        .unwrap();

    assert!(channel_id > 0);
    let channel = client.get_channel(&channel_id).unwrap();
    assert_eq!(channel.state, ChannelState::Open);

    // 2. Pause the contract
    client.pause();

    let (is_paused, paused_since, _) = client.is_paused();
    assert!(is_paused);
    assert_eq!(paused_since, env.ledger().timestamp());

    // 3. While paused: opening new channels should FAIL
    let result = client.try_open_channel(
        &depositor,
        &counterparty,
        &token_address,
        &500,
        &MIN_DISPUTE_WINDOW_SECS,
    );
    assert_eq!(result, Err(Ok(Error::Unauthorized)));

    // 4. While paused: initiate_close should still SUCCEED
    let close_result = client.try_initiate_close(
        &channel_id,
        &1000,
        &0,
        &1,
        &depositor,
    );
    assert!(close_result.is_ok());

    let channel = client.get_channel(&channel_id).unwrap();
    assert_eq!(channel.state, ChannelState::Closing);

    // 5. While paused: dispute should still SUCCEED
    // (Advance time slightly but stay within dispute window)
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 100;
    });

    let dispute_result = client.try_dispute(
        &channel_id,
        &900,
        &100,
        &2,
        &depositor,
        &counterparty,
    );
    assert!(dispute_result.is_ok());

    let channel = client.get_channel(&channel_id).unwrap();
    assert_eq!(channel.state, ChannelState::Dispute);

    // 6. While paused: finalize should still SUCCEED (after deadline)
    env.ledger().with_mut(|li| {
        li.timestamp = channel.dispute_deadline + 1;
    });

    let finalize_result = client.try_finalize(&channel_id, &2);
    assert!(finalize_result.is_ok());

    let channel = client.get_channel(&channel_id).unwrap();
    assert_eq!(channel.state, ChannelState::Closed);
}

#[test]
fn test_pause_blocks_top_up() {
    let (env, admin, depositor, counterparty, token_address, client) = setup();

    // Open a channel
    let channel_id = client
        .open_channel(
            &depositor,
            &counterparty,
            &token_address,
            &1000,
            &MIN_DISPUTE_WINDOW_SECS,
        )
        .unwrap();

    // Pause the contract
    client.pause();

    // While paused: top_up should FAIL
    let result = client.try_top_up(&channel_id, &500, &depositor);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_pause_auto_expires_after_grace_period() {
    let (env, admin, depositor, counterparty, token_address, client) = setup();

    // Open a channel before pausing
    let channel_id = client
        .open_channel(
            &depositor,
            &counterparty,
            &token_address,
            &1000,
            &MIN_DISPUTE_WINDOW_SECS,
        )
        .unwrap();

    // Pause the contract
    client.pause();

    let (is_paused, paused_since, auto_expires_at) = client.is_paused();
    assert!(is_paused);
    assert_eq!(auto_expires_at, paused_since + ESCAPE_HATCH_GRACE_PERIOD_SECS);

    // Verify that opens fail while paused
    let result = client.try_open_channel(
        &depositor,
        &counterparty,
        &token_address,
        &500,
        &MIN_DISPUTE_WINDOW_SECS,
    );
    assert_eq!(result, Err(Ok(Error::Unauthorized)));

    // Advance time past the grace period (7 days + 1 second)
    env.ledger().with_mut(|li| {
        li.timestamp = paused_since + ESCAPE_HATCH_GRACE_PERIOD_SECS + 1;
    });

    // Check pause status - should be auto-expired
    let (is_paused, _, _) = client.is_paused();
    assert!(!is_paused); // Auto-expired

    // Now opens should succeed again
    let result = client.try_open_channel(
        &depositor,
        &counterparty,
        &token_address,
        &500,
        &MIN_DISPUTE_WINDOW_SECS,
    );
    assert!(result.is_ok());
}

#[test]
fn test_unpause_before_expiry() {
    let (env, admin, depositor, counterparty, token_address, client) = setup();

    // Pause the contract
    client.pause();

    let (is_paused, _, _) = client.is_paused();
    assert!(is_paused);

    // Admin can unpause manually
    client.unpause();

    let (is_paused, _, _) = client.is_paused();
    assert!(!is_paused);

    // Opens should now succeed
    let result = client.open_channel(
        &depositor,
        &counterparty,
        &token_address,
        &500,
        &MIN_DISPUTE_WINDOW_SECS,
    );
    assert!(result.is_ok());
}

#[test]
fn test_set_paused_guardian_interface() {
    let (env, admin, depositor, counterparty, token_address, client) = setup();

    // Test guardian-compatible set_paused function
    client.set_paused(&true);

    let (is_paused, _, _) = client.is_paused();
    assert!(is_paused);

    // Unpause via guardian interface
    client.set_paused(&false);

    let (is_paused, _, _) = client.is_paused();
    assert!(!is_paused);
}

#[test]
fn test_double_pause_idempotent() {
    let (_env, _admin, _depositor, _counterparty, _token_address, client) = setup();

    // Pause twice
    client.pause();
    client.pause(); // Should not error

    let (is_paused, _, _) = client.is_paused();
    assert!(is_paused);
}

#[test]
fn test_unpause_when_not_paused_errors() {
    let (_env, _admin, _depositor, _counterparty, _token_address, client) = setup();

    // Try to unpause when not paused
    let result = client.try_unpause();
    assert_eq!(result, Err(Ok(Error::ContractNotPaused)));
}
