//! Property-based tests for the agent spend-cap contract.

#![cfg(test)]
extern crate std;

use proptest::prelude::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, EnvTestConfig, Ledger},
    Address, Env,
};

use super::{AgentSpendCapContract, AgentSpendCapContractClient, CapStatus, SpendCapError, MIN_PERIOD_SECS};

fn fuzz_env() -> Env {
    Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
        ..EnvTestConfig::default()
    })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(8))]

    /// Issuing a cap with any positive allowance and a valid period must succeed,
    /// and get_balance must equal the full allowance (nothing consumed yet).
    #[test]
    fn fuzz_issue_fresh_balance_is_full_allowance(
        allowance in 1i128..=1_000_000_000i128,
        period_factor in 1u64..=100u64,
    ) {
        let env = fuzz_env();
        env.mock_all_auths();
        let principal = Address::generate(&env);
        let agent = Address::generate(&env);
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);
        let period = MIN_PERIOD_SECS * period_factor;

        let cap_id = client.issue_cap(&principal, &agent, &allowance, &period);
        prop_assert_eq!(client.get_balance(&cap_id), allowance);
    }

    /// can_transact must reduce remaining by exactly the amount on success.
    #[test]
    fn fuzz_can_transact_reduces_balance_exactly(
        allowance in 1i128..=1_000_000_000i128,
        spend in 1i128..=1_000_000_000i128,
    ) {
        let env = fuzz_env();
        env.mock_all_auths();
        let principal = Address::generate(&env);
        let agent = Address::generate(&env);
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let cap_id = client.issue_cap(&principal, &agent, &allowance, &MIN_PERIOD_SECS);

        if spend <= allowance {
            let remaining = client.can_transact(&cap_id, &spend);
            prop_assert_eq!(remaining, allowance - spend);
            prop_assert_eq!(client.get_balance(&cap_id), allowance - spend);
        } else {
            let result = client.try_can_transact(&cap_id, &spend);
            prop_assert_eq!(result, Err(Ok(SpendCapError::CapExceeded)));
            // Balance must be unchanged on failure.
            prop_assert_eq!(client.get_balance(&cap_id), allowance);
        }
    }

    /// After period rollover the full allowance is available again regardless of
    /// how much was consumed in the previous period (no carryover).
    #[test]
    fn fuzz_no_carryover_after_rollover(
        allowance in 100i128..=1_000_000i128,
        consumed in 0i128..=100i128,
        periods_skipped in 1u64..=10u64,
    ) {
        let env = fuzz_env();
        env.mock_all_auths();
        let principal = Address::generate(&env);
        let agent = Address::generate(&env);
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let cap_id = client.issue_cap(&principal, &agent, &allowance, &MIN_PERIOD_SECS);
        let to_consume = consumed.min(allowance);
        if to_consume > 0 {
            client.can_transact(&cap_id, &to_consume);
        }

        // Advance past the period.
        let now = env.ledger().timestamp();
        env.ledger().set_timestamp(now + MIN_PERIOD_SECS * periods_skipped + 1);

        // Full allowance available — NOT allowance + unconsumed.
        prop_assert_eq!(client.get_balance(&cap_id), allowance);
    }

    /// Sequential spends must conserve total: sum(successful spends) == initial - remaining.
    #[test]
    fn fuzz_sequential_spends_conserve_total(
        allowance in 1_000i128..=1_000_000i128,
        spends in prop::collection::vec(1i128..=200i128, 1..=8),
    ) {
        let env = fuzz_env();
        env.mock_all_auths();
        let principal = Address::generate(&env);
        let agent = Address::generate(&env);
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let cap_id = client.issue_cap(&principal, &agent, &allowance, &MIN_PERIOD_SECS);
        let mut total_spent = 0i128;

        for s in &spends {
            if *s <= allowance - total_spent {
                client.can_transact(&cap_id, s);
                total_spent += s;
            }
        }

        prop_assert_eq!(client.get_balance(&cap_id), allowance - total_spent);
    }

    /// Suspended cap must return CapSuspended (not CapExceeded) regardless of
    /// how much allowance remains.
    #[test]
    fn fuzz_suspended_always_returns_cap_suspended(
        allowance in 1i128..=1_000_000i128,
        amount in 1i128..=1_000_000i128,
    ) {
        let env = fuzz_env();
        env.mock_all_auths();
        let principal = Address::generate(&env);
        let agent = Address::generate(&env);
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let cap_id = client.issue_cap(&principal, &agent, &allowance, &MIN_PERIOD_SECS);
        client.suspend_cap(&cap_id, &principal);

        let result = client.try_can_transact(&cap_id, &amount);
        prop_assert_eq!(result, Err(Ok(SpendCapError::CapSuspended)),
            "suspended cap must return CapSuspended, not CapExceeded");
    }

    /// Only the principal may suspend/resume; any other address must get Unauthorized.
    #[test]
    fn fuzz_unauthorized_suspend_rejected(allowance in 1i128..=1_000_000i128) {
        let env = fuzz_env();
        env.mock_all_auths();
        let principal = Address::generate(&env);
        let agent = Address::generate(&env);
        let attacker = Address::generate(&env);
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let cap_id = client.issue_cap(&principal, &agent, &allowance, &MIN_PERIOD_SECS);
        let result = client.try_suspend_cap(&cap_id, &attacker);
        prop_assert_eq!(result, Err(Ok(SpendCapError::Unauthorized)));
        // Cap must still be active.
        prop_assert_eq!(client.get_cap(&cap_id).status, CapStatus::Active);
    }

    /// Cap IDs must be strictly sequential starting from 1.
    #[test]
    fn fuzz_cap_ids_sequential(n in 1u64..=10u64) {
        let env = fuzz_env();
        env.mock_all_auths();
        let principal = Address::generate(&env);
        let agent = Address::generate(&env);
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        for expected in 1..=n {
            let cap_id = client.issue_cap(&principal, &agent, &100_i128, &MIN_PERIOD_SECS);
            prop_assert_eq!(cap_id, expected);
        }
    }
}

