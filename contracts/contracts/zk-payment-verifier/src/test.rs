#![cfg(test)]

use super::*;
use soroban_sdk::{Bytes, BytesN, Env};

const COMMIT_DOMAIN: [u8; 32] = *b"syncro:payment:commit\0\0\0\0\0\0\0\0\0\0\0";
const NULL_DOMAIN: [u8; 32] = *b"syncro:payment:nullifier\0\0\0\0\0\0\0\0";

fn hash_domain_key(env: &Env, domain: &[u8; 32], key: &BytesN<32>) -> BytesN<32> {
    let mut input = Bytes::new(env);
    input.extend_from_slice(domain);
    input.extend_from_slice(&key.to_array());
    env.crypto().sha256(&input).into()
}

/// Build a valid 64-byte proof for test purposes (mirrors off-chain prover).
fn build_valid_proof(
    env: &Env,
    proof_key: &BytesN<32>,
    commitment: &BytesN<32>,
    nullifier: &BytesN<32>,
    amount_threshold: i128,
    time_window_start: u64,
    time_window_end: u64,
) -> Bytes {
    let mut params = [0u8; 32];
    params[0..16].copy_from_slice(&amount_threshold.to_be_bytes());
    params[16..24].copy_from_slice(&time_window_start.to_be_bytes());
    params[24..32].copy_from_slice(&time_window_end.to_be_bytes());

    let mut ctx_input = Bytes::new(env);
    ctx_input.extend_from_slice(&commitment.to_array());
    ctx_input.extend_from_slice(&nullifier.to_array());
    ctx_input.extend_from_slice(&params);
    let context: BytesN<32> = env.crypto().sha256(&ctx_input).into();

    let mut s_input = Bytes::new(env);
    s_input.extend_from_slice(&proof_key.to_array());
    s_input.extend_from_slice(&context.to_array());
    let s: BytesN<32> = env.crypto().sha256(&s_input).into();

    let mut proof = Bytes::new(env);
    proof.extend_from_slice(&proof_key.to_array());
    proof.extend_from_slice(&s.to_array());
    proof
}

fn derive_public_inputs(env: &Env, proof_key: &BytesN<32>) -> (BytesN<32>, BytesN<32>) {
    let commitment = hash_domain_key(env, &COMMIT_DOMAIN, proof_key);
    let nullifier = hash_domain_key(env, &NULL_DOMAIN, proof_key);
    (commitment, nullifier)
}

#[test]
fn test_verify_and_record_valid_proof() {
    let env = Env::default();
    let contract_id = env.register(ZkPaymentVerifier, ());
    let client = ZkPaymentVerifierClient::new(&env, &contract_id);

    let proof_key = BytesN::from_array(&env, &[7u8; 32]);
    let (commitment, nullifier) = derive_public_inputs(&env, &proof_key);
    let amount_threshold: i128 = 1500;
    let time_start: u64 = 0;
    let time_end: u64 = u64::MAX;

    let proof = build_valid_proof(
        &env,
        &proof_key,
        &commitment,
        &nullifier,
        amount_threshold,
        time_start,
        time_end,
    );

    assert!(client.verify_and_record(
        &proof,
        &commitment,
        &nullifier,
        &amount_threshold,
        &time_start,
        &time_end,
    ));
}

#[test]
fn test_nullifier_prevents_double_proof() {
    let env = Env::default();
    let contract_id = env.register(ZkPaymentVerifier, ());
    let client = ZkPaymentVerifierClient::new(&env, &contract_id);

    let proof_key = BytesN::from_array(&env, &[9u8; 32]);
    let (commitment, nullifier) = derive_public_inputs(&env, &proof_key);
    let amount_threshold: i128 = 1500;
    let time_start: u64 = 0;
    let time_end: u64 = u64::MAX;

    let proof = build_valid_proof(
        &env,
        &proof_key,
        &commitment,
        &nullifier,
        amount_threshold,
        time_start,
        time_end,
    );

    assert!(client.verify_and_record(
        &proof,
        &commitment,
        &nullifier,
        &amount_threshold,
        &time_start,
        &time_end,
    ));

    assert!(!client.verify_and_record(
        &proof,
        &commitment,
        &nullifier,
        &amount_threshold,
        &time_start,
        &time_end,
    ));
}

#[test]
fn test_forged_proof_rejected() {
    let env = Env::default();
    let contract_id = env.register(ZkPaymentVerifier, ());
    let client = ZkPaymentVerifierClient::new(&env, &contract_id);

    let proof_key = BytesN::from_array(&env, &[3u8; 32]);
    let (commitment, nullifier) = derive_public_inputs(&env, &proof_key);
    let amount_threshold: i128 = 1500;
    let time_start: u64 = 0;
    let time_end: u64 = u64::MAX;

    let mut forged = build_valid_proof(
        &env,
        &proof_key,
        &commitment,
        &nullifier,
        amount_threshold,
        time_start,
        time_end,
    );
    // Flip one byte in the response half — proof no longer satisfies check 3.
    forged.set(40, forged.get(40).unwrap_or(0) ^ 0xFF);

    assert!(!client.verify_and_record(
        &forged,
        &commitment,
        &nullifier,
        &amount_threshold,
        &time_start,
        &time_end,
    ));
}

#[test]
fn test_different_services_independent_nullifiers() {
    let env = Env::default();
    let contract_id = env.register(ZkPaymentVerifier, ());
    let client = ZkPaymentVerifierClient::new(&env, &contract_id);

    let key_a = BytesN::from_array(&env, &[1u8; 32]);
    let key_b = BytesN::from_array(&env, &[2u8; 32]);
    let (commit_a, null_a) = derive_public_inputs(&env, &key_a);
    let (commit_b, null_b) = derive_public_inputs(&env, &key_b);
    let amount_threshold: i128 = 1500;
    let time_start: u64 = 0;
    let time_end: u64 = u64::MAX;

    let proof_a = build_valid_proof(
        &env, &key_a, &commit_a, &null_a, amount_threshold, time_start, time_end,
    );
    let proof_b = build_valid_proof(
        &env, &key_b, &commit_b, &null_b, amount_threshold, time_start, time_end,
    );

    assert!(client.verify_and_record(
        &proof_a, &commit_a, &null_a, &amount_threshold, &time_start, &time_end,
    ));
    assert!(client.verify_and_record(
        &proof_b, &commit_b, &null_b, &amount_threshold, &time_start, &time_end,
    ));
}

#[test]
fn test_is_nullifier_used() {
    let env = Env::default();
    let contract_id = env.register(ZkPaymentVerifier, ());
    let client = ZkPaymentVerifierClient::new(&env, &contract_id);

    let proof_key = BytesN::from_array(&env, &[5u8; 32]);
    let (commitment, nullifier) = derive_public_inputs(&env, &proof_key);
    let amount_threshold: i128 = 1500;
    let time_start: u64 = 0;
    let time_end: u64 = u64::MAX;

    assert!(!client.is_nullifier_used(&nullifier));

    let proof = build_valid_proof(
        &env,
        &proof_key,
        &commitment,
        &nullifier,
        amount_threshold,
        time_start,
        time_end,
    );

    client.verify_and_record(
        &proof,
        &commitment,
        &nullifier,
        &amount_threshold,
        &time_start,
        &time_end,
    );

    assert!(client.is_nullifier_used(&nullifier));
}
