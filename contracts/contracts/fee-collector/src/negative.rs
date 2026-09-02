#![cfg(test)]

use soroban_sdk::{testutils::{Address as _, EnvTestConfig}, vec, Address, Env};
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
    let id = env.register( FeeCollector, ());
    let client = FeeCollectorClient::new(&env, &id);
    let _ = client.try_init(&Address::generate(&env), &vec![&env, Address::generate(&env)]);
}

#[test]
fn neg_init_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( FeeCollector, ());
    let client = FeeCollectorClient::new(&env, &id);
    client.init(&Address::generate(&env), &vec![&env, Address::generate(&env), Address::generate(&env)]);
    let _ = client.try_init(&Address::generate(&env), &vec![&env, Address::generate(&env)]);
}

#[test]
fn neg_deposit_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( FeeCollector, ());
    let client = FeeCollectorClient::new(&env, &id);
    let _ = client.try_deposit(&Address::generate(&env), &1i128);
}

#[test]
fn neg_deposit_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( FeeCollector, ());
    let client = FeeCollectorClient::new(&env, &id);
    client.init(&Address::generate(&env), &vec![&env, Address::generate(&env), Address::generate(&env)]);
    let _ = client.try_deposit(&Address::generate(&env), &1i128);
}

#[test]
fn neg_accrue_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( FeeCollector, ());
    let client = FeeCollectorClient::new(&env, &id);
    let _ = client.try_accrue(&Address::generate(&env), &1i128);
}

#[test]
fn neg_accrue_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( FeeCollector, ());
    let client = FeeCollectorClient::new(&env, &id);
    client.init(&Address::generate(&env), &vec![&env, Address::generate(&env), Address::generate(&env)]);
    let _ = client.try_accrue(&Address::generate(&env), &1i128);
}

#[test]
fn neg_request_withdrawal_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( FeeCollector, ());
    let client = FeeCollectorClient::new(&env, &id);
    let _ = client.try_request_withdrawal(&Address::generate(&env), &Address::generate(&env), &1i128);
}

#[test]
fn neg_request_withdrawal_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( FeeCollector, ());
    let client = FeeCollectorClient::new(&env, &id);
    client.init(&Address::generate(&env), &vec![&env, Address::generate(&env), Address::generate(&env)]);
    let _ = client.try_request_withdrawal(&Address::generate(&env), &Address::generate(&env), &1i128);
}

#[test]
fn neg_execute_withdrawal_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( FeeCollector, ());
    let client = FeeCollectorClient::new(&env, &id);
    let _ = client.try_execute_withdrawal(&Address::generate(&env), &1u64);
}

#[test]
fn neg_execute_withdrawal_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( FeeCollector, ());
    let client = FeeCollectorClient::new(&env, &id);
    client.init(&Address::generate(&env), &vec![&env, Address::generate(&env), Address::generate(&env)]);
    let _ = client.try_execute_withdrawal(&Address::generate(&env), &1u64);
}

#[test]
fn neg_get_balance_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( FeeCollector, ());
    let client = FeeCollectorClient::new(&env, &id);
    let _ = client.try_get_balance();
}

#[test]
fn neg_get_balance_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( FeeCollector, ());
    let client = FeeCollectorClient::new(&env, &id);
    client.init(&Address::generate(&env), &vec![&env, Address::generate(&env), Address::generate(&env)]);
    let _ = client.try_get_balance();
}

#[test]
fn neg_get_withdrawal_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( FeeCollector, ());
    let client = FeeCollectorClient::new(&env, &id);
    let _ = client.try_get_withdrawal(&1u64);
}

#[test]
fn neg_get_withdrawal_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( FeeCollector, ());
    let client = FeeCollectorClient::new(&env, &id);
    client.init(&Address::generate(&env), &vec![&env, Address::generate(&env), Address::generate(&env)]);
    let _ = client.try_get_withdrawal(&1u64);
}

#[test]
fn neg_get_guardians_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( FeeCollector, ());
    let client = FeeCollectorClient::new(&env, &id);
    let _ = client.try_get_guardians();
}

#[test]
fn neg_get_guardians_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( FeeCollector, ());
    let client = FeeCollectorClient::new(&env, &id);
    client.init(&Address::generate(&env), &vec![&env, Address::generate(&env), Address::generate(&env)]);
    let _ = client.try_get_guardians();
}

#[test]
fn neg_get_guardian_count_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( FeeCollector, ());
    let client = FeeCollectorClient::new(&env, &id);
    let _ = client.try_get_guardian_count();
}

#[test]
fn neg_get_guardian_count_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( FeeCollector, ());
    let client = FeeCollectorClient::new(&env, &id);
    client.init(&Address::generate(&env), &vec![&env, Address::generate(&env), Address::generate(&env)]);
    let _ = client.try_get_guardian_count();
}

#[test]
fn neg_set_guardians_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( FeeCollector, ());
    let client = FeeCollectorClient::new(&env, &id);
    let _ = client.try_set_guardians(&Address::generate(&env), &vec![&env, Address::generate(&env)]);
}

#[test]
fn neg_set_guardians_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( FeeCollector, ());
    let client = FeeCollectorClient::new(&env, &id);
    client.init(&Address::generate(&env), &vec![&env, Address::generate(&env), Address::generate(&env)]);
    let _ = client.try_set_guardians(&Address::generate(&env), &vec![&env, Address::generate(&env)]);
}

#[test]
fn neg_set_timelock_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( FeeCollector, ());
    let client = FeeCollectorClient::new(&env, &id);
    let _ = client.try_set_timelock(&Address::generate(&env), &1u64);
}

#[test]
fn neg_set_timelock_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( FeeCollector, ());
    let client = FeeCollectorClient::new(&env, &id);
    client.init(&Address::generate(&env), &vec![&env, Address::generate(&env), Address::generate(&env)]);
    let _ = client.try_set_timelock(&Address::generate(&env), &1u64);
}

#[test]
fn neg_get_timelock_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( FeeCollector, ());
    let client = FeeCollectorClient::new(&env, &id);
    let _ = client.try_get_timelock();
}

#[test]
fn neg_get_timelock_wrong_state() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( FeeCollector, ());
    let client = FeeCollectorClient::new(&env, &id);
    client.init(&Address::generate(&env), &vec![&env, Address::generate(&env), Address::generate(&env)]);
    let _ = client.try_get_timelock();
}

