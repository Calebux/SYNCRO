#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};
use super::*;


#[test]
fn neg_init_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( LoyaltyRewardsContract, ());
    let client = LoyaltyRewardsContractClient::new(&env, &id);
    let _ = client.try_init(&Address::generate(&env), &Address::generate(&env));
}

#[test]
fn neg_init_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( LoyaltyRewardsContract, ());
    let client = LoyaltyRewardsContractClient::new(&env, &id);
    client.init(&Address::generate(&env), &Address::generate(&env));
    let _ = client.try_init(&Address::generate(&env), &Address::generate(&env));
}

#[test]
fn neg_set_paused_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( LoyaltyRewardsContract, ());
    let client = LoyaltyRewardsContractClient::new(&env, &id);
    let _ = client.try_set_paused(&true);
}

#[test]
fn neg_set_paused_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( LoyaltyRewardsContract, ());
    let client = LoyaltyRewardsContractClient::new(&env, &id);
    client.init(&Address::generate(&env), &Address::generate(&env));
    let _ = client.try_set_paused(&true);
}

#[test]
fn neg_set_renewal_caller_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( LoyaltyRewardsContract, ());
    let client = LoyaltyRewardsContractClient::new(&env, &id);
    let _ = client.try_set_renewal_caller(&Address::generate(&env));
}

#[test]
fn neg_set_renewal_caller_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( LoyaltyRewardsContract, ());
    let client = LoyaltyRewardsContractClient::new(&env, &id);
    client.init(&Address::generate(&env), &Address::generate(&env));
    let _ = client.try_set_renewal_caller(&Address::generate(&env));
}

#[test]
fn neg_accrue_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( LoyaltyRewardsContract, ());
    let client = LoyaltyRewardsContractClient::new(&env, &id);
    let _ = client.try_accrue(&Address::generate(&env), &1u64, &1u32);
}

#[test]
fn neg_accrue_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( LoyaltyRewardsContract, ());
    let client = LoyaltyRewardsContractClient::new(&env, &id);
    client.init(&Address::generate(&env), &Address::generate(&env));
    let _ = client.try_accrue(&Address::generate(&env), &1u64, &1u32);
}

#[test]
fn neg_miss_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( LoyaltyRewardsContract, ());
    let client = LoyaltyRewardsContractClient::new(&env, &id);
    let _ = client.try_miss(&Address::generate(&env), &1u64);
}

#[test]
fn neg_miss_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( LoyaltyRewardsContract, ());
    let client = LoyaltyRewardsContractClient::new(&env, &id);
    client.init(&Address::generate(&env), &Address::generate(&env));
    let _ = client.try_miss(&Address::generate(&env), &1u64);
}

#[test]
fn neg_redeem_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( LoyaltyRewardsContract, ());
    let client = LoyaltyRewardsContractClient::new(&env, &id);
    let _ = client.try_redeem(&Address::generate(&env), &1i128);
}

#[test]
fn neg_redeem_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( LoyaltyRewardsContract, ());
    let client = LoyaltyRewardsContractClient::new(&env, &id);
    client.init(&Address::generate(&env), &Address::generate(&env));
    let _ = client.try_redeem(&Address::generate(&env), &1i128);
}

#[test]
fn neg_balance_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( LoyaltyRewardsContract, ());
    let client = LoyaltyRewardsContractClient::new(&env, &id);
    let _ = client.try_balance(&Address::generate(&env));
}

#[test]
fn neg_balance_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( LoyaltyRewardsContract, ());
    let client = LoyaltyRewardsContractClient::new(&env, &id);
    client.init(&Address::generate(&env), &Address::generate(&env));
    let _ = client.try_balance(&Address::generate(&env));
}

#[test]
fn neg_account_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( LoyaltyRewardsContract, ());
    let client = LoyaltyRewardsContractClient::new(&env, &id);
    let _ = client.try_account(&Address::generate(&env));
}

#[test]
fn neg_account_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( LoyaltyRewardsContract, ());
    let client = LoyaltyRewardsContractClient::new(&env, &id);
    client.init(&Address::generate(&env), &Address::generate(&env));
    let _ = client.try_account(&Address::generate(&env));
}

#[test]
fn neg_streak_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( LoyaltyRewardsContract, ());
    let client = LoyaltyRewardsContractClient::new(&env, &id);
    let _ = client.try_streak(&Address::generate(&env));
}

#[test]
fn neg_streak_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( LoyaltyRewardsContract, ());
    let client = LoyaltyRewardsContractClient::new(&env, &id);
    client.init(&Address::generate(&env), &Address::generate(&env));
    let _ = client.try_streak(&Address::generate(&env));
}

#[test]
fn neg_is_paused_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( LoyaltyRewardsContract, ());
    let client = LoyaltyRewardsContractClient::new(&env, &id);
    let _ = client.try_is_paused();
}

#[test]
fn neg_is_paused_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( LoyaltyRewardsContract, ());
    let client = LoyaltyRewardsContractClient::new(&env, &id);
    client.init(&Address::generate(&env), &Address::generate(&env));
    let _ = client.try_is_paused();
}

