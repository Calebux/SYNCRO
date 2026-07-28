#![cfg(test)]

use super::*;
use escrow::{EscrowContract, EscrowContractClient, EscrowState};
use soroban_sdk::{
    testutils::Address as _,
    token::StellarAssetClient,
    Address, Env, String,
};

const AMOUNT: i128 = 1_000_000_000;

struct Ctx {
    env: Env,
    registry: ResolverRegistryClient<'static>,
    registry_id: Address,
    escrow: EscrowContractClient<'static>,
    admin: Address,
    payer: Address,
    payee: Address,
    token: Address,
    arbiters: [Address; 3],
}

/// Wire up a registry that is the arbiter of a freshly funded, disputed escrow.
fn setup(quorum: u32) -> Ctx {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);

    // Registry with three arbiters.
    let registry_id = env.register(ResolverRegistry, ());
    let registry = ResolverRegistryClient::new(&env, &registry_id);
    registry.init(&admin, &quorum);
    let arbiters = [
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    ];
    for a in arbiters.iter() {
        registry.add_arbiter(a);
    }

    // Escrow whose arbiter is the registry contract itself.
    let escrow_id_addr = env.register(EscrowContract, ());
    let escrow = EscrowContractClient::new(&env, &escrow_id_addr);
    escrow.init(&admin);

    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token = sac.address();
    StellarAssetClient::new(&env, &token).mint(&payer, &(AMOUNT * 5));

    Ctx {
        env,
        registry,
        registry_id,
        escrow,
        admin,
        payer,
        payee,
        token,
        arbiters,
    }
}

/// Create → fund → dispute an escrow, returning its id.
fn disputed_escrow(ctx: &Ctx) -> u64 {
    let expiry = ctx.env.ledger().timestamp() + 86_400;
    let desc = String::from_str(&ctx.env, "arbitrated deal");
    let id = ctx.escrow.create_escrow(
        &ctx.payer,
        &ctx.payee,
        &ctx.registry_id, // registry is the escrow's arbiter
        &ctx.token,
        &AMOUNT,
        &expiry,
        &desc,
    );
    ctx.escrow.deposit(&id);
    ctx.escrow.raise_dispute(&id, &ctx.payer);
    id
}

// ── Arbiter set management ──────────────────────────────────────────────────────

