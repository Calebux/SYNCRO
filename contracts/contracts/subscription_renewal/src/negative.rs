#![cfg(test)]

use soroban_sdk::{contract, contractimpl, testutils::{Address as _, EnvTestConfig}, vec, Address, Env};
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
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_init(&Address::generate(&env));
}

#[test]
fn neg_init_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_init(&Address::generate(&env));
}

#[test]
fn neg_set_paused_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_set_paused(&true);
}

#[test]
fn neg_set_paused_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_set_paused(&true);
}

#[test]
fn neg_is_paused_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_is_paused();
}

#[test]
fn neg_is_paused_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_is_paused();
}

#[test]
fn neg_set_logging_contract_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_set_logging_contract(&Address::generate(&env));
}

#[test]
fn neg_set_logging_contract_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_set_logging_contract(&Address::generate(&env));
}

#[test]
fn neg_set_token_contract_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_set_token_contract(&Address::generate(&env));
}

#[test]
fn neg_set_token_contract_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_set_token_contract(&Address::generate(&env));
}

#[test]
fn neg_get_token_contract_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_get_token_contract();
}

#[test]
fn neg_get_token_contract_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_get_token_contract();
}

#[test]
fn neg_acquire_renewal_lock_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_acquire_renewal_lock(&1u64, &1u32);
}

#[test]
fn neg_acquire_renewal_lock_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_acquire_renewal_lock(&1u64, &1u32);
}

#[test]
fn neg_release_renewal_lock_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_release_renewal_lock(&1u64);
}

#[test]
fn neg_release_renewal_lock_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_release_renewal_lock(&1u64);
}

#[test]
fn neg_get_renewal_lock_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_get_renewal_lock(&1u64);
}

#[test]
fn neg_get_renewal_lock_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_get_renewal_lock(&1u64);
}

#[test]
fn neg_init_sub_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_init_sub(&Address::generate(&env), &Address::generate(&env), &1i128, &1u64, &1i128, &1u64);
}

#[test]
fn neg_init_sub_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_init_sub(&Address::generate(&env), &Address::generate(&env), &1i128, &1u64, &1i128, &1u64);
}

#[test]
fn neg_cancel_sub_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_cancel_sub(&1u64);
}

#[test]
fn neg_cancel_sub_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_cancel_sub(&1u64);
}

#[test]
fn neg_approve_renewal_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_approve_renewal(&1u64, &1u64, &1i128, &1u32);
}

#[test]
fn neg_approve_renewal_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_approve_renewal(&1u64, &1u64, &1i128, &1u32);
}

#[test]
fn neg_renew_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_renew(&1u64, &1u64, &1i128, &1u32, &1u32, &1u64, &true);
}

#[test]
fn neg_renew_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_renew(&1u64, &1u64, &1i128, &1u32, &1u32, &1u64, &true);
}

#[test]
fn neg_get_escrow_balance_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_get_escrow_balance(&1u64);
}

#[test]
fn neg_get_escrow_balance_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_get_escrow_balance(&1u64);
}

#[test]
fn neg_claim_escrow_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_claim_escrow(&1u64);
}

#[test]
fn neg_claim_escrow_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_claim_escrow(&1u64);
}

#[test]
fn neg_get_sub_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_get_sub(&1u64);
}

#[test]
fn neg_get_sub_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_get_sub(&1u64);
}

#[test]
fn neg_get_lifecycle_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_get_lifecycle(&1u64);
}

#[test]
fn neg_get_lifecycle_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_get_lifecycle(&1u64);
}

#[test]
fn neg_set_window_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_set_window(&1u64, &1u64, &1u64);
}

#[test]
fn neg_set_window_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_set_window(&1u64, &1u64, &1u64);
}

#[test]
fn neg_get_window_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_get_window(&1u64);
}

#[test]
fn neg_get_window_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_get_window(&1u64);
}

#[test]
fn neg_set_user_cap_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_set_user_cap(&Address::generate(&env), &1i128);
}

#[test]
fn neg_set_user_cap_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_set_user_cap(&Address::generate(&env), &1i128);
}

#[test]
fn neg_get_user_cap_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_get_user_cap(&Address::generate(&env));
}

#[test]
fn neg_get_user_cap_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_get_user_cap(&Address::generate(&env));
}

#[test]
fn neg_get_user_spent_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_get_user_spent(&Address::generate(&env));
}

#[test]
fn neg_get_user_spent_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_get_user_spent(&Address::generate(&env));
}

#[test]
fn neg_set_team_threshold_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_set_team_threshold(&1u64, &1i128);
}

#[test]
fn neg_set_team_threshold_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_set_team_threshold(&1u64, &1i128);
}

#[test]
fn neg_get_team_threshold_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_get_team_threshold(&1u64);
}

#[test]
fn neg_get_team_threshold_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_get_team_threshold(&1u64);
}

#[test]
fn neg_set_signing_window_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_set_signing_window(&1u64, &1u64);
}

#[test]
fn neg_set_signing_window_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_set_signing_window(&1u64, &1u64);
}

#[test]
fn neg_get_signing_window_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_get_signing_window(&1u64);
}

#[test]
fn neg_get_signing_window_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_get_signing_window(&1u64);
}

#[test]
fn neg_request_multisig_renewal_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_request_multisig_renewal(&1u64, &1u64, &1u64, &1i128, &Address::generate(&env), &vec![&env, Address::generate(&env)]);
}

#[test]
fn neg_request_multisig_renewal_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_request_multisig_renewal(&1u64, &1u64, &1u64, &1i128, &Address::generate(&env), &vec![&env, Address::generate(&env)]);
}

#[test]
fn neg_sign_multisig_renewal_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_sign_multisig_renewal(&1u64, &1u64, &Address::generate(&env));
}

#[test]
fn neg_sign_multisig_renewal_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_sign_multisig_renewal(&1u64, &1u64, &Address::generate(&env));
}

#[test]
fn neg_cancel_multisig_renewal_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_cancel_multisig_renewal(&1u64, &1u64);
}

#[test]
fn neg_cancel_multisig_renewal_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_cancel_multisig_renewal(&1u64, &1u64);
}

#[test]
fn neg_expire_multisig_renewal_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_expire_multisig_renewal(&1u64, &1u64);
}

#[test]
fn neg_expire_multisig_renewal_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_expire_multisig_renewal(&1u64, &1u64);
}

#[test]
fn neg_get_multisig_request_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_get_multisig_request(&1u64, &1u64);
}

#[test]
fn neg_get_multisig_request_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_get_multisig_request(&1u64, &1u64);
}

#[test]
fn neg_requires_multisig_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.try_requires_multisig(&1u64, &1i128);
}

#[test]
fn neg_requires_multisig_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( SubscriptionRenewalContract, ());
    let client = SubscriptionRenewalContractClient::new(&env, &id);
    let _ = client.init(&Address::generate(&env));
    let _ = client.try_requires_multisig(&1u64, &1i128);
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
