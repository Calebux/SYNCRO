#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env};

#[test]
fn test_verify_and_record_valid_commitment() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ZkPaymentVerifier);
    let client = ZkPaymentVerifierClient::new(&env, &contract_id);

    let user_id = Bytes::from_slice(&env, b"user_alice");
    let service_id = Bytes::from_slice(&env, b"service_netflix");
    let amount: u128 = 1500;
    let timestamp: u64 = 1700000000;
    let blinding_factor = BytesN::from_array(&env, &[42u8; 32]);

    let expected = commitment::compute_commitment(
        &env,
        &user_id,
        &service_id,
        amount,
        timestamp,
        &blinding_factor,
    );

    let result = client.verify_and_record(
        &user_id,
        &service_id,
        &amount,
        &timestamp,
        &blinding_factor,
        &expected,
    );
    assert!(result);
}

#[test]
fn test_nullifier_prevents_double_proof() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ZkPaymentVerifier);
    let client = ZkPaymentVerifierClient::new(&env, &contract_id);

    let user_id = Bytes::from_slice(&env, b"user_alice");
    let service_id = Bytes::from_slice(&env, b"service_netflix");
    let amount: u128 = 1500;
    let timestamp: u64 = 1700000000;
    let blinding_factor = BytesN::from_array(&env, &[42u8; 32]);

    let expected = commitment::compute_commitment(
        &env,
        &user_id,
        &service_id,
        amount,
        timestamp,
        &blinding_factor,
    );

    // First call succeeds
    assert!(client.verify_and_record(
        &user_id,
        &service_id,
        &amount,
        &timestamp,
        &blinding_factor,
        &expected,
    ));

    // Second call with same blinding_factor + service_id is rejected (nullifier used)
    assert!(!client.verify_and_record(
        &user_id,
        &service_id,
        &amount,
        &timestamp,
        &blinding_factor,
        &expected,
    ));
}

#[test]
fn test_wrong_commitment_rejected() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ZkPaymentVerifier);
    let client = ZkPaymentVerifierClient::new(&env, &contract_id);

    let user_id = Bytes::from_slice(&env, b"user_alice");
    let service_id = Bytes::from_slice(&env, b"service_netflix");
    let blinding_factor = BytesN::from_array(&env, &[42u8; 32]);

    let wrong_commitment = BytesN::from_array(&env, &[0u8; 32]);

    assert!(!client.verify_and_record(
        &user_id,
        &service_id,
        &1500u128,
        &1700000000u64,
        &blinding_factor,
        &wrong_commitment,
    ));
}

#[test]
fn test_different_services_independent_nullifiers() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ZkPaymentVerifier);
    let client = ZkPaymentVerifierClient::new(&env, &contract_id);

    let user_id = Bytes::from_slice(&env, b"user_alice");
    let service_a = Bytes::from_slice(&env, b"service_netflix");
    let service_b = Bytes::from_slice(&env, b"service_spotify");
    let amount: u128 = 1500;
    let timestamp: u64 = 1700000000;
    let blinding_factor = BytesN::from_array(&env, &[42u8; 32]);

    let commitment_a = commitment::compute_commitment(
        &env, &user_id, &service_a, amount, timestamp, &blinding_factor,
    );
    let commitment_b = commitment::compute_commitment(
        &env, &user_id, &service_b, amount, timestamp, &blinding_factor,
    );

    // Both should succeed — different services produce different nullifiers
    assert!(client.verify_and_record(
        &user_id, &service_a, &amount, &timestamp, &blinding_factor, &commitment_a,
    ));
    assert!(client.verify_and_record(
        &user_id, &service_b, &amount, &timestamp, &blinding_factor, &commitment_b,
    ));
}

#[test]
fn test_is_nullifier_used() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ZkPaymentVerifier);
    let client = ZkPaymentVerifierClient::new(&env, &contract_id);

    let service_id = Bytes::from_slice(&env, b"service_netflix");
    let blinding_factor = BytesN::from_array(&env, &[42u8; 32]);

    let nullifier = nullifier::compute_nullifier(&env, &blinding_factor, &service_id);

    assert!(!client.is_nullifier_used(&nullifier));

    let user_id = Bytes::from_slice(&env, b"user_alice");
    let expected = commitment::compute_commitment(
        &env, &user_id, &service_id, 1500u128, 1700000000u64, &blinding_factor,
    );
    client.verify_and_record(
        &user_id, &service_id, &1500u128, &1700000000u64, &blinding_factor, &expected,
    );

    assert!(client.is_nullifier_used(&nullifier));
}
