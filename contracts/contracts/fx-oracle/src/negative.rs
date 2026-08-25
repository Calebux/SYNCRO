#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String};
use super::*;


#[test]
fn neg_init_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &id);
    let _ = client.try_init(&Address::generate(&env));
}

#[test]
fn neg_init_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_init(&Address::generate(&env));
}

#[test]
fn neg_get_admin_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &id);
    let _ = client.try_get_admin();
}

#[test]
fn neg_get_admin_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_get_admin();
}

#[test]
fn neg_is_paused_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &id);
    let _ = client.try_is_paused();
}

#[test]
fn neg_is_paused_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_is_paused();
}

#[test]
fn neg_set_paused_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &id);
    let _ = client.try_set_paused(&true);
}

#[test]
fn neg_set_paused_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_set_paused(&true);
}

#[test]
fn neg_add_signer_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &id);
    let _ = client.try_add_signer(&Address::generate(&env));
}

#[test]
fn neg_add_signer_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_add_signer(&Address::generate(&env));
}

#[test]
fn neg_remove_signer_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &id);
    let _ = client.try_remove_signer(&Address::generate(&env));
}

#[test]
fn neg_remove_signer_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_remove_signer(&Address::generate(&env));
}

#[test]
fn neg_is_signer_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &id);
    let _ = client.try_is_signer(&Address::generate(&env));
}

#[test]
fn neg_is_signer_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_is_signer(&Address::generate(&env));
}

#[test]
fn neg_get_signers_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &id);
    let _ = client.try_get_signers();
}

#[test]
fn neg_get_signers_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_get_signers();
}

#[test]
fn neg_set_staleness_bound_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &id);
    let _ = client.try_set_staleness_bound(&1u64);
}

#[test]
fn neg_set_staleness_bound_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_set_staleness_bound(&1u64);
}

#[test]
fn neg_get_staleness_bound_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &id);
    let _ = client.try_get_staleness_bound();
}

#[test]
fn neg_get_staleness_bound_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_get_staleness_bound();
}

#[test]
fn neg_update_rate_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &id);
    let _ = client.try_update_rate(&String::from_str(&env, "x"), &String::from_str(&env, "x"), &1i128, &1u64, &Address::generate(&env));
}

#[test]
fn neg_update_rate_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_update_rate(&String::from_str(&env, "x"), &String::from_str(&env, "x"), &1i128, &1u64, &Address::generate(&env));
}

#[test]
fn neg_get_rate_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &id);
    let _ = client.try_get_rate(&String::from_str(&env, "x"), &String::from_str(&env, "x"));
}

#[test]
fn neg_get_rate_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_get_rate(&String::from_str(&env, "x"), &String::from_str(&env, "x"));
}

#[test]
fn neg_validate_rate_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &id);
    let _ = client.try_validate_rate(&String::from_str(&env, "x"), &String::from_str(&env, "x"));
}

#[test]
fn neg_validate_rate_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_validate_rate(&String::from_str(&env, "x"), &String::from_str(&env, "x"));
}

#[test]
fn neg_convert_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &id);
    let _ = client.try_convert(&1i128, &String::from_str(&env, "x"), &String::from_str(&env, "x"));
}

#[test]
fn neg_convert_wrong_state() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register( FxOracleContract, ());
    let client = FxOracleContractClient::new(&env, &id);
    client.init(&Address::generate(&env));
    let _ = client.try_convert(&1i128, &String::from_str(&env, "x"), &String::from_str(&env, "x"));
}

