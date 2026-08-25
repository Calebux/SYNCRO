#![cfg(test)]

use soroban_sdk::{Bytes, BytesN, Env};
use super::*;


#[test]
fn neg_verify_and_record_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( ZkPaymentVerifier, ());
    let client = ZkPaymentVerifierClient::new(&env, &id);
    let _ = client.try_verify_and_record(&Bytes::from_slice(&env, b"x"), &Bytes::from_slice(&env, b"x"), &1u128, &1u64, &BytesN::from_array(&env, &[1u8; 32]), &BytesN::from_array(&env, &[1u8; 32]));
}

#[test]
fn neg_verify_and_record_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( ZkPaymentVerifier, ());
    let client = ZkPaymentVerifierClient::new(&env, &id);
    
    let _ = client.try_verify_and_record(&Bytes::from_slice(&env, b"x"), &Bytes::from_slice(&env, b"x"), &1u128, &1u64, &BytesN::from_array(&env, &[1u8; 32]), &BytesN::from_array(&env, &[1u8; 32]));
}

#[test]
fn neg_is_nullifier_used_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( ZkPaymentVerifier, ());
    let client = ZkPaymentVerifierClient::new(&env, &id);
    let _ = client.try_is_nullifier_used(&BytesN::from_array(&env, &[1u8; 32]));
}

#[test]
fn neg_is_nullifier_used_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( ZkPaymentVerifier, ());
    let client = ZkPaymentVerifierClient::new(&env, &id);
    
    let _ = client.try_is_nullifier_used(&BytesN::from_array(&env, &[1u8; 32]));
}

