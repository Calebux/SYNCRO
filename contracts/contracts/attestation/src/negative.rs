#![cfg(test)]

use soroban_sdk::{testutils::{Address as _, EnvTestConfig}, Address, BytesN, Env, Symbol};
use super::*;

fn test_env() -> Env {
    Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
        ..EnvTestConfig::default()
    })
}


#[test]
fn neg_init_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( AttestationContract, ());
    let client = AttestationContractClient::new(&env, &id);
    let _ = client.try_init(&Address::generate(&env));
}

#[test]
fn neg_init_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( AttestationContract, ());
    let client = AttestationContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_init(&Address::generate(&env));
}

#[test]
fn neg_issue_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( AttestationContract, ());
    let client = AttestationContractClient::new(&env, &id);
    let _ = client.try_issue(&Address::generate(&env), &Symbol::new(&env, "x"), &BytesN::from_array(&env, &[1u8; 32]));
}

#[test]
fn neg_issue_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( AttestationContract, ());
    let client = AttestationContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_issue(&Address::generate(&env), &Symbol::new(&env, "x"), &BytesN::from_array(&env, &[1u8; 32]));
}

#[test]
fn neg_revoke_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( AttestationContract, ());
    let client = AttestationContractClient::new(&env, &id);
    let _ = client.try_revoke(&Address::generate(&env), &Symbol::new(&env, "x"));
}

#[test]
fn neg_revoke_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( AttestationContract, ());
    let client = AttestationContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_revoke(&Address::generate(&env), &Symbol::new(&env, "x"));
}

#[test]
fn neg_verify_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( AttestationContract, ());
    let client = AttestationContractClient::new(&env, &id);
    let _ = client.try_verify(&Address::generate(&env), &Symbol::new(&env, "x"), &BytesN::from_array(&env, &[1u8; 32]));
}

#[test]
fn neg_verify_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( AttestationContract, ());
    let client = AttestationContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_verify(&Address::generate(&env), &Symbol::new(&env, "x"), &BytesN::from_array(&env, &[1u8; 32]));
}

#[test]
fn neg_get_record_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( AttestationContract, ());
    let client = AttestationContractClient::new(&env, &id);
    let _ = client.try_get_record(&Address::generate(&env), &Symbol::new(&env, "x"));
}

#[test]
fn neg_get_record_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( AttestationContract, ());
    let client = AttestationContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_get_record(&Address::generate(&env), &Symbol::new(&env, "x"));
}

