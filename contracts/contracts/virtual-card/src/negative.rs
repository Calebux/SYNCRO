#![cfg(test)]

use soroban_sdk::{testutils::{Address as _, EnvTestConfig}, Address, Env, String};
use super::*;

fn test_env() -> Env {
    Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
        ..EnvTestConfig::default()
    })
}


#[test]
fn neg_issue_card_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VirtualCardContract, ());
    let client = VirtualCardContractClient::new(&env, &id);
    let _ = client.try_issue_card(&Address::generate(&env), &1i128, &CardType::Standard, &1u64);
}

#[test]
fn neg_issue_card_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VirtualCardContract, ());
    let client = VirtualCardContractClient::new(&env, &id);
    
    let _ = client.try_issue_card(&Address::generate(&env), &1i128, &CardType::Standard, &1u64);
}

#[test]
fn neg_process_payment_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VirtualCardContract, ());
    let client = VirtualCardContractClient::new(&env, &id);
    let _ = client.try_process_payment(&1u32, &1i128, &String::from_str(&env, "x"));
}

#[test]
fn neg_process_payment_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VirtualCardContract, ());
    let client = VirtualCardContractClient::new(&env, &id);
    
    let _ = client.try_process_payment(&1u32, &1i128, &String::from_str(&env, "x"));
}

#[test]
fn neg_get_balance_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VirtualCardContract, ());
    let client = VirtualCardContractClient::new(&env, &id);
    let _ = client.try_get_balance(&1u32);
}

#[test]
fn neg_get_balance_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VirtualCardContract, ());
    let client = VirtualCardContractClient::new(&env, &id);
    
    let _ = client.try_get_balance(&1u32);
}

#[test]
fn neg_get_card_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VirtualCardContract, ());
    let client = VirtualCardContractClient::new(&env, &id);
    let _ = client.try_get_card(&1u32);
}

#[test]
fn neg_get_card_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VirtualCardContract, ());
    let client = VirtualCardContractClient::new(&env, &id);
    
    let _ = client.try_get_card(&1u32);
}

#[test]
fn neg_activate_card_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VirtualCardContract, ());
    let client = VirtualCardContractClient::new(&env, &id);
    let _ = client.try_activate_card(&1u32, &Address::generate(&env));
}

#[test]
fn neg_activate_card_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VirtualCardContract, ());
    let client = VirtualCardContractClient::new(&env, &id);
    
    let _ = client.try_activate_card(&1u32, &Address::generate(&env));
}

#[test]
fn neg_deactivate_card_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VirtualCardContract, ());
    let client = VirtualCardContractClient::new(&env, &id);
    let _ = client.try_deactivate_card(&1u32, &Address::generate(&env), &String::from_str(&env, "x"));
}

#[test]
fn neg_deactivate_card_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VirtualCardContract, ());
    let client = VirtualCardContractClient::new(&env, &id);
    
    let _ = client.try_deactivate_card(&1u32, &Address::generate(&env), &String::from_str(&env, "x"));
}

#[test]
fn neg_suspend_card_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VirtualCardContract, ());
    let client = VirtualCardContractClient::new(&env, &id);
    let _ = client.try_suspend_card(&1u32, &Address::generate(&env));
}

#[test]
fn neg_suspend_card_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VirtualCardContract, ());
    let client = VirtualCardContractClient::new(&env, &id);
    
    let _ = client.try_suspend_card(&1u32, &Address::generate(&env));
}

#[test]
fn neg_verify_ownership_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VirtualCardContract, ());
    let client = VirtualCardContractClient::new(&env, &id);
    let _ = client.try_verify_ownership(&1u32, &Address::generate(&env));
}

#[test]
fn neg_verify_ownership_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VirtualCardContract, ());
    let client = VirtualCardContractClient::new(&env, &id);
    
    let _ = client.try_verify_ownership(&1u32, &Address::generate(&env));
}

#[test]
fn neg_can_transact_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VirtualCardContract, ());
    let client = VirtualCardContractClient::new(&env, &id);
    let _ = client.try_can_transact(&1u32, &1i128);
}

#[test]
fn neg_can_transact_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VirtualCardContract, ());
    let client = VirtualCardContractClient::new(&env, &id);
    
    let _ = client.try_can_transact(&1u32, &1i128);
}

#[test]
fn neg_version_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VirtualCardContract, ());
    let client = VirtualCardContractClient::new(&env, &id);
    let _ = client.try_version();
}

#[test]
fn neg_version_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( VirtualCardContract, ());
    let client = VirtualCardContractClient::new(&env, &id);
    
    let _ = client.try_version();
}

