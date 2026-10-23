//! Negative / smoke tests for the agent spend-cap contract.
//! Each test calls exactly one method in one "wrong" state and records the outcome.

#![cfg(test)]

use soroban_sdk::{symbol_short, testutils::{Address as _, EnvTestConfig}, Address, Env};
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

// ── Scoped caps (issue #1658) ────────────────────────────────────────────────

#[test]
fn neg_issue_scoped_cap_unauthorized() {
    // No mock_all_auths: the principal never authorised the call.
    let env = test_env();
    let id = env.register(AgentSpendCapContract, ());
    let client = AgentSpendCapContractClient::new(&env, &id);
    let res = client.try_issue_scoped_cap(
        &Address::generate(&env),
        &Address::generate(&env),
        &10i128,
        &MIN_PERIOD_SECS,
        &Some(symbol_short!("inference")),
    );
    assert!(res.is_err());
}

#[test]
fn neg_issue_scoped_cap_wrong_state() {
    // The (principal, agent) pair is already at MAX_CAPS_PER_PAIR.
    let env = test_env();
    env.mock_all_auths();
    let id = env.register(AgentSpendCapContract, ());
    let client = AgentSpendCapContractClient::new(&env, &id);
    let principal = Address::generate(&env);
    let agent = Address::generate(&env);
    for _ in 0..MAX_CAPS_PER_PAIR {
        client.issue_cap(&principal, &agent, &10i128, &MIN_PERIOD_SECS);
    }
    let res = client.try_issue_scoped_cap(&principal, &agent, &10i128, &MIN_PERIOD_SECS, &None);
    assert_eq!(res, Err(Ok(SpendCapError::TooManyCaps)));
}

#[test]
fn neg_can_transact_scoped_unauthorized() {
    // Admission needs no auth; an unknown pair simply has no matching cap.
    let env = test_env();
    let id = env.register(AgentSpendCapContract, ());
    let client = AgentSpendCapContractClient::new(&env, &id);
    let res = client.try_can_transact_scoped(
        &Address::generate(&env),
        &Address::generate(&env),
        &None,
        &1i128,
    );
    assert_eq!(res, Err(Ok(SpendCapError::NoMatchingCap)));
}

#[test]
fn neg_can_transact_scoped_wrong_state() {
    // The only cap is scoped to a different key.
    let env = test_env();
    env.mock_all_auths();
    let id = env.register(AgentSpendCapContract, ());
    let client = AgentSpendCapContractClient::new(&env, &id);
    let principal = Address::generate(&env);
    let agent = Address::generate(&env);
    client.issue_scoped_cap(
        &principal,
        &agent,
        &10i128,
        &MIN_PERIOD_SECS,
        &Some(symbol_short!("inference")),
    );
    let res = client.try_can_transact_scoped(
        &principal,
        &agent,
        &Some(symbol_short!("storage")),
        &1i128,
    );
    assert_eq!(res, Err(Ok(SpendCapError::NoMatchingCap)));
}

#[test]
fn neg_get_cap_scope_unauthorized() {
    let env = test_env();
    let id = env.register(AgentSpendCapContract, ());
    let client = AgentSpendCapContractClient::new(&env, &id);
    assert_eq!(client.get_cap_scope(&1u64), None);
}

#[test]
fn neg_get_cap_scope_wrong_state() {
    // Unknown cap id: no scope.
    let env = test_env();
    let id = env.register(AgentSpendCapContract, ());
    let client = AgentSpendCapContractClient::new(&env, &id);
    assert_eq!(client.get_cap_scope(&u64::MAX), None);
}

#[test]
fn neg_get_pair_caps_unauthorized() {
    let env = test_env();
    let id = env.register(AgentSpendCapContract, ());
    let client = AgentSpendCapContractClient::new(&env, &id);
    let caps = client.get_pair_caps(&Address::generate(&env), &Address::generate(&env));
    assert_eq!(caps.len(), 0);
}

#[test]
fn neg_get_pair_caps_wrong_state() {
    // Caps of a different pair are not listed.
    let env = test_env();
    env.mock_all_auths();
    let id = env.register(AgentSpendCapContract, ());
    let client = AgentSpendCapContractClient::new(&env, &id);
    let principal = Address::generate(&env);
    client.issue_cap(&principal, &Address::generate(&env), &10i128, &MIN_PERIOD_SECS);
    let caps = client.get_pair_caps(&principal, &Address::generate(&env));
    assert_eq!(caps.len(), 0);
}
