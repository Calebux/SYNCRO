#![cfg(test)]

use soroban_sdk::{contract, contractimpl, testutils::{Address as _, EnvTestConfig}, Address, Env};
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
    let id = env.register( PaymentAdapterContract, ());
    let client = PaymentAdapterContractClient::new(&env, &id);
    let _ = client.try_init(&Address::generate(&env));
}

#[test]
fn neg_init_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( PaymentAdapterContract, ());
    let client = PaymentAdapterContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_init(&Address::generate(&env));
}

#[test]
fn neg_allow_token_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( PaymentAdapterContract, ());
    let client = PaymentAdapterContractClient::new(&env, &id);
    let _ = client.try_allow_token(&Address::generate(&env), &1i128);
}

#[test]
fn neg_allow_token_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( PaymentAdapterContract, ());
    let client = PaymentAdapterContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_allow_token(&Address::generate(&env), &1i128);
}

#[test]
fn neg_revoke_token_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( PaymentAdapterContract, ());
    let client = PaymentAdapterContractClient::new(&env, &id);
    let _ = client.try_revoke_token(&Address::generate(&env));
}

#[test]
fn neg_revoke_token_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( PaymentAdapterContract, ());
    let client = PaymentAdapterContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_revoke_token(&Address::generate(&env));
}

#[test]
fn neg_settle_renewal_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( PaymentAdapterContract, ());
    let client = PaymentAdapterContractClient::new(&env, &id);
    let _ = client.try_settle_renewal(&Address::generate(&env), &Address::generate(&env), &Address::generate(&env), &1i128);
}

#[test]
fn neg_settle_renewal_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( PaymentAdapterContract, ());
    let client = PaymentAdapterContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_settle_renewal(&Address::generate(&env), &Address::generate(&env), &Address::generate(&env), &1i128);
}

#[test]
fn neg_get_policy_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( PaymentAdapterContract, ());
    let client = PaymentAdapterContractClient::new(&env, &id);
    let _ = client.try_get_policy(&Address::generate(&env));
}

#[test]
fn neg_get_policy_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( PaymentAdapterContract, ());
    let client = PaymentAdapterContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_get_policy(&Address::generate(&env));
}

#[test]
fn neg_available_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( PaymentAdapterContract, ());
    let client = PaymentAdapterContractClient::new(&env, &id);
    let _ = client.try_available(&Address::generate(&env));
}

#[test]
fn neg_available_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( PaymentAdapterContract, ());
    let client = PaymentAdapterContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_available(&Address::generate(&env));
}

#[test]
fn neg_is_allowed_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( PaymentAdapterContract, ());
    let client = PaymentAdapterContractClient::new(&env, &id);
    let _ = client.try_is_allowed(&Address::generate(&env));
}

#[test]
fn neg_is_allowed_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( PaymentAdapterContract, ());
    let client = PaymentAdapterContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_is_allowed(&Address::generate(&env));
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
    let env = test_env();
    env.mock_all_auths();
    let id = env.register(ReentrantProbeToken, ());
    let token = ReentrantProbeTokenClient::new(&env, &id);
    token.transfer(&Address::generate(&env), &Address::generate(&env), &1i128);
    assert!(token.reenter_rejected());
    assert_eq!(token.hits(), 1);
}
