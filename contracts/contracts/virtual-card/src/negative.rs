//! Negative / smoke tests for the agent spend-cap contract.
//! Each test calls exactly one method in one "wrong" state and records the outcome.

#![cfg(test)]

use soroban_sdk::{testutils::{Address as _, EnvTestConfig}, Address, Env};
use super::*;

fn test_env() -> Env {
    Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
        ..EnvTestConfig::default()
    })
}

// ── issue_cap ────────────────────────────────────────────────────────────────

#[test]
fn neg_issue_cap_zero_allowance() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register(AgentSpendCapContract, ());
    let client = AgentSpendCapContractClient::new(&env, &id);
    let _ = client.try_issue_cap(
        &Address::generate(&env),
        &Address::generate(&env),
        &0i128,
        &MIN_PERIOD_SECS,
    );
}

#[test]
fn neg_issue_cap_period_too_short() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register(AgentSpendCapContract, ());
    let client = AgentSpendCapContractClient::new(&env, &id);
    let _ = client.try_issue_cap(
        &Address::generate(&env),
        &Address::generate(&env),
        &100i128,
        &(MIN_PERIOD_SECS - 1),
    );
}

#[test]
fn neg_issue_cap_period_too_long() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register(AgentSpendCapContract, ());
    let client = AgentSpendCapContractClient::new(&env, &id);
    let _ = client.try_issue_cap(
        &Address::generate(&env),
        &Address::generate(&env),
        &100i128,
        &(MAX_PERIOD_SECS + 1),
    );
}

// ── can_transact ─────────────────────────────────────────────────────────────

#[test]
fn neg_can_transact_not_found() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register(AgentSpendCapContract, ());
    let client = AgentSpendCapContractClient::new(&env, &id);
    let _ = client.try_can_transact(&999u64, &1i128);
}

#[test]
fn neg_can_transact_zero_amount() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register(AgentSpendCapContract, ());
    let client = AgentSpendCapContractClient::new(&env, &id);
    let p = Address::generate(&env);
    let a = Address::generate(&env);
    let cap_id = client.issue_cap(&p, &a, &100i128, &MIN_PERIOD_SECS);
    let _ = client.try_can_transact(&cap_id, &0i128);
}

#[test]
fn neg_can_transact_exceeded() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register(AgentSpendCapContract, ());
    let client = AgentSpendCapContractClient::new(&env, &id);
    let p = Address::generate(&env);
    let a = Address::generate(&env);
    let cap_id = client.issue_cap(&p, &a, &100i128, &MIN_PERIOD_SECS);
    let _ = client.try_can_transact(&cap_id, &101i128);
}

#[test]
fn neg_can_transact_suspended() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register(AgentSpendCapContract, ());
    let client = AgentSpendCapContractClient::new(&env, &id);
    let p = Address::generate(&env);
    let a = Address::generate(&env);
    let cap_id = client.issue_cap(&p, &a, &100i128, &MIN_PERIOD_SECS);
    client.suspend_cap(&cap_id, &p);
    let _ = client.try_can_transact(&cap_id, &1i128);
}

// ── suspend_cap ───────────────────────────────────────────────────────────────

#[test]
fn neg_suspend_cap_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register(AgentSpendCapContract, ());
    let client = AgentSpendCapContractClient::new(&env, &id);
    let p = Address::generate(&env);
    let a = Address::generate(&env);
    let cap_id = client.issue_cap(&p, &a, &100i128, &MIN_PERIOD_SECS);
    let _ = client.try_suspend_cap(&cap_id, &Address::generate(&env));
}

#[test]
fn neg_suspend_cap_not_found() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register(AgentSpendCapContract, ());
    let client = AgentSpendCapContractClient::new(&env, &id);
    let _ = client.try_suspend_cap(&999u64, &Address::generate(&env));
}

// ── resume_cap ────────────────────────────────────────────────────────────────

#[test]
fn neg_resume_cap_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register(AgentSpendCapContract, ());
    let client = AgentSpendCapContractClient::new(&env, &id);
    let p = Address::generate(&env);
    let a = Address::generate(&env);
    let cap_id = client.issue_cap(&p, &a, &100i128, &MIN_PERIOD_SECS);
    client.suspend_cap(&cap_id, &p);
    let _ = client.try_resume_cap(&cap_id, &Address::generate(&env));
}

#[test]
fn neg_resume_cap_not_found() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register(AgentSpendCapContract, ());
    let client = AgentSpendCapContractClient::new(&env, &id);
    let _ = client.try_resume_cap(&999u64, &Address::generate(&env));
}

// ── top_up_cap ────────────────────────────────────────────────────────────────

#[test]
fn neg_top_up_cap_unauthorized() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register(AgentSpendCapContract, ());
    let client = AgentSpendCapContractClient::new(&env, &id);
    let p = Address::generate(&env);
    let a = Address::generate(&env);
    let cap_id = client.issue_cap(&p, &a, &100i128, &MIN_PERIOD_SECS);
    let _ = client.try_top_up_cap(&cap_id, &Address::generate(&env), &50i128);
}

#[test]
fn neg_top_up_cap_zero_amount() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register(AgentSpendCapContract, ());
    let client = AgentSpendCapContractClient::new(&env, &id);
    let p = Address::generate(&env);
    let a = Address::generate(&env);
    let cap_id = client.issue_cap(&p, &a, &100i128, &MIN_PERIOD_SECS);
    let _ = client.try_top_up_cap(&cap_id, &p, &0i128);
}

#[test]
fn neg_top_up_cap_not_found() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register(AgentSpendCapContract, ());
    let client = AgentSpendCapContractClient::new(&env, &id);
    let _ = client.try_top_up_cap(&999u64, &Address::generate(&env), &10i128);
}

// ── get_balance / get_cap ─────────────────────────────────────────────────────

#[test]
fn neg_get_balance_not_found() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register(AgentSpendCapContract, ());
    let client = AgentSpendCapContractClient::new(&env, &id);
    let _ = client.try_get_balance(&999u64);
}

#[test]
fn neg_get_cap_not_found() {
    let env = test_env();
    env.mock_all_auths();
    let id = env.register(AgentSpendCapContract, ());
    let client = AgentSpendCapContractClient::new(&env, &id);
    let _ = client.try_get_cap(&999u64);
}
