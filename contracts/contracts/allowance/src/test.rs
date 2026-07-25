#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

const DAY: u64 = 86_400;
const MONTH: u64 = 30 * DAY;

struct Ctx {
    env: Env,
    owner: Address,
    merchant: Address,
    token: Address,
    token_client: TokenClient<'static>,
    allowance: AllowanceContractClient<'static>,
}

fn setup() -> Ctx {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let merchant = Address::generate(&env);

    // Deploy a Stellar asset token and fund the owner.
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token = sac.address();
    let token_client = TokenClient::new(&env, &token);
    StellarAssetClient::new(&env, &token).mint(&owner, &1_000_000_000i128);

    let contract_id = env.register(AllowanceContract, ());
    let allowance = AllowanceContractClient::new(&env, &contract_id);
    allowance.init(&admin);

    // Owner authorizes the contract to pull funds on its behalf.
    token_client.approve(&owner, &contract_id, &1_000_000_000i128, &1_000_000u32);

    Ctx {
        env,
        owner,
        merchant,
        token,
        token_client,
        allowance,
    }
}

fn grant(ctx: &Ctx, period_cap: i128, absolute_cap: i128, period_length: u64) -> u64 {
    ctx.allowance.grant_allowance(
        &ctx.owner,
        &ctx.merchant,
        &ctx.token,
        &period_cap,
        &absolute_cap,
        &period_length,
    )
}

#[test]
fn test_grant_creates_active_allowance() {
    let ctx = setup();
    let id = grant(&ctx, 50, 600, MONTH);
    assert_eq!(id, 1);
    assert_eq!(ctx.allowance.get_allowance_count(), 1);

    let a = ctx.allowance.get_allowance(&id);
    assert_eq!(a.owner, ctx.owner);
    assert_eq!(a.merchant, ctx.merchant);
    assert_eq!(a.period_cap, 50);
    assert_eq!(a.absolute_cap, 600);
    assert_eq!(a.period_length, MONTH);
    assert_eq!(a.period_spent, 0);
    assert_eq!(a.total_spent, 0);
    assert!(a.active);
}

#[test]
fn test_consume_transfers_and_tracks_spend() {
    let ctx = setup();
    let id = grant(&ctx, 50, 600, MONTH);

    ctx.allowance.consume(&id, &30);

    // Funds moved owner -> merchant.
    assert_eq!(ctx.token_client.balance(&ctx.merchant), 30);
    assert_eq!(ctx.token_client.balance(&ctx.owner), 1_000_000_000 - 30);

    let a = ctx.allowance.get_allowance(&id);
    assert_eq!(a.period_spent, 30);
    assert_eq!(a.total_spent, 30);
    assert_eq!(ctx.allowance.available(&id), 20); // period budget is binding
}

#[test]
fn test_multiple_pulls_within_period_accumulate() {
    let ctx = setup();
    let id = grant(&ctx, 50, 600, MONTH);

    ctx.allowance.consume(&id, &20);
    ctx.allowance.consume(&id, &25);

    let a = ctx.allowance.get_allowance(&id);
    assert_eq!(a.period_spent, 45);
    assert_eq!(a.total_spent, 45);
    assert_eq!(ctx.token_client.balance(&ctx.merchant), 45);
}

#[test]
#[should_panic(expected = "Error(Contract, #10)")]
fn test_period_cap_enforced() {
    let ctx = setup();
    let id = grant(&ctx, 50, 600, MONTH);

    ctx.allowance.consume(&id, &40);
    // 40 + 20 = 60 > per-period cap of 50 -> PeriodCapExceeded
    ctx.allowance.consume(&id, &20);
}

#[test]
fn test_period_resets_after_period_length() {
    let ctx = setup();
    let id = grant(&ctx, 50, 600, MONTH);

    ctx.allowance.consume(&id, &50); // period exhausted

    // Advance one full period.
    ctx.env
        .ledger()
        .set_timestamp(ctx.env.ledger().timestamp() + MONTH);

    // Fresh period budget available again.
    ctx.allowance.consume(&id, &50);

    let a = ctx.allowance.get_allowance(&id);
    assert_eq!(a.period_spent, 50);
    assert_eq!(a.total_spent, 100);
    assert_eq!(ctx.token_client.balance(&ctx.merchant), 100);
}