// ── Scoped caps (issue #1658) ───────────────────────────────────────────────

proptest! {
    #![proptest_config(ProptestConfig::with_cases(8))]

    /// Spending under one scope never changes a cap of another scope, and the
    /// spent cap drops by exactly the amount (or the spend is rejected).
    #[test]
    fn fuzz_scoped_spend_is_isolated_between_scopes(
        inf_allowance in 1i128..=1_000_000i128,
        sto_allowance in 1i128..=1_000_000i128,
        spend in 1i128..=2_000_000i128,
    ) {
        let env = fuzz_env();
        env.mock_all_auths();
        let principal = Address::generate(&env);
        let agent = Address::generate(&env);
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let inference = Some(symbol_short!("inference"));
        let storage = Some(symbol_short!("storage"));
        let inf = client.issue_scoped_cap(&principal, &agent, &inf_allowance, &MIN_PERIOD_SECS, &inference);
        let sto = client.issue_scoped_cap(&principal, &agent, &sto_allowance, &MIN_PERIOD_SECS, &storage);

        if spend <= inf_allowance {
            let remaining = client.can_transact_scoped(&principal, &agent, &inference, &spend);
            prop_assert_eq!(remaining, inf_allowance - spend);
            prop_assert_eq!(client.get_balance(&inf), inf_allowance - spend);
        } else {
            let res = client.try_can_transact_scoped(&principal, &agent, &inference, &spend);
            prop_assert_eq!(res, Err(Ok(SpendCapError::CapExceeded)));
            prop_assert_eq!(client.get_balance(&inf), inf_allowance);
        }
        // The other scope is never touched.
        prop_assert_eq!(client.get_balance(&sto), sto_allowance);
    }

    /// An agent that exhausted one scope can still spend its full allowance in
    /// another scope.
    #[test]
    fn fuzz_exhausted_scope_does_not_block_other_scope(
        inf_allowance in 1i128..=1_000_000i128,
        sto_allowance in 1i128..=1_000_000i128,
    ) {
        let env = fuzz_env();
        env.mock_all_auths();
        let principal = Address::generate(&env);
        let agent = Address::generate(&env);
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let inference = Some(symbol_short!("inference"));
        let storage = Some(symbol_short!("storage"));
        client.issue_scoped_cap(&principal, &agent, &inf_allowance, &MIN_PERIOD_SECS, &inference);
        client.issue_scoped_cap(&principal, &agent, &sto_allowance, &MIN_PERIOD_SECS, &storage);

        client.can_transact_scoped(&principal, &agent, &inference, &inf_allowance);
        let res = client.try_can_transact_scoped(&principal, &agent, &inference, &1_i128);
        prop_assert_eq!(res, Err(Ok(SpendCapError::CapExceeded)));

        let remaining = client.can_transact_scoped(&principal, &agent, &storage, &sto_allowance);
        prop_assert_eq!(remaining, 0i128);
    }

    /// With an unscoped ceiling plus a scoped cap, a spend sequence is admitted
    /// exactly when it fits BOTH caps, and failed spends debit nothing.
    #[test]
    fn fuzz_unscoped_ceiling_and_scoped_cap_conserve_totals(
        global in 1i128..=10_000i128,
        scoped in 1i128..=10_000i128,
        spends in prop::collection::vec(1i128..=2_000i128, 1..=8),
    ) {
        let env = fuzz_env();
        env.mock_all_auths();
        let principal = Address::generate(&env);
        let agent = Address::generate(&env);
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let scope = Some(symbol_short!("inference"));
        let g = client.issue_scoped_cap(&principal, &agent, &global, &MIN_PERIOD_SECS, &None);
        let s = client.issue_scoped_cap(&principal, &agent, &scoped, &MIN_PERIOD_SECS, &scope);

        let mut total = 0i128;
        for amount in &spends {
            let fits = *amount <= global - total && *amount <= scoped - total;
            let res = client.try_can_transact_scoped(&principal, &agent, &scope, amount);
            if fits {
                total += amount;
                prop_assert_eq!(res, Ok(Ok((global - total).min(scoped - total))));
            } else {
                prop_assert_eq!(res, Err(Ok(SpendCapError::CapExceeded)));
            }
            prop_assert_eq!(client.get_balance(&g), global - total);
            prop_assert_eq!(client.get_balance(&s), scoped - total);
        }
    }

    /// `issue_scoped_cap(.., None)` is the same as `issue_cap`: unscoped, full
    /// balance, and spendable by id exactly as before.
    #[test]
    fn fuzz_unscoped_issue_matches_legacy_behaviour(
        allowance in 1i128..=1_000_000i128,
        spend in 1i128..=1_000_000i128,
    ) {
        let env = fuzz_env();
        env.mock_all_auths();
        let principal = Address::generate(&env);
        let agent = Address::generate(&env);
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let a = client.issue_cap(&principal, &agent, &allowance, &MIN_PERIOD_SECS);
        let b = client.issue_scoped_cap(&principal, &agent, &allowance, &MIN_PERIOD_SECS, &None);
        prop_assert_eq!(client.get_cap_scope(&a), None);
        prop_assert_eq!(client.get_cap_scope(&b), None);

        let ra = client.try_can_transact(&a, &spend);
        let rb = client.try_can_transact(&b, &spend);
        prop_assert_eq!(ra, rb);
    }
}
