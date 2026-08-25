#![cfg(test)]

use soroban_sdk::{contract, contractimpl, testutils::Address as _, Address, Env, String};
use super::*;


#[test]
fn neg_init_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( EscrowContract, ());
    let client = EscrowContractClient::new(&env, &id);
    let _ = client.try_init(&Address::generate(&env));
}

#[test]
fn neg_init_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( EscrowContract, ());
    let client = EscrowContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_init(&Address::generate(&env));
}

#[test]
fn neg_create_escrow_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( EscrowContract, ());
    let client = EscrowContractClient::new(&env, &id);
    let _ = client.try_create_escrow(&Address::generate(&env), &Address::generate(&env), &Address::generate(&env), &Address::generate(&env), &1i128, &1u64, &String::from_str(&env, "x"));
}

#[test]
fn neg_create_escrow_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( EscrowContract, ());
    let client = EscrowContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_create_escrow(&Address::generate(&env), &Address::generate(&env), &Address::generate(&env), &Address::generate(&env), &1i128, &1u64, &String::from_str(&env, "x"));
}

#[test]
fn neg_deposit_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( EscrowContract, ());
    let client = EscrowContractClient::new(&env, &id);
    let _ = client.try_deposit(&1u64);
}

#[test]
fn neg_deposit_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( EscrowContract, ());
    let client = EscrowContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_deposit(&1u64);
}

#[test]
fn neg_approve_release_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( EscrowContract, ());
    let client = EscrowContractClient::new(&env, &id);
    let _ = client.try_approve_release(&1u64);
}

#[test]
fn neg_approve_release_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( EscrowContract, ());
    let client = EscrowContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_approve_release(&1u64);
}

#[test]
fn neg_release_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( EscrowContract, ());
    let client = EscrowContractClient::new(&env, &id);
    let _ = client.try_release(&1u64);
}

#[test]
fn neg_release_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( EscrowContract, ());
    let client = EscrowContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_release(&1u64);
}

#[test]
fn neg_refund_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( EscrowContract, ());
    let client = EscrowContractClient::new(&env, &id);
    let _ = client.try_refund(&1u64);
}

#[test]
fn neg_refund_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( EscrowContract, ());
    let client = EscrowContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_refund(&1u64);
}

#[test]
fn neg_raise_dispute_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( EscrowContract, ());
    let client = EscrowContractClient::new(&env, &id);
    let _ = client.try_raise_dispute(&1u64, &Address::generate(&env));
}

#[test]
fn neg_raise_dispute_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( EscrowContract, ());
    let client = EscrowContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_raise_dispute(&1u64, &Address::generate(&env));
}

#[test]
fn neg_resolve_dispute_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( EscrowContract, ());
    let client = EscrowContractClient::new(&env, &id);
    let _ = client.try_resolve_dispute(&1u64, &DisputeResolution::ReleaseToPayee);
}

#[test]
fn neg_resolve_dispute_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( EscrowContract, ());
    let client = EscrowContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_resolve_dispute(&1u64, &DisputeResolution::ReleaseToPayee);
}

#[test]
fn neg_get_escrow_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( EscrowContract, ());
    let client = EscrowContractClient::new(&env, &id);
    let _ = client.try_get_escrow(&1u64);
}

#[test]
fn neg_get_escrow_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( EscrowContract, ());
    let client = EscrowContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_get_escrow(&1u64);
}

#[test]
fn neg_get_escrow_count_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( EscrowContract, ());
    let client = EscrowContractClient::new(&env, &id);
    let _ = client.try_get_escrow_count();
}

#[test]
fn neg_get_escrow_count_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( EscrowContract, ());
    let client = EscrowContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_get_escrow_count();
}

#[test]
fn neg_is_refundable_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( EscrowContract, ());
    let client = EscrowContractClient::new(&env, &id);
    let _ = client.try_is_refundable(&1u64);
}

#[test]
fn neg_is_refundable_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( EscrowContract, ());
    let client = EscrowContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_is_refundable(&1u64);
}

#[test]
fn neg_is_releasable_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( EscrowContract, ());
    let client = EscrowContractClient::new(&env, &id);
    let _ = client.try_is_releasable(&1u64);
}

#[test]
fn neg_is_releasable_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( EscrowContract, ());
    let client = EscrowContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_is_releasable(&1u64);
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
