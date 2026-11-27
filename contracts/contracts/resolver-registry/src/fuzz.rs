#![cfg(test)]
extern crate std;

use escrow::{EscrowContract, EscrowContractClient, EscrowState};
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, EnvTestConfig},
    token::StellarAssetClient,
    Address, Env, String,
};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::vec::Vec as StdVec;

use super::{CaseStatus, ResolverRegistry, ResolverRegistryClient};

const AMOUNT: i128 = 1_000_000_000;

fn fuzz_env() -> Env {
    Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
        ..EnvTestConfig::default()
    })
}

struct Ctx {
    registry: ResolverRegistryClient<'static>,
    escrow: EscrowContractClient<'static>,
    arbiters: StdVec<Address>,
}

fn setup(quorum: u32, num_arbiters: usize) -> Ctx {
    let env = fuzz_env();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);

    let registry_id = env.register(ResolverRegistry, ());
    let registry = ResolverRegistryClient::new(&env, &registry_id);
    registry.init(&admin, &quorum);

    let mut arbiters = StdVec::new();
    for _ in 0..num_arbiters {
        let a = Address::generate(&env);
        registry.add_arbiter(&a);
        arbiters.push(a);
    }

    let escrow_id_addr = env.register(EscrowContract, ());
    let escrow = EscrowContractClient::new(&env, &escrow_id_addr);
    escrow.init(&admin);

    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token = sac.address();
    StellarAssetClient::new(&env, &token).mint(&payer, &(AMOUNT * 2));

    let expiry = env.ledger().timestamp() + 86_400;
    let desc = String::from_str(&env, "fuzz");
    let id = escrow.create_escrow(
        &payer,
        &payee,
        &registry_id,
        &token,
        &AMOUNT,
        &expiry,
        &desc,
    );
    escrow.deposit(&id);
    escrow.raise_dispute(&id, &payer);

    Ctx {
        registry,
        escrow,
        arbiters,
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(12))]

    /// Casting exactly `quorum` identical votes resolves the case to that
    /// outcome and drives the real escrow into the matching terminal state.
    #[test]
    fn fuzz_quorum_resolves_escrow(
        quorum in 1u32..=4u32,
        outcome in 1u32..=2u32,
    ) {
        let n = quorum as usize + 1; // always enough arbiters to reach quorum
        let ctx = setup(quorum, n);
        // escrow_id is always 1 (single escrow per env).
        let case = ctx.registry.open_case(&ctx.arbiters[0], &ctx.escrow.address, &1);

        for i in 0..(quorum as usize) {
            ctx.registry.vote(&ctx.arbiters[i], &case, &outcome);
        }

        let resolved = ctx.registry.get_case(&case);
        prop_assert_eq!(resolved.status, CaseStatus::Resolved);
        prop_assert_eq!(resolved.outcome, outcome);

        let expected = if outcome == 1 { EscrowState::Released } else { EscrowState::Refunded };
        prop_assert_eq!(ctx.escrow.get_escrow(&1).state, expected);
    }

    /// Fewer than `quorum` votes never resolves the case and never touches the
    /// escrow, which stays disputed.
    #[test]
    fn fuzz_sub_quorum_never_resolves(
        quorum in 2u32..=4u32,
        outcome in 1u32..=2u32,
    ) {
        let n = quorum as usize + 1;
        let ctx = setup(quorum, n);
        let case = ctx.registry.open_case(&ctx.arbiters[0], &ctx.escrow.address, &1);

        for i in 0..(quorum as usize - 1) {
            ctx.registry.vote(&ctx.arbiters[i], &case, &outcome);
        }

        prop_assert_eq!(ctx.registry.get_case(&case).status, CaseStatus::Open);
        prop_assert_eq!(ctx.escrow.get_escrow(&1).state, EscrowState::Disputed);
    }

    /// An arbiter can never double-vote regardless of ordering.
    #[test]
    fn fuzz_no_double_vote(outcome in 1u32..=2u32) {
        let ctx = setup(3, 3);
        let case = ctx.registry.open_case(&ctx.arbiters[0], &ctx.escrow.address, &1);
        ctx.registry.vote(&ctx.arbiters[0], &case, &outcome);

        let result = catch_unwind(AssertUnwindSafe(|| {
            ctx.registry.vote(&ctx.arbiters[0], &case, &outcome);
        }));
        prop_assert!(result.is_err(), "double vote must panic");
        prop_assert_eq!(ctx.registry.get_case(&case).votes_release + ctx.registry.get_case(&case).votes_refund, 1);
    }
}
