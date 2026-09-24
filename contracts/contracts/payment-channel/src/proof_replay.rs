//! Payment-proof replay and binding tests.
//!
//! Every test here exercises one specific security invariant from the issue:
//!
//! | Test                                        | Invariant                                  |
//! |---------------------------------------------|--------------------------------------------|
//! | proof_happy_path                            | valid proof debits channel once            |
//! | proof_replay_same_request_rejected          | exact replay of a consumed proof rejected  |
//! | proof_cross_request_reuse_rejected          | same nonce, different request hash         |
//! | proof_expired_too_old_rejected              | timestamp older than freshness window      |
//! | proof_expired_too_new_rejected              | timestamp in the far future rejected       |
//! | proof_at_freshness_boundary_accepted        | proof exactly at edge of window accepted   |
//! | proof_invalid_request_hash_rejected         | empty request_hash rejected                |
//! | proof_invalid_amount_rejected               | zero / negative amount rejected            |
//! | proof_wrong_channel_rejected                | channel_id mismatch rejected               |
//! | proof_insufficient_balance_rejected         | amount exceeds depositor balance           |
//! | proof_unauthorized_payer_rejected           | non-depositor payer rejected               |
//! | proof_unauthorized_sigs_rejected            | wrong signatories rejected                 |
//! | proof_closed_channel_rejected               | proof against a closed channel rejected    |
//! | proof_nonce_unique_per_channel              | same nonce on different channels accepted  |
//! | is_nonce_used_helper                        | helper reflects consumed state             |

#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Bytes, Env,
};

// ── Test helpers ──────────────────────────────────────────────────────────────

fn setup_proof_env() -> (
    Env,
    PaymentChannelContractClient<'static>,
    Address, // depositor
    Address, // counterparty
    Address, // token
    TokenClient<'static>,
) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let depositor = Address::generate(&env);
    let counterparty = Address::generate(&env);

    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_client = TokenClient::new(&env, &sac.address());
    StellarAssetClient::new(&env, &sac.address()).mint(&depositor, &1_000_000i128);

    let contract_id = env.register_contract(None, PaymentChannelContract);
    let client = PaymentChannelContractClient::new(&env, &contract_id);
    client.init(&admin);

    (env, client, depositor, counterparty, sac.address(), token_client)
}

/// Open a channel and return its id with the ledger timestamp set to `now`.
fn open_channel_at(
    env: &Env,
    client: &PaymentChannelContractClient,
    depositor: &Address,
    counterparty: &Address,
    token: &Address,
    deposit: i128,
    now: u64,
) -> u64 {
    env.ledger().set_timestamp(now);
    client.open_channel(depositor, counterparty, token, &deposit, &3600)
}

/// Build a valid PaymentProof for testing.
fn make_proof(env: &Env, channel_id: u64, nonce: u64, timestamp: u64, amount: i128) -> PaymentProof {
    let mut hash_bytes = [0u8; 32];
    // Deterministic fake hash: channel_id in bytes 0..8, nonce in bytes 8..16.
    hash_bytes[0..8].copy_from_slice(&channel_id.to_be_bytes());
    hash_bytes[8..16].copy_from_slice(&nonce.to_be_bytes());
    PaymentProof {
        channel_id,
        request_hash: Bytes::from_array(env, &hash_bytes),
        nonce,
        timestamp,
        amount,
    }
}

// ── Positive case ─────────────────────────────────────────────────────────────

#[test]
fn proof_happy_path() {
    let (env, client, depositor, counterparty, token, _tc) = setup_proof_env();
    let now = 1_000u64;
    let cid = open_channel_at(&env, &client, &depositor, &counterparty, &token, 500, now);

    let proof = make_proof(&env, cid, 1, now, 100);
    client.verify_payment_proof(&proof, &depositor, &depositor, &counterparty);

    let ch = client.get_channel(&cid).unwrap();
    assert_eq!(ch.balance_a, 400);
    assert_eq!(ch.balance_b, 100);
    assert_eq!(ch.sequence, 1);
}

