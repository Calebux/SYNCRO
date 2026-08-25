#![cfg(test)]

use soroban_sdk::{vec, testutils::Address as _, Address, BytesN, Env, String};
use super::*;


#[test]
fn neg_init_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionLoggingContract, ());
    let client = SubscriptionLoggingContractClient::new(&env, &id);
    let _ = client.try_init(&Address::generate(&env));
}

#[test]
fn neg_init_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionLoggingContract, ());
    let client = SubscriptionLoggingContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_init(&Address::generate(&env));
}

#[test]
fn neg_record_log_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionLoggingContract, ());
    let client = SubscriptionLoggingContractClient::new(&env, &id);
    let _ = client.try_record_log(&1u64, &LogEvent::Reminder, &String::from_str(&env, "x"));
}

#[test]
fn neg_record_log_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionLoggingContract, ());
    let client = SubscriptionLoggingContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_record_log(&1u64, &LogEvent::Reminder, &String::from_str(&env, "x"));
}

#[test]
fn neg_get_logs_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionLoggingContract, ());
    let client = SubscriptionLoggingContractClient::new(&env, &id);
    let _ = client.try_get_logs(&1u64);
}

#[test]
fn neg_get_logs_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionLoggingContract, ());
    let client = SubscriptionLoggingContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_get_logs(&1u64);
}

#[test]
fn neg_record_commitment_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionLoggingContract, ());
    let client = SubscriptionLoggingContractClient::new(&env, &id);
    let _ = client.try_record_commitment(&BytesN::from_array(&env, &[1u8; 32]));
}

#[test]
fn neg_record_commitment_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionLoggingContract, ());
    let client = SubscriptionLoggingContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_record_commitment(&BytesN::from_array(&env, &[1u8; 32]));
}

#[test]
fn neg_get_commitment_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionLoggingContract, ());
    let client = SubscriptionLoggingContractClient::new(&env, &id);
    let _ = client.try_get_commitment(&1u64);
}

#[test]
fn neg_get_commitment_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionLoggingContract, ());
    let client = SubscriptionLoggingContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_get_commitment(&1u64);
}

#[test]
fn neg_get_commitment_count_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionLoggingContract, ());
    let client = SubscriptionLoggingContractClient::new(&env, &id);
    let _ = client.try_get_commitment_count();
}

#[test]
fn neg_get_commitment_count_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionLoggingContract, ());
    let client = SubscriptionLoggingContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_get_commitment_count();
}

#[test]
fn neg_get_commitments_range_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionLoggingContract, ());
    let client = SubscriptionLoggingContractClient::new(&env, &id);
    let _ = client.try_get_commitments_range(&1u64, &1u64);
}

#[test]
fn neg_get_commitments_range_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionLoggingContract, ());
    let client = SubscriptionLoggingContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_get_commitments_range(&1u64, &1u64);
}

#[test]
fn neg_anchor_merkle_root_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionLoggingContract, ());
    let client = SubscriptionLoggingContractClient::new(&env, &id);
    let _ = client.try_anchor_merkle_root(&BytesN::from_array(&env, &[1u8; 32]), &1u64, &1u64);
}

#[test]
fn neg_anchor_merkle_root_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionLoggingContract, ());
    let client = SubscriptionLoggingContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_anchor_merkle_root(&BytesN::from_array(&env, &[1u8; 32]), &1u64, &1u64);
}

#[test]
fn neg_get_merkle_root_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionLoggingContract, ());
    let client = SubscriptionLoggingContractClient::new(&env, &id);
    let _ = client.try_get_merkle_root(&1u64);
}

#[test]
fn neg_get_merkle_root_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionLoggingContract, ());
    let client = SubscriptionLoggingContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_get_merkle_root(&1u64);
}

#[test]
fn neg_get_merkle_root_count_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionLoggingContract, ());
    let client = SubscriptionLoggingContractClient::new(&env, &id);
    let _ = client.try_get_merkle_root_count();
}

#[test]
fn neg_get_merkle_root_count_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionLoggingContract, ());
    let client = SubscriptionLoggingContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_get_merkle_root_count();
}

#[test]
fn neg_verify_merkle_membership_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionLoggingContract, ());
    let client = SubscriptionLoggingContractClient::new(&env, &id);
    let _ = client.try_verify_merkle_membership(&1u64, &1u64, &vec![&env, BytesN::from_array(&env, &[1u8; 32])], &vec![&env]);
}

#[test]
fn neg_verify_merkle_membership_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionLoggingContract, ());
    let client = SubscriptionLoggingContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_verify_merkle_membership(&1u64, &1u64, &vec![&env, BytesN::from_array(&env, &[1u8; 32])], &vec![&env]);
}