#[test]
fn test_period_reset_aligns_to_boundaries() {
    let ctx = setup();
    let start = ctx.env.ledger().timestamp();
    let id = grant(&ctx, 50, 600, MONTH);

    ctx.allowance.consume(&id, &10);
    // Jump ~2.5 periods forward.
    ctx.env
        .ledger()
        .set_timestamp(start + 2 * MONTH + DAY);
    ctx.allowance.consume(&id, &10);

    let a = ctx.allowance.get_allowance(&id);
    // period_start should have advanced by exactly 2 whole periods.
    assert_eq!(a.period_start, start + 2 * MONTH);
    assert_eq!(a.period_spent, 10);
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn test_absolute_cap_enforced_across_periods() {
    let ctx = setup();
    // period cap 50, absolute cap 120, so third full period pull breaches total.
    let id = grant(&ctx, 50, 120, MONTH);

    ctx.allowance.consume(&id, &50);
    ctx.env
        .ledger()
        .set_timestamp(ctx.env.ledger().timestamp() + MONTH);
    ctx.allowance.consume(&id, &50); // total 100

    ctx.env
        .ledger()
        .set_timestamp(ctx.env.ledger().timestamp() + MONTH);
    // 100 + 50 = 150 > absolute cap 120 -> AbsoluteCapExceeded
    ctx.allowance.consume(&id, &50);
}

#[test]
fn test_available_tracks_absolute_cap_when_binding() {
    let ctx = setup();
    // Absolute budget (60) is tighter than a fresh period budget (50) only
    // after enough has been spent; verify `available` reflects the minimum.
    let id = grant(&ctx, 50, 60, MONTH);
    ctx.allowance.consume(&id, &50); // total 50, period 50
    ctx.env
        .ledger()
        .set_timestamp(ctx.env.ledger().timestamp() + MONTH);
    // New period: period budget 50, but only 10 left against absolute cap.
    assert_eq!(ctx.allowance.available(&id), 10);
}

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn test_consume_after_revoke_fails() {
    let ctx = setup();
    let id = grant(&ctx, 50, 600, MONTH);

    ctx.allowance.revoke_allowance(&id);
    let a = ctx.allowance.get_allowance(&id);
    assert!(!a.active);
    assert_eq!(ctx.allowance.available(&id), 0);

    ctx.allowance.consume(&id, &10);
}

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn test_double_revoke_fails() {
    let ctx = setup();
    let id = grant(&ctx, 50, 600, MONTH);
    ctx.allowance.revoke_allowance(&id);
    ctx.allowance.revoke_allowance(&id);
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn test_cannot_grant_to_self() {
    let ctx = setup();
    ctx.allowance.grant_allowance(
        &ctx.owner,
        &ctx.owner,
        &ctx.token,
        &50,
        &600,
        &MONTH,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_period_cap_above_absolute_rejected() {
    let ctx = setup();
    grant(&ctx, 600, 50, MONTH);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_zero_cap_rejected() {
    let ctx = setup();
    grant(&ctx, 0, 600, MONTH);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn test_zero_period_rejected() {
    let ctx = setup();
    grant(&ctx, 50, 600, 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_zero_amount_consume_rejected() {
    let ctx = setup();
    let id = grant(&ctx, 50, 600, MONTH);
    ctx.allowance.consume(&id, &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_consume_unknown_allowance_fails() {
    let ctx = setup();
    ctx.allowance.consume(&999, &10);
}

#[test]
fn test_update_caps() {
    let ctx = setup();
    let id = grant(&ctx, 50, 600, MONTH);
    ctx.allowance.consume(&id, &40);

    ctx.allowance.update_caps(&id, &100, &1000);
    let a = ctx.allowance.get_allowance(&id);
    assert_eq!(a.period_cap, 100);
    assert_eq!(a.absolute_cap, 1000);

    // The raised period cap now permits a larger pull in the same period.
    ctx.allowance.consume(&id, &60);
    assert_eq!(ctx.allowance.get_allowance(&id).period_spent, 100);
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn test_update_caps_below_spent_rejected() {
    let ctx = setup();
    let id = grant(&ctx, 50, 600, MONTH);
    ctx.allowance.consume(&id, &40);
    // New period cap 30 < already-spent 40 -> CapBelowSpent.
    ctx.allowance.update_caps(&id, &30, &600);
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn test_consume_blocked_when_paused() {
    let ctx = setup();
    let id = grant(&ctx, 50, 600, MONTH);
    ctx.allowance.pause();
    ctx.allowance.consume(&id, &10);
}

#[test]
fn test_consume_resumes_after_unpause() {
    let ctx = setup();
    let id = grant(&ctx, 50, 600, MONTH);
    ctx.allowance.pause();
    assert!(ctx.allowance.is_paused());
    ctx.allowance.unpause();
    ctx.allowance.consume(&id, &10);
    assert_eq!(ctx.allowance.get_allowance(&id).total_spent, 10);
}

#[test]
fn test_independent_allowances_are_isolated() {
    let ctx = setup();
    let merchant2 = Address::generate(&ctx.env);
    let id1 = grant(&ctx, 50, 600, MONTH);
    let id2 = ctx.allowance.grant_allowance(
        &ctx.owner,
        &merchant2,
        &ctx.token,
        &10,
        &100,
        &DAY,
    );

    ctx.allowance.consume(&id1, &50);
    ctx.allowance.consume(&id2, &10);

    assert_eq!(ctx.allowance.get_allowance(&id1).total_spent, 50);
    assert_eq!(ctx.allowance.get_allowance(&id2).total_spent, 10);
    assert_eq!(ctx.token_client.balance(&ctx.merchant), 50);
    assert_eq!(ctx.token_client.balance(&merchant2), 10);
}