// ── Replay: exact same proof replayed ─────────────────────────────────────────

#[test]
fn proof_replay_same_request_rejected() {
    let (env, client, depositor, counterparty, token, _tc) = setup_proof_env();
    let now = 2_000u64;
    let cid = open_channel_at(&env, &client, &depositor, &counterparty, &token, 500, now);

    let proof = make_proof(&env, cid, 42, now, 50);

    // First call must succeed.
    client.verify_payment_proof(&proof, &depositor, &depositor, &counterparty);

    // Exact replay — must be rejected with ProofAlreadyUsed.
    let result =
        client.try_verify_payment_proof(&proof, &depositor, &depositor, &counterparty);
    assert_eq!(result, Err(Ok(Error::ProofAlreadyUsed)));

    // Channel balance must not have changed on the second call.
    let ch = client.get_channel(&cid).unwrap();
    assert_eq!(ch.balance_a, 450);
}

// ── Cross-request reuse: same nonce, different request hash ───────────────────

#[test]
fn proof_cross_request_reuse_rejected() {
    let (env, client, depositor, counterparty, token, _tc) = setup_proof_env();
    let now = 3_000u64;
    let cid = open_channel_at(&env, &client, &depositor, &counterparty, &token, 500, now);

    let nonce = 99u64;
    let proof_a = make_proof(&env, cid, nonce, now, 50);
    // proof_b shares the nonce but has a different request_hash.
    let mut hash_b = [0xFFu8; 32];
    hash_b[0] = 0xAB;
    let proof_b = PaymentProof {
        channel_id: cid,
        request_hash: Bytes::from_array(&env, &hash_b),
        nonce,
        timestamp: now,
        amount: 60,
    };

    // First proof accepted.
    client.verify_payment_proof(&proof_a, &depositor, &depositor, &counterparty);

    // Attempt to reuse the nonce with a different request hash — must be rejected.
    let result =
        client.try_verify_payment_proof(&proof_b, &depositor, &depositor, &counterparty);
    assert_eq!(
        result,
        Err(Ok(Error::ProofAlreadyUsed)),
        "cross-request reuse with same nonce must be rejected"
    );
}

// ── Freshness: too old ────────────────────────────────────────────────────────

#[test]
fn proof_expired_too_old_rejected() {
    let (env, client, depositor, counterparty, token, _tc) = setup_proof_env();
    let now = 10_000u64;
    let cid = open_channel_at(&env, &client, &depositor, &counterparty, &token, 500, now);

    // Timestamp is one second past the allowed window.
    let stale_ts = now - PROOF_FRESHNESS_WINDOW_SECS - 1;
    let proof = make_proof(&env, cid, 1, stale_ts, 50);

    let result =
        client.try_verify_payment_proof(&proof, &depositor, &depositor, &counterparty);
    assert_eq!(result, Err(Ok(Error::ProofExpired)));
}

// ── Freshness: too far in the future ─────────────────────────────────────────

#[test]
fn proof_expired_too_new_rejected() {
    let (env, client, depositor, counterparty, token, _tc) = setup_proof_env();
    let now = 10_000u64;
    let cid = open_channel_at(&env, &client, &depositor, &counterparty, &token, 500, now);

    let future_ts = now + PROOF_FRESHNESS_WINDOW_SECS + 1;
    let proof = make_proof(&env, cid, 1, future_ts, 50);

    let result =
        client.try_verify_payment_proof(&proof, &depositor, &depositor, &counterparty);
    assert_eq!(result, Err(Ok(Error::ProofExpired)));
}

// ── Freshness: exactly at boundary is accepted ────────────────────────────────