#[test]
fn test_arbiter_set_management() {
    let ctx = setup(2);
    assert_eq!(ctx.registry.get_arbiters().len(), 3);
    assert!(ctx.registry.is_arbiter(&ctx.arbiters[0]));

    let newcomer = Address::generate(&ctx.env);
    assert!(!ctx.registry.is_arbiter(&newcomer));
    ctx.registry.add_arbiter(&newcomer);
    assert!(ctx.registry.is_arbiter(&newcomer));
    assert_eq!(ctx.registry.get_arbiters().len(), 4);

    ctx.registry.remove_arbiter(&ctx.arbiters[0]);
    assert!(!ctx.registry.is_arbiter(&ctx.arbiters[0]));
    assert_eq!(ctx.registry.get_arbiters().len(), 3);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_cannot_add_duplicate_arbiter() {
    let ctx = setup(2);
    ctx.registry.add_arbiter(&ctx.arbiters[0]);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_cannot_remove_unknown_arbiter() {
    let ctx = setup(2);
    let stranger = Address::generate(&ctx.env);
    ctx.registry.remove_arbiter(&stranger);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_zero_quorum_rejected() {
    let ctx = setup(2);
    ctx.registry.set_quorum(&0);
}

#[test]
fn test_set_quorum() {
    let ctx = setup(2);
    ctx.registry.set_quorum(&3);
    assert_eq!(ctx.registry.get_quorum(), 3);
}

// ── Quorum voting + binding resolution ──────────────────────────────────────────

#[test]
fn test_quorum_release_resolves_escrow_to_payee() {
    let ctx = setup(2);
    let escrow_id = disputed_escrow(&ctx);
    let case = ctx.registry.open_case(&ctx.arbiters[0], &ctx.escrow.address, &escrow_id);

    // First vote: no quorum yet, escrow still disputed.
    ctx.registry.vote(&ctx.arbiters[0], &case, &1);
    assert_eq!(ctx.registry.get_case(&case).status, CaseStatus::Open);
    assert_eq!(ctx.escrow.get_escrow(&escrow_id).state, EscrowState::Disputed);

    // Second matching vote reaches quorum → binding release callback.
    ctx.registry.vote(&ctx.arbiters[1], &case, &1);
    let resolved = ctx.registry.get_case(&case);
    assert_eq!(resolved.status, CaseStatus::Resolved);
    assert_eq!(resolved.outcome, 1);
    assert_eq!(resolved.votes_release, 2);

    // The escrow has actually released funds to the payee.
    let e = ctx.escrow.get_escrow(&escrow_id);
    assert_eq!(e.state, EscrowState::Released);
    let token = soroban_sdk::token::TokenClient::new(&ctx.env, &ctx.token);
    assert_eq!(token.balance(&ctx.payee), AMOUNT);
}

#[test]
fn test_quorum_refund_resolves_escrow_to_payer() {
    let ctx = setup(2);
    let escrow_id = disputed_escrow(&ctx);
    let token = soroban_sdk::token::TokenClient::new(&ctx.env, &ctx.token);
    let payer_before = token.balance(&ctx.payer);

    let case = ctx.registry.open_case(&ctx.admin, &ctx.escrow.address, &escrow_id);
    ctx.registry.vote(&ctx.arbiters[0], &case, &2);
    ctx.registry.vote(&ctx.arbiters[2], &case, &2);

    assert_eq!(ctx.registry.get_case(&case).outcome, 2);
    assert_eq!(ctx.escrow.get_escrow(&escrow_id).state, EscrowState::Refunded);
    // Payer is made whole again (deposit returned).
    assert_eq!(token.balance(&ctx.payer), payer_before + AMOUNT);
}

#[test]
fn test_split_votes_do_not_resolve() {
    let ctx = setup(2);
    let escrow_id = disputed_escrow(&ctx);
    let case = ctx.registry.open_case(&ctx.arbiters[0], &ctx.escrow.address, &escrow_id);

    ctx.registry.vote(&ctx.arbiters[0], &case, &1);
    ctx.registry.vote(&ctx.arbiters[1], &case, &2);

    let c = ctx.registry.get_case(&case);
    assert_eq!(c.status, CaseStatus::Open);
    assert_eq!(c.votes_release, 1);
    assert_eq!(c.votes_refund, 1);
    assert_eq!(ctx.escrow.get_escrow(&escrow_id).state, EscrowState::Disputed);
}

#[test]
fn test_vote_records_are_queryable() {
    let ctx = setup(3);
    let escrow_id = disputed_escrow(&ctx);
    let case = ctx.registry.open_case(&ctx.arbiters[0], &ctx.escrow.address, &escrow_id);
    ctx.registry.vote(&ctx.arbiters[0], &case, &1);
    assert_eq!(ctx.registry.get_vote(&case, &ctx.arbiters[0]), 1);
    assert_eq!(ctx.registry.get_vote(&case, &ctx.arbiters[1]), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn test_arbiter_cannot_vote_twice() {
    let ctx = setup(3);
    let escrow_id = disputed_escrow(&ctx);
    let case = ctx.registry.open_case(&ctx.arbiters[0], &ctx.escrow.address, &escrow_id);
    ctx.registry.vote(&ctx.arbiters[0], &case, &1);
    ctx.registry.vote(&ctx.arbiters[0], &case, &1);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_non_arbiter_cannot_vote() {
    let ctx = setup(2);
    let escrow_id = disputed_escrow(&ctx);
    let case = ctx.registry.open_case(&ctx.arbiters[0], &ctx.escrow.address, &escrow_id);
    let stranger = Address::generate(&ctx.env);
    ctx.registry.vote(&stranger, &case, &1);
}

#[test]
#[should_panic(expected = "Error(Contract, #10)")]
fn test_invalid_outcome_rejected() {
    let ctx = setup(2);
    let escrow_id = disputed_escrow(&ctx);
    let case = ctx.registry.open_case(&ctx.arbiters[0], &ctx.escrow.address, &escrow_id);
    ctx.registry.vote(&ctx.arbiters[0], &case, &3);
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn test_cannot_vote_on_resolved_case() {
    let ctx = setup(2);
    let escrow_id = disputed_escrow(&ctx);
    let case = ctx.registry.open_case(&ctx.arbiters[0], &ctx.escrow.address, &escrow_id);
    ctx.registry.vote(&ctx.arbiters[0], &case, &1);
    ctx.registry.vote(&ctx.arbiters[1], &case, &1); // resolves
    ctx.registry.vote(&ctx.arbiters[2], &case, &1); // case now closed
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_non_arbiter_cannot_open_case() {
    let ctx = setup(2);
    let escrow_id = disputed_escrow(&ctx);
    let stranger = Address::generate(&ctx.env);
    ctx.registry.open_case(&stranger, &ctx.escrow.address, &escrow_id);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn test_get_unknown_case_panics() {
    let ctx = setup(2);
    ctx.registry.get_case(&999);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn test_cannot_init_twice() {
    let ctx = setup(2);
    ctx.registry.init(&ctx.admin, &2);
}

#[test]
fn test_quorum_of_one_resolves_immediately() {
    let ctx = setup(1);
    let escrow_id = disputed_escrow(&ctx);
    let case = ctx.registry.open_case(&ctx.arbiters[0], &ctx.escrow.address, &escrow_id);
    ctx.registry.vote(&ctx.arbiters[0], &case, &1);
    assert_eq!(ctx.escrow.get_escrow(&escrow_id).state, EscrowState::Released);
}
