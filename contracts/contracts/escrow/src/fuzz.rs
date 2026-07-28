#![cfg(test)]
extern crate std;

use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, EnvTestConfig, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, String,
};
use std::panic::{catch_unwind, AssertUnwindSafe};

use super::{DisputeResolution, EscrowContract, EscrowContractClient, EscrowState};

fn fuzz_env() -> Env {
    Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
        ..EnvTestConfig::default()
    })
}

fn fuzz_setup() -> (Env, Address, Address, Address, Address, TokenClient<'static>) {
    let env = fuzz_env();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let arbiter = Address::generate(&env);

    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_addr = sac.address();
    let token = TokenClient::new(&env, &token_addr);
    let asset_client = StellarAssetClient::new(&env, &token_addr);
    asset_client.mint(&payer, &100_000_000_000i128);

    (env, payer, payee, arbiter, token_addr, token)
}

fn register_escrow(env: &Env) -> EscrowContractClient<'static> {
    let contract_id = env.register_contract(None, EscrowContract);
    EscrowContractClient::new(env, &contract_id)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(8))]

    #[test]
    fn fuzz_deposit_with_random_amounts(amount in 1i128..=50_000_000_000i128) {
        let (env, payer, payee, arbiter, token, token_client) = fuzz_setup();
        let escrow = register_escrow(&env);
        let admin = Address::generate(&env);
        escrow.init(&admin);

        let expiry = env.ledger().timestamp() + 86_400u64;
        let desc = String::from_str(&env, "fuzz");

        let payer_balance_before = token_client.balance(&payer);
        let id = escrow.create_escrow(
            &payer, &payee, &arbiter, &token, &amount, &expiry, &desc,
        );

        escrow.deposit(&id);
        let agreement = escrow.get_escrow(&id);
        prop_assert_eq!(agreement.deposited, amount);
        prop_assert_eq!(agreement.state, EscrowState::Funded);
        prop_assert_eq!(token_client.balance(&payer), payer_balance_before - amount);
    }

    #[test]
    fn fuzz_concurrent_deposit_rejected(amount in 1i128..=10_000_000_000i128) {
        let (env, payer, payee, arbiter, token, _token_client) = fuzz_setup();
        let escrow = register_escrow(&env);
        let admin = Address::generate(&env);
        escrow.init(&admin);

        let expiry = env.ledger().timestamp() + 86_400u64;
        let desc = String::from_str(&env, "fuzz");

        let id = escrow.create_escrow(
            &payer, &payee, &arbiter, &token, &amount, &expiry, &desc,
        );
        escrow.deposit(&id);

        let result = catch_unwind(AssertUnwindSafe(|| {
            escrow.deposit(&id);
        }));
        prop_assert!(result.is_err(), "double deposit must panic with AlreadyFunded");

        let agreement = escrow.get_escrow(&id);
        prop_assert_eq!(agreement.deposited, amount);
        prop_assert_eq!(agreement.state, EscrowState::Funded);
    }

    #[test]
    fn fuzz_deposit_refund_conservation(amount in 1i128..=10_000_000_000i128) {
        let (env, payer, payee, arbiter, token, token_client) = fuzz_setup();
        let escrow = register_escrow(&env);
        let admin = Address::generate(&env);
        escrow.init(&admin);

        let expiry = env.ledger().timestamp() + 86_400u64;
        let desc = String::from_str(&env, "fuzz");
        let balance_before = token_client.balance(&payer);

        let id = escrow.create_escrow(
            &payer, &payee, &arbiter, &token, &amount, &expiry, &desc,
        );
        escrow.deposit(&id);
        escrow.refund(&id);

        prop_assert_eq!(token_client.balance(&payer), balance_before);
        prop_assert_eq!(escrow.get_escrow(&id).state, EscrowState::Refunded);
    }

    #[test]
    fn fuzz_invalid_amounts_rejected(amount in -1_000_000i128..=0i128) {
        let (env, payer, payee, arbiter, token, _token_client) = fuzz_setup();
        let escrow = register_escrow(&env);
        let admin = Address::generate(&env);
        escrow.init(&admin);

        let expiry = env.ledger().timestamp() + 86_400u64;
        let desc = String::from_str(&env, "fuzz");

        let result = catch_unwind(AssertUnwindSafe(|| {
            escrow.create_escrow(
                &payer, &payee, &arbiter, &token, &amount, &expiry, &desc,
            );
        }));
        prop_assert!(result.is_err(), "non-positive amount must panic");
    }

    #[test]
    fn fuzz_unauthorized_dispute_rejected(amount in 1i128..=1_000_000_000i128) {
        let (env, payer, payee, arbiter, token, _token_client) = fuzz_setup();
        let escrow = register_escrow(&env);
        let admin = Address::generate(&env);
        escrow.init(&admin);

        let expiry = env.ledger().timestamp() + 86_400u64;
        let desc = String::from_str(&env, "fuzz");

        let id = escrow.create_escrow(
            &payer, &payee, &arbiter, &token, &amount, &expiry, &desc,
        );
        escrow.deposit(&id);

        let stranger = Address::generate(&env);
        let result = catch_unwind(AssertUnwindSafe(|| {
            escrow.raise_dispute(&id, &stranger);
        }));
        prop_assert!(result.is_err(), "unauthorized dispute must panic");

        prop_assert_eq!(escrow.get_escrow(&id).state, EscrowState::Funded);
    }

    // ── Partial Split Fuzz Tests ─────────────────────────────────

    #[test]
    fn fuzz_partial_split_conserves_funds(
        amount in 1i128..=10_000_000_000i128,
        payee_basis_points in 0u32..=10000u32
    ) {
        let (env, payer, payee, arbiter, token, token_client) = fuzz_setup();
        let escrow = register_escrow(&env);
        let admin = Address::generate(&env);
        escrow.init(&admin);

        let expiry = env.ledger().timestamp() + 86_400u64;
        let desc = String::from_str(&env, "fuzz");

        let id = escrow.create_escrow(
            &payer, &payee, &arbiter, &token, &amount, &expiry, &desc,
        );
        escrow.deposit(&id);
        escrow.raise_dispute(&id, &payer);

        let payer_balance_before = token_client.balance(&payer);
        let payee_balance_before = token_client.balance(&payee);

        escrow.resolve_dispute(&id, &DisputeResolution::PartialSplit(payee_basis_points));

        let payer_balance_after = token_client.balance(&payer);
        let payee_balance_after = token_client.balance(&payee);

        let payee_received = payee_balance_after - payee_balance_before;
        let payer_received = payer_balance_after - payer_balance_before;

        // Critical: total must be conserved
        prop_assert_eq!(payee_received + payer_received, amount, 
            "Fund conservation violated: payee got {}, payer got {}, total was {}", 
            payee_received, payer_received, amount);

        // Verify payee received approximately the correct percentage
        let expected_payee = (amount * payee_basis_points as i128) / 10000;
        prop_assert_eq!(payee_received, expected_payee,
            "Payee should receive {}% = {}, but got {}", 
            payee_basis_points as f64 / 100.0, expected_payee, payee_received);
    }

    #[test]
    fn fuzz_partial_split_invalid_basis_points(
        amount in 1i128..=1_000_000_000i128,
        invalid_bp in 10001u32..=100000u32
    ) {
        let (env, payer, payee, arbiter, token, _token_client) = fuzz_setup();
        let escrow = register_escrow(&env);
        let admin = Address::generate(&env);
        escrow.init(&admin);

        let expiry = env.ledger().timestamp() + 86_400u64;
        let desc = String::from_str(&env, "fuzz");

        let id = escrow.create_escrow(
            &payer, &payee, &arbiter, &token, &amount, &expiry, &desc,
        );
        escrow.deposit(&id);
        escrow.raise_dispute(&id, &payer);

        let result = catch_unwind(AssertUnwindSafe(|| {
            escrow.resolve_dispute(&id, &DisputeResolution::PartialSplit(invalid_bp));
        }));

        prop_assert!(result.is_err(), "basis points > 10000 must panic");
        prop_assert_eq!(escrow.get_escrow(&id).state, EscrowState::Disputed);
    }

    #[test]
    fn fuzz_partial_split_boundary_conditions(
        amount in 1i128..=10_000_000_000i128
    ) {
        let (env, payer, payee, arbiter, token, token_client) = fuzz_setup();
        let escrow = register_escrow(&env);
        let admin = Address::generate(&env);
        escrow.init(&admin);

        let expiry = env.ledger().timestamp() + 86_400u64;
        let desc = String::from_str(&env, "fuzz");

        // Test boundary: 0% to payee (all to payer)
        let id1 = escrow.create_escrow(
            &payer, &payee, &arbiter, &token, &amount, &expiry, &desc,
        );
        escrow.deposit(&id1);
        escrow.raise_dispute(&id1, &payer);

        let payer_balance_before = token_client.balance(&payer);
        let payee_balance_before = token_client.balance(&payee);

        escrow.resolve_dispute(&id1, &DisputeResolution::PartialSplit(0));

        let payee_received = token_client.balance(&payee) - payee_balance_before;
        let payer_received = token_client.balance(&payer) - payer_balance_before;

        prop_assert_eq!(payee_received, 0i128);
        prop_assert_eq!(payer_received, amount);

        // Test boundary: 100% to payee
        let id2 = escrow.create_escrow(
            &payer, &payee, &arbiter, &token, &amount, &(expiry + 1000), &desc,
        );
        escrow.deposit(&id2);
        escrow.raise_dispute(&id2, &payer);

        let payer_balance_before2 = token_client.balance(&payer);
        let payee_balance_before2 = token_client.balance(&payee);

        escrow.resolve_dispute(&id2, &DisputeResolution::PartialSplit(10000));

        let payee_received2 = token_client.balance(&payee) - payee_balance_before2;
        let payer_received2 = token_client.balance(&payer) - payer_balance_before2;

        prop_assert_eq!(payee_received2, amount);
        prop_assert_eq!(payer_received2, 0i128);
    }
}
