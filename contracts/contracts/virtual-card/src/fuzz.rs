//! Property-based tests for the agent spend-cap contract.

#![cfg(test)]
extern crate std;

use proptest::prelude::*;
use soroban_sdk::{
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
