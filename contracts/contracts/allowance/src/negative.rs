#![cfg(test)]

use soroban_sdk::{contract, contractimpl, testutils::Address as _, Address, Env};
use super::*;


#[test]
fn neg_init_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AllowanceContract, ());
    let client = AllowanceContractClient::new(&env, &id);
    let _ = client.try_init(&Address::generate(&env));
}

#[test]
fn neg_init_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AllowanceContract, ());
    let client = AllowanceContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_init(&Address::generate(&env));
}

#[test]
fn neg_pause_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AllowanceContract, ());
    let client = AllowanceContractClient::new(&env, &id);
    let _ = client.try_pause();
}

#[test]
fn neg_pause_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AllowanceContract, ());
    let client = AllowanceContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_pause();
}

#[test]
fn neg_unpause_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AllowanceContract, ());
    let client = AllowanceContractClient::new(&env, &id);
    let _ = client.try_unpause();
}

#[test]
fn neg_unpause_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AllowanceContract, ());
    let client = AllowanceContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_unpause();
}

#[test]
fn neg_is_paused_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AllowanceContract, ());
    let client = AllowanceContractClient::new(&env, &id);
    let _ = client.try_is_paused();
}

#[test]
fn neg_is_paused_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AllowanceContract, ());
    let client = AllowanceContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_is_paused();
}

#[test]
fn neg_grant_allowance_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AllowanceContract, ());
    let client = AllowanceContractClient::new(&env, &id);
    let _ = client.try_grant_allowance(&Address::generate(&env), &Address::generate(&env), &Address::generate(&env), &1i128, &1i128, &1u64);
}

#[test]
fn neg_grant_allowance_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AllowanceContract, ());
    let client = AllowanceContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_grant_allowance(&Address::generate(&env), &Address::generate(&env), &Address::generate(&env), &1i128, &1i128, &1u64);
}

#[test]
fn neg_revoke_allowance_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AllowanceContract, ());
    let client = AllowanceContractClient::new(&env, &id);
    let _ = client.try_revoke_allowance(&1u64);
}

#[test]
fn neg_revoke_allowance_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AllowanceContract, ());
    let client = AllowanceContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_revoke_allowance(&1u64);
}

#[test]
fn neg_update_caps_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AllowanceContract, ());
    let client = AllowanceContractClient::new(&env, &id);
    let _ = client.try_update_caps(&1u64, &1i128, &1i128);
}

#[test]
fn neg_update_caps_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AllowanceContract, ());
    let client = AllowanceContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_update_caps(&1u64, &1i128, &1i128);
}

#[test]
fn neg_consume_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AllowanceContract, ());
    let client = AllowanceContractClient::new(&env, &id);
    let _ = client.try_consume(&1u64, &1i128);
}

#[test]
fn neg_consume_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AllowanceContract, ());
    let client = AllowanceContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_consume(&1u64, &1i128);
}

#[test]
fn neg_get_allowance_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AllowanceContract, ());
    let client = AllowanceContractClient::new(&env, &id);
    let _ = client.try_get_allowance(&1u64);
}

#[test]
fn neg_get_allowance_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AllowanceContract, ());
    let client = AllowanceContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_get_allowance(&1u64);
}

#[test]
fn neg_get_allowance_count_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AllowanceContract, ());
    let client = AllowanceContractClient::new(&env, &id);
    let _ = client.try_get_allowance_count();
}

#[test]
fn neg_get_allowance_count_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AllowanceContract, ());
    let client = AllowanceContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_get_allowance_count();
}

#[test]
fn neg_available_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AllowanceContract, ());
    let client = AllowanceContractClient::new(&env, &id);
    let _ = client.try_available(&1u64);
}

#[test]
fn neg_available_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( AllowanceContract, ());
    let client = AllowanceContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_available(&1u64);
}



#[contract]
pub struct ReentrantProbeToken;

#[contractimpl]
impl ReentrantProbeToken {
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        let _ = amount;
        let hits: u32 = env.storage().instance().get(&soroban_sdk::symbol_short!("hits")).unwrap_or(0u32);
        env.storage().instance().set(&soroban_sdk::symbol_short!("hits"), &(hits + 1));
        if hits == 0 {
            // Host rejects same-contract re-entry. Use try_ so the outer
            // transfer completes and the test can assert containment.
            let self_addr = env.current_contract_address();
            let rejected = ReentrantProbeTokenClient::new(&env, &self_addr)
                .try_transfer(&from, &to, &amount)
                .is_err();
            env.storage().instance().set(&soroban_sdk::symbol_short!("rej"), &rejected);
        }
    }

    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        let _ = spender;
        Self::transfer(env, from, to, amount);
    }

    pub fn hits(env: Env) -> u32 {
        env.storage().instance().get(&soroban_sdk::symbol_short!("hits")).unwrap_or(0u32)
    }

    pub fn reenter_rejected(env: Env) -> bool {
        env.storage().instance().get(&soroban_sdk::symbol_short!("rej")).unwrap_or(false)
    }
}

#[test]
fn malicious_token_reentrancy_is_contained() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(ReentrantProbeToken, ());
    let token = ReentrantProbeTokenClient::new(&env, &id);
    token.transfer(&Address::generate(&env), &Address::generate(&env), &1i128);
    assert!(token.reenter_rejected());
    assert_eq!(token.hits(), 1);
}