#[test]
fn proof_at_freshness_boundary_accepted() {
    let (env, client, depositor, counterparty, token, _tc) = setup_proof_env();
    let now = 10_000u64;
    let cid = open_channel_at(&env, &client, &depositor, &counterparty, &token, 500, now);

    // Exactly at the oldest acceptable boundary.
    let boundary_ts = now - PROOF_FRESHNESS_WINDOW_SECS;
    let proof = make_proof(&env, cid, 1, boundary_ts, 50);

    // Must NOT be rejected for freshness.
    client.verify_payment_proof(&proof, &depositor, &depositor, &counterparty);
    let ch = client.get_channel(&cid).unwrap();
    assert_eq!(ch.balance_a, 450);
}

// ── Structural: empty request_hash ───────────────────────────────────────────

#[test]
fn proof_invalid_request_hash_rejected() {
    let (env, client, depositor, counterparty, token, _tc) = setup_proof_env();
    let now = 5_000u64;
    let cid = open_channel_at(&env, &client, &depositor, &counterparty, &token, 500, now);

    let proof = PaymentProof {
        channel_id: cid,
        request_hash: Bytes::new(&env), // empty — invalid
        nonce: 1,
        timestamp: now,
        amount: 50,
    };

    let result =
        client.try_verify_payment_proof(&proof, &depositor, &depositor, &counterparty);
    assert_eq!(result, Err(Ok(Error::ProofInvalidRequestHash)));
}

// ── Structural: non-positive amount ──────────────────────────────────────────

#[test]
fn proof_invalid_amount_rejected() {
    let (env, client, depositor, counterparty, token, _tc) = setup_proof_env();
    let now = 5_000u64;
    let cid = open_channel_at(&env, &client, &depositor, &counterparty, &token, 500, now);

    for bad_amount in [0i128, -1i128, -100i128] {
        let proof = make_proof(&env, cid, 1, now, bad_amount);
        let result =
            client.try_verify_payment_proof(&proof, &depositor, &depositor, &counterparty);
        assert_eq!(
            result,
            Err(Ok(Error::ProofInvalidAmount)),
            "amount={bad_amount} should be rejected"
        );
    }
}

// ── Wrong channel_id ──────────────────────────────────────────────────────────

#[test]
fn proof_wrong_channel_rejected() {
    let (env, client, depositor, counterparty, token, _tc) = setup_proof_env();
    let now = 5_000u64;
    open_channel_at(&env, &client, &depositor, &counterparty, &token, 500, now);

    // channel_id 9999 does not exist.
    let proof = make_proof(&env, 9999, 1, now, 50);
    let result =
        client.try_verify_payment_proof(&proof, &depositor, &depositor, &counterparty);
    assert_eq!(result, Err(Ok(Error::ChannelNotFound)));
}

// ── Insufficient balance ──────────────────────────────────────────────────────

#[test]
fn proof_insufficient_balance_rejected() {
    let (env, client, depositor, counterparty, token, _tc) = setup_proof_env();
    let now = 5_000u64;
    let cid = open_channel_at(&env, &client, &depositor, &counterparty, &token, 100, now);

    let proof = make_proof(&env, cid, 1, now, 200); // 200 > 100
    let result =
        client.try_verify_payment_proof(&proof, &depositor, &depositor, &counterparty);
    assert_eq!(result, Err(Ok(Error::InsufficientBalance)));
}

// ── Unauthorised payer ────────────────────────────────────────────────────────

