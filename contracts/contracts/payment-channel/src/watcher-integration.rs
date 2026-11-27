#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Env,
};

/// Integration test: watcher disputes a stale close automatically.
///
/// Issue #1650 — verifies that the watcher would correctly dispute a stale
/// close by submitting the latest signed state before the dispute window ends.
///
/// This test simulates the watcher's behaviour:
/// 1. Open a channel with a short dispute window (60 s).
/// 2. Submit states 1..5 (increasing sequence numbers).
/// 3. Counterparty calls `initiate_close` with the stale state 2.
/// 4. The watcher (simulated here by a direct `dispute` call) submits
///    the latest state 5 to contest the stale close.
/// 5. After the dispute window elapses, `finalize` is called with
///    sequence 5.
/// 6. Final balances match state 5 (balance_a=600, balance_b=400).
#[test]
fn watcher_disputes_stale_close_automatically() {
    let (env, _admin, depositor, counterparty, token, token_client) = setup();
    let client = register_contract(&env);

    // Use a short dispute window so the test runs quickly.
    let dispute_window = 60u64;
    let deposit = 1_000i128;

    let channel_id = client.open_channel(
        &depositor,
        &counterparty,
        &token,
        &deposit,
        &dispute_window,
    );

    // ── Submit states 1..5 ──────────────────────────
    // State 1: balance_a=1000, balance_b=0
    // State 2: balance_a=900,  balance_b=100
    // State 3: balance_a=800,  balance_b=200
    // State 4: balance_a=700,  balance_b=300
    // State 5: balance_a=600,  balance_b=400
    let states = [
        (1i128, 0i128),
        (900i128, 100i128),
        (800i128, 200i128),
        (700i128, 300i128),
        (600i128, 400i128),
    ];

    for (seq, &(balance_a, balance_b)) in states.iter().enumerate() {
        client.submit_state(
            &channel_id,
            &balance_a,
            &balance_b,
            &((seq + 1) as u64),
            &depositor,
            &counterparty,
        );
    }

    // ── Counterparty initiates close with stale state 2 ─────
    // State 2: balance_a=900, balance_b=100, sequence=2
    client.initiate_close(&channel_id, &900, &100, &2, &counterparty);

    let channel = client.get_channel(&channel_id).unwrap();
    assert_eq!(channel.state, ChannelState::Closing);
    assert_eq!(channel.sequence, 2);

    // ── Watcher disputes with the latest state (state 5) ────
    // State 5: balance_a=600, balance_b=400, sequence=5
    client.dispute(&channel_id, &600, &400, &5, &depositor, &counterparty);

    let channel = client.get_channel(&channel_id).unwrap();
    assert_eq!(channel.state, ChannelState::Dispute);
    assert_eq!(channel.sequence, 5);
    assert_eq!(channel.balance_a, 600);
    assert_eq!(channel.balance_b, 400);

    // ── Wait for the dispute window to pass ─────────────────
    env.ledger().set_timestamp(channel.dispute_deadline + 1);

    // ── Finalize with sequence 5 ────────────────────────────
    client.finalize(&channel_id, &5);

    let channel = client.get_channel(&channel_id).unwrap();
    assert_eq!(channel.state, ChannelState::Closed);
    assert_eq!(channel.sequence, 5);

    // ── Verify final balances match state 5 ─────────────────
    let depositor_balance = token_client.balance(&depositor);
    let counterparty_balance = token_client.balance(&counterparty);

    // Depositor started with 1_000_000_000, deposited 1_000.
    // After state 5: depositor gets balance_a=600 back.
    // Counterparty gets balance_b=400.
    assert_eq!(depositor_balance, 1_000_000_000 - 1_000 + 600);
    assert_eq!(counterparty_balance, 400);
}
