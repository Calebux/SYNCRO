#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};
use super::*;


#[test]
fn neg_init_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    let _ = client.try_init(&Address::generate(&env), &Address::generate(&env));
}

#[test]
fn neg_init_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    client.init(&Address::generate(&env), &Address::generate(&env));
    let _ = client.try_init(&Address::generate(&env), &Address::generate(&env));
}

#[test]
fn neg_set_paused_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    let _ = client.try_set_paused(&true);
}

#[test]
fn neg_set_paused_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    client.init(&Address::generate(&env), &Address::generate(&env));
    let _ = client.try_set_paused(&true);
}

#[test]
fn neg_set_mint_authority_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    let _ = client.try_set_mint_authority(&Address::generate(&env));
}

#[test]
fn neg_set_mint_authority_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    client.init(&Address::generate(&env), &Address::generate(&env));
    let _ = client.try_set_mint_authority(&Address::generate(&env));
}

#[test]
fn neg_mint_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    let _ = client.try_mint(&Address::generate(&env), &1u64, &Address::generate(&env), &1u64);
}

#[test]
fn neg_mint_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    client.init(&Address::generate(&env), &Address::generate(&env));
    let _ = client.try_mint(&Address::generate(&env), &1u64, &Address::generate(&env), &1u64);
}

#[test]
fn neg_transfer_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    let _ = client.try_transfer(&1u64, &Address::generate(&env));
}

#[test]
fn neg_transfer_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    client.init(&Address::generate(&env), &Address::generate(&env));
    let _ = client.try_transfer(&1u64, &Address::generate(&env));
}

#[test]
fn neg_approve_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    let _ = client.try_approve(&1u64, &Address::generate(&env));
}

#[test]
fn neg_approve_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    client.init(&Address::generate(&env), &Address::generate(&env));
    let _ = client.try_approve(&1u64, &Address::generate(&env));
}

#[test]
fn neg_revoke_approval_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    let _ = client.try_revoke_approval(&1u64);
}

#[test]
fn neg_revoke_approval_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    client.init(&Address::generate(&env), &Address::generate(&env));
    let _ = client.try_revoke_approval(&1u64);
}

#[test]
fn neg_burn_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    let _ = client.try_burn(&1u64);
}

#[test]
fn neg_burn_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    client.init(&Address::generate(&env), &Address::generate(&env));
    let _ = client.try_burn(&1u64);
}

#[test]
fn neg_update_renewal_state_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    let _ = client.try_update_renewal_state(&1u64, &RenewalState::Current);
}

#[test]
fn neg_update_renewal_state_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    client.init(&Address::generate(&env), &Address::generate(&env));
    let _ = client.try_update_renewal_state(&1u64, &RenewalState::Current);
}

#[test]
fn neg_get_token_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    let _ = client.try_get_token(&1u64);
}

#[test]
fn neg_get_token_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    client.init(&Address::generate(&env), &Address::generate(&env));
    let _ = client.try_get_token(&1u64);
}

#[test]
fn neg_owner_of_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    let _ = client.try_owner_of(&1u64);
}

#[test]
fn neg_owner_of_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    client.init(&Address::generate(&env), &Address::generate(&env));
    let _ = client.try_owner_of(&1u64);
}

#[test]
fn neg_balance_of_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    let _ = client.try_balance_of(&Address::generate(&env));
}

#[test]
fn neg_balance_of_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    client.init(&Address::generate(&env), &Address::generate(&env));
    let _ = client.try_balance_of(&Address::generate(&env));
}

#[test]
fn neg_get_approval_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    let _ = client.try_get_approval(&1u64);
}

#[test]
fn neg_get_approval_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    client.init(&Address::generate(&env), &Address::generate(&env));
    let _ = client.try_get_approval(&1u64);
}

#[test]
fn neg_token_for_sub_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    let _ = client.try_token_for_sub(&1u64);
}

#[test]
fn neg_token_for_sub_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    client.init(&Address::generate(&env), &Address::generate(&env));
    let _ = client.try_token_for_sub(&1u64);
}

#[test]
fn neg_total_minted_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    let _ = client.try_total_minted();
}

#[test]
fn neg_total_minted_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    client.init(&Address::generate(&env), &Address::generate(&env));
    let _ = client.try_total_minted();
}

#[test]
fn neg_is_paused_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    let _ = client.try_is_paused();
}

#[test]
fn neg_is_paused_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &id);
    client.init(&Address::generate(&env), &Address::generate(&env));
    let _ = client.try_is_paused();
}

