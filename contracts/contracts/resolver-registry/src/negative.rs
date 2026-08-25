#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};
use super::*;


#[test]
fn neg_init_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( ResolverRegistry, ());
    let client = ResolverRegistryClient::new(&env, &id);
    let _ = client.try_init(&Address::generate(&env), &1u32);
}

#[test]
fn neg_init_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( ResolverRegistry, ());
    let client = ResolverRegistryClient::new(&env, &id);
    client.init(&Address::generate(&env), &2u32);
    let _ = client.try_init(&Address::generate(&env), &1u32);
}

#[test]
fn neg_add_arbiter_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( ResolverRegistry, ());
    let client = ResolverRegistryClient::new(&env, &id);
    let _ = client.try_add_arbiter(&Address::generate(&env));
}

#[test]
fn neg_add_arbiter_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( ResolverRegistry, ());
    let client = ResolverRegistryClient::new(&env, &id);
    client.init(&Address::generate(&env), &2u32);
    let _ = client.try_add_arbiter(&Address::generate(&env));
}

#[test]
fn neg_remove_arbiter_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( ResolverRegistry, ());
    let client = ResolverRegistryClient::new(&env, &id);
    let _ = client.try_remove_arbiter(&Address::generate(&env));
}

#[test]
fn neg_remove_arbiter_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( ResolverRegistry, ());
    let client = ResolverRegistryClient::new(&env, &id);
    client.init(&Address::generate(&env), &2u32);
    let _ = client.try_remove_arbiter(&Address::generate(&env));
}

#[test]
fn neg_set_quorum_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( ResolverRegistry, ());
    let client = ResolverRegistryClient::new(&env, &id);
    let _ = client.try_set_quorum(&1u32);
}

#[test]
fn neg_set_quorum_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( ResolverRegistry, ());
    let client = ResolverRegistryClient::new(&env, &id);
    client.init(&Address::generate(&env), &2u32);
    let _ = client.try_set_quorum(&1u32);
}

#[test]
fn neg_open_case_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( ResolverRegistry, ());
    let client = ResolverRegistryClient::new(&env, &id);
    let _ = client.try_open_case(&Address::generate(&env), &Address::generate(&env), &1u64);
}

#[test]
fn neg_open_case_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( ResolverRegistry, ());
    let client = ResolverRegistryClient::new(&env, &id);
    client.init(&Address::generate(&env), &2u32);
    let _ = client.try_open_case(&Address::generate(&env), &Address::generate(&env), &1u64);
}

#[test]
fn neg_vote_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( ResolverRegistry, ());
    let client = ResolverRegistryClient::new(&env, &id);
    let _ = client.try_vote(&Address::generate(&env), &1u64, &1u32);
}

#[test]
fn neg_vote_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( ResolverRegistry, ());
    let client = ResolverRegistryClient::new(&env, &id);
    client.init(&Address::generate(&env), &2u32);
    let _ = client.try_vote(&Address::generate(&env), &1u64, &1u32);
}

#[test]
fn neg_get_case_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( ResolverRegistry, ());
    let client = ResolverRegistryClient::new(&env, &id);
    let _ = client.try_get_case(&1u64);
}

#[test]
fn neg_get_case_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( ResolverRegistry, ());
    let client = ResolverRegistryClient::new(&env, &id);
    client.init(&Address::generate(&env), &2u32);
    let _ = client.try_get_case(&1u64);
}

#[test]
fn neg_get_case_count_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( ResolverRegistry, ());
    let client = ResolverRegistryClient::new(&env, &id);
    let _ = client.try_get_case_count();
}

#[test]
fn neg_get_case_count_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( ResolverRegistry, ());
    let client = ResolverRegistryClient::new(&env, &id);
    client.init(&Address::generate(&env), &2u32);
    let _ = client.try_get_case_count();
}

#[test]
fn neg_get_quorum_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( ResolverRegistry, ());
    let client = ResolverRegistryClient::new(&env, &id);
    let _ = client.try_get_quorum();
}

#[test]
fn neg_get_quorum_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( ResolverRegistry, ());
    let client = ResolverRegistryClient::new(&env, &id);
    client.init(&Address::generate(&env), &2u32);
    let _ = client.try_get_quorum();
}

#[test]
fn neg_get_arbiters_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( ResolverRegistry, ());
    let client = ResolverRegistryClient::new(&env, &id);
    let _ = client.try_get_arbiters();
}

#[test]
fn neg_get_arbiters_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( ResolverRegistry, ());
    let client = ResolverRegistryClient::new(&env, &id);
    client.init(&Address::generate(&env), &2u32);
    let _ = client.try_get_arbiters();
}

#[test]
fn neg_is_arbiter_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( ResolverRegistry, ());
    let client = ResolverRegistryClient::new(&env, &id);
    let _ = client.try_is_arbiter(&Address::generate(&env));
}

#[test]
fn neg_is_arbiter_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( ResolverRegistry, ());
    let client = ResolverRegistryClient::new(&env, &id);
    client.init(&Address::generate(&env), &2u32);
    let _ = client.try_is_arbiter(&Address::generate(&env));
}

#[test]
fn neg_get_vote_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( ResolverRegistry, ());
    let client = ResolverRegistryClient::new(&env, &id);
    let _ = client.try_get_vote(&1u64, &Address::generate(&env));
}

#[test]
fn neg_get_vote_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( ResolverRegistry, ());
    let client = ResolverRegistryClient::new(&env, &id);
    client.init(&Address::generate(&env), &2u32);
    let _ = client.try_get_vote(&1u64, &Address::generate(&env));
}

