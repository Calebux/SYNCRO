#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String};
use super::*;


#[test]
fn neg_initialize_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( GuardianContract, ());
    let client = GuardianContractClient::new(&env, &id);
    let _ = client.try_initialize(&Address::generate(&env));
}

#[test]
fn neg_initialize_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( GuardianContract, ());
    let client = GuardianContractClient::new(&env, &id);
    client.initialize(&Address::generate(&env));
    let _ = client.try_initialize(&Address::generate(&env));
}

#[test]
fn neg_register_contract_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( GuardianContract, ());
    let client = GuardianContractClient::new(&env, &id);
    let _ = client.try_register_contract(&Address::generate(&env), &String::from_str(&env, "x"));
}

#[test]
fn neg_register_contract_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( GuardianContract, ());
    let client = GuardianContractClient::new(&env, &id);
    client.initialize(&Address::generate(&env));
    let _ = client.try_register_contract(&Address::generate(&env), &String::from_str(&env, "x"));
}

#[test]
fn neg_unregister_contract_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( GuardianContract, ());
    let client = GuardianContractClient::new(&env, &id);
    let _ = client.try_unregister_contract(&Address::generate(&env));
}

#[test]
fn neg_unregister_contract_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( GuardianContract, ());
    let client = GuardianContractClient::new(&env, &id);
    client.initialize(&Address::generate(&env));
    let _ = client.try_unregister_contract(&Address::generate(&env));
}

#[test]
fn neg_emergency_pause_all_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( GuardianContract, ());
    let client = GuardianContractClient::new(&env, &id);
    let _ = client.try_emergency_pause_all();
}

#[test]
fn neg_emergency_pause_all_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( GuardianContract, ());
    let client = GuardianContractClient::new(&env, &id);
    client.initialize(&Address::generate(&env));
    let _ = client.try_emergency_pause_all();
}

#[test]
fn neg_emergency_unpause_all_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( GuardianContract, ());
    let client = GuardianContractClient::new(&env, &id);
    let _ = client.try_emergency_unpause_all();
}

#[test]
fn neg_emergency_unpause_all_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( GuardianContract, ());
    let client = GuardianContractClient::new(&env, &id);
    client.initialize(&Address::generate(&env));
    let _ = client.try_emergency_unpause_all();
}

#[test]
fn neg_get_guardian_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( GuardianContract, ());
    let client = GuardianContractClient::new(&env, &id);
    let _ = client.try_get_guardian();
}

#[test]
fn neg_get_guardian_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( GuardianContract, ());
    let client = GuardianContractClient::new(&env, &id);
    client.initialize(&Address::generate(&env));
    let _ = client.try_get_guardian();
}

#[test]
fn neg_get_registered_contracts_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( GuardianContract, ());
    let client = GuardianContractClient::new(&env, &id);
    let _ = client.try_get_registered_contracts();
}

#[test]
fn neg_get_registered_contracts_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( GuardianContract, ());
    let client = GuardianContractClient::new(&env, &id);
    client.initialize(&Address::generate(&env));
    let _ = client.try_get_registered_contracts();
}

#[test]
fn neg_get_contract_count_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( GuardianContract, ());
    let client = GuardianContractClient::new(&env, &id);
    let _ = client.try_get_contract_count();
}

#[test]
fn neg_get_contract_count_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( GuardianContract, ());
    let client = GuardianContractClient::new(&env, &id);
    client.initialize(&Address::generate(&env));
    let _ = client.try_get_contract_count();
}

#[test]
fn neg_is_contract_registered_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( GuardianContract, ());
    let client = GuardianContractClient::new(&env, &id);
    let _ = client.try_is_contract_registered(&Address::generate(&env));
}

#[test]
fn neg_is_contract_registered_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( GuardianContract, ());
    let client = GuardianContractClient::new(&env, &id);
    client.initialize(&Address::generate(&env));
    let _ = client.try_is_contract_registered(&Address::generate(&env));
}