#[test]
fn proof_unauthorized_payer_rejected() {
    let (env, client, depositor, counterparty, token, _tc) = setup_proof_env();
    let now = 5_000u64;
    let cid = open_channel_at(&env, &client, &depositor, &counterparty, &token, 500, now);
    let stranger = Address::generate(&env);

    let proof = make_proof(&env, cid, 1, now, 50);
    let result =
        client.try_verify_payment_proof(&proof, &stranger, &depositor, &counterparty);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

// ── Unauthorised signatories ──────────────────────────────────────────────────

#[test]
fn proof_unauthorized_sigs_rejected() {
    let (env, client, depositor, counterparty, token, _tc) = setup_proof_env();
    let now = 5_000u64;
    let cid = open_channel_at(&env, &client, &depositor, &counterparty, &token, 500, now);
    let attacker = Address::generate(&env);

    let proof = make_proof(&env, cid, 1, now, 50);
    let result =
        client.try_verify_payment_proof(&proof, &depositor, &attacker, &counterparty);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

// ── Proof against a non-Open channel ─────────────────────────────────────────

#[test]
fn proof_closed_channel_rejected() {
    let (env, client, depositor, counterparty, token, _tc) = setup_proof_env();
    let now = 5_000u64;
    let cid = open_channel_at(&env, &client, &depositor, &counterparty, &token, 500, now);

    // Close the channel.
    client.initiate_close(&cid, &500, &0, &1, &depositor);
    let ch = client.get_channel(&cid).unwrap();
    env.ledger().set_timestamp(ch.dispute_deadline + 1);
    client.finalize(&cid, &1);

    let proof = make_proof(&env, cid, 1, ch.dispute_deadline + 1, 50);
    let result =
        client.try_verify_payment_proof(&proof, &depositor, &depositor, &counterparty);
    assert_eq!(result, Err(Ok(Error::InvalidState)));
}

// ── Same nonce on different channels is independent ───────────────────────────

#[test]
fn proof_nonce_unique_per_channel() {
    let (env, client, depositor, counterparty, token, _tc) = setup_proof_env();
    let now = 6_000u64;
    let cid1 = open_channel_at(&env, &client, &depositor, &counterparty, &token, 500, now);
    let cid2 = open_channel_at(&env, &client, &depositor, &counterparty, &token, 500, now);

    let nonce = 7u64;
    let proof1 = make_proof(&env, cid1, nonce, now, 50);
    let proof2 = make_proof(&env, cid2, nonce, now, 50);

    // Nonce 7 on channel 1.
    client.verify_payment_proof(&proof1, &depositor, &depositor, &counterparty);

    // Same nonce on channel 2 must be independent — no replay error.
    client.verify_payment_proof(&proof2, &depositor, &depositor, &counterparty);

    assert_eq!(client.get_channel(&cid1).unwrap().balance_a, 450);
    assert_eq!(client.get_channel(&cid2).unwrap().balance_a, 450);
}

// ── is_nonce_used helper ──────────────────────────────────────────────────────

#[test]
fn is_nonce_used_helper() {
    let (env, client, depositor, counterparty, token, _tc) = setup_proof_env();
    let now = 7_000u64;
    let cid = open_channel_at(&env, &client, &depositor, &counterparty, &token, 500, now);

    assert!(!client.is_nonce_used(&cid, &55), "nonce must be unused before first call");

    let proof = make_proof(&env, cid, 55, now, 50);
    client.verify_payment_proof(&proof, &depositor, &depositor, &counterparty);

    assert!(client.is_nonce_used(&cid, &55), "nonce must be marked used after first call");
    assert!(!client.is_nonce_used(&cid, &56), "unrelated nonce must still be unused");
}

// ── Multiple sequential proofs on the same channel ───────────────────────────

#[test]
fn multiple_proofs_sequential_accepted() {
    let (env, client, depositor, counterparty, token, _tc) = setup_proof_env();
    let now = 8_000u64;
    let cid = open_channel_at(&env, &client, &depositor, &counterparty, &token, 300, now);

    for i in 1u64..=3 {
        let proof = make_proof(&env, cid, i, now, 50);
        client.verify_payment_proof(&proof, &depositor, &depositor, &counterparty);
    }

    let ch = client.get_channel(&cid).unwrap();
    assert_eq!(ch.balance_a, 150);
    assert_eq!(ch.balance_b, 150);
    assert_eq!(ch.sequence, 3);
}
