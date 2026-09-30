#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

// ─── Test helpers ────────────────────────────────────────────────────────────

struct Ctx {
    env: Env,
    admin: Address,
    caller: Address,
    contract: Address,
    client: LoyaltyRewardsContractClient<'static>,
}

fn setup() -> Ctx {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let caller = Address::generate(&env);

    let contract = env.register(LoyaltyRewardsContract, ());
    let client = LoyaltyRewardsContractClient::new(&env, &contract);
    client.init(&admin, &caller);

    Ctx {
        env,
        admin,
        caller,
        contract,
        client,
    }
}

// ─── init ────────────────────────────────────────────────────────────────────

#[test]
fn test_init_succeeds() {
    let ctx = setup();
    assert!(!ctx.client.is_paused());
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_init_twice_panics() {
    let ctx = setup();
    let other_caller = Address::generate(&ctx.env);
    // Second call must fail.
    ctx.client.init(&ctx.admin, &other_caller);
}

// ─── accrue – basic ──────────────────────────────────────────────────────────

#[test]
fn test_accrue_awards_base_points_on_first_renewal() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);

    // streak is 0 before first accrue → bonus = 0
    let awarded = ctx.client.accrue(&owner, &1u64, &100u32);
    assert_eq!(awarded, BASE_POINTS);
    assert_eq!(ctx.client.balance(&owner), BASE_POINTS);
}

#[test]
fn test_accrue_increments_streak() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);

    ctx.client.accrue(&owner, &1u64, &100u32);
    assert_eq!(ctx.client.streak(&owner), 1);

    ctx.client.accrue(&owner, &1u64, &200u32);
    assert_eq!(ctx.client.streak(&owner), 2);
}

#[test]
fn test_accrue_applies_streak_bonus() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);

    // First renewal: streak=0, bonus=0
    let r1 = ctx.client.accrue(&owner, &1u64, &100u32);
    assert_eq!(r1, BASE_POINTS); // 100

    // Second renewal: streak=1, bonus=50
    let r2 = ctx.client.accrue(&owner, &1u64, &200u32);
    assert_eq!(r2, BASE_POINTS + STREAK_BONUS * 1); // 150

    // Third renewal: streak=2, bonus=100
    let r3 = ctx.client.accrue(&owner, &1u64, &300u32);
    assert_eq!(r3, BASE_POINTS + STREAK_BONUS * 2); // 200
}

#[test]
fn test_accrue_accumulates_balance() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);

    let r1 = ctx.client.accrue(&owner, &1u64, &100u32);
    let r2 = ctx.client.accrue(&owner, &1u64, &200u32);
    let r3 = ctx.client.accrue(&owner, &1u64, &300u32);

    assert_eq!(ctx.client.balance(&owner), r1 + r2 + r3);
}

#[test]
fn test_accrue_updates_lifetime_points() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);

    ctx.client.accrue(&owner, &1u64, &100u32);
    ctx.client.accrue(&owner, &1u64, &200u32);
    let acct = ctx.client.account(&owner);
    // lifetime_points must equal points (no redemptions yet)
    assert_eq!(acct.lifetime_points, acct.points);
}

#[test]
fn test_accrue_records_last_renewal_ledger() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);

    ctx.client.accrue(&owner, &1u64, &999u32);
    let acct = ctx.client.account(&owner);
    assert_eq!(acct.last_renewal_ledger, 999u32);
}

// ─── accrue – streak cap ─────────────────────────────────────────────────────

#[test]
fn test_accrue_streak_bonus_capped_at_max_level() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);

    // Advance streak to MAX_STREAK_BONUS_LEVEL by calling accrue that many times.
    for i in 0..MAX_STREAK_BONUS_LEVEL {
        ctx.client.accrue(&owner, &1u64, &(100 + i));
    }
    // streak is now MAX_STREAK_BONUS_LEVEL (20)
    assert_eq!(ctx.client.streak(&owner), MAX_STREAK_BONUS_LEVEL);

    // The 21st renewal should still cap at level 20 for the bonus.
    let awarded = ctx
        .client
        .accrue(&owner, &1u64, &(100 + MAX_STREAK_BONUS_LEVEL));
    let expected = BASE_POINTS + STREAK_BONUS * (MAX_STREAK_BONUS_LEVEL as i128);
    assert_eq!(awarded, expected);

    // The 22nd renewal: streak is now 21, but capped at 20 for bonus calc.
    let awarded2 = ctx
        .client
        .accrue(&owner, &1u64, &(101 + MAX_STREAK_BONUS_LEVEL));
    assert_eq!(awarded2, expected); // same cap
}

// ─── miss ────────────────────────────────────────────────────────────────────

#[test]
fn test_miss_resets_streak() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);

    ctx.client.accrue(&owner, &1u64, &100u32);
    ctx.client.accrue(&owner, &1u64, &200u32);
    assert_eq!(ctx.client.streak(&owner), 2);

    ctx.client.miss(&owner, &1u64);
    assert_eq!(ctx.client.streak(&owner), 0);
}

#[test]
fn test_miss_does_not_deduct_points() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);

    ctx.client.accrue(&owner, &1u64, &100u32);
    let balance_before = ctx.client.balance(&owner);

    ctx.client.miss(&owner, &1u64);
    assert_eq!(ctx.client.balance(&owner), balance_before);
}

#[test]
fn test_miss_on_zero_streak_is_noop() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);

    // No prior accrue → streak is already 0, miss should be safe.
    ctx.client.miss(&owner, &1u64);
    assert_eq!(ctx.client.streak(&owner), 0);
}

#[test]
fn test_miss_then_accrue_restarts_streak() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);

    ctx.client.accrue(&owner, &1u64, &100u32);
    ctx.client.accrue(&owner, &1u64, &200u32);
    ctx.client.miss(&owner, &1u64);

    // After miss, next accrue gets 0-streak bonus.
    let awarded = ctx.client.accrue(&owner, &1u64, &300u32);
    assert_eq!(awarded, BASE_POINTS);
    assert_eq!(ctx.client.streak(&owner), 1);
}

// ─── redeem ──────────────────────────────────────────────────────────────────

#[test]
fn test_redeem_burns_points_and_returns_credit() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);

    // Accumulate some points first.
    ctx.client.accrue(&owner, &1u64, &100u32);
    ctx.client.accrue(&owner, &1u64, &200u32);
    let balance = ctx.client.balance(&owner);

    let credit = ctx.client.redeem(&owner, &MIN_REDEEM);
    assert_eq!(credit, MIN_REDEEM * POINTS_PER_CREDIT);
    assert_eq!(ctx.client.balance(&owner), balance - MIN_REDEEM);
}

#[test]
fn test_redeem_increments_total_redeems() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);

    for _ in 0..5 {
        ctx.client.accrue(&owner, &1u64, &100u32);
    }

    ctx.client.redeem(&owner, &MIN_REDEEM);
    ctx.client.redeem(&owner, &MIN_REDEEM);
    let acct = ctx.client.account(&owner);
    assert_eq!(acct.total_redeems, 2);
}

#[test]
fn test_redeem_full_balance() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);

    ctx.client.accrue(&owner, &1u64, &100u32);
    let balance = ctx.client.balance(&owner);

    let credit = ctx.client.redeem(&owner, &balance);
    assert_eq!(credit, balance * POINTS_PER_CREDIT);
    assert_eq!(ctx.client.balance(&owner), 0);
}

#[test]
fn test_lifetime_points_unaffected_by_redeem() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);

    ctx.client.accrue(&owner, &1u64, &100u32);
    ctx.client.accrue(&owner, &1u64, &200u32);
    let lifetime_before = ctx.client.account(&owner).lifetime_points;

    ctx.client.redeem(&owner, &MIN_REDEEM);
    let lifetime_after = ctx.client.account(&owner).lifetime_points;

    assert_eq!(lifetime_before, lifetime_after);
}

// ─── redeem – error paths ────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_redeem_below_minimum_panics() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);
    ctx.client.accrue(&owner, &1u64, &100u32);
    // Redeem 1 point which is < MIN_REDEEM (100).
    ctx.client.redeem(&owner, &1i128);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_redeem_more_than_balance_panics() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);
    ctx.client.accrue(&owner, &1u64, &100u32);
    let balance = ctx.client.balance(&owner);
    // Try to redeem one point more than we have.
    ctx.client.redeem(&owner, &(balance + 1));
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_redeem_on_empty_account_panics() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);
    // No prior accrue → balance is 0.
    ctx.client.redeem(&owner, &MIN_REDEEM);
}

// ─── pause / unpause ─────────────────────────────────────────────────────────

#[test]
fn test_set_paused_and_resume() {
    let ctx = setup();
    assert!(!ctx.client.is_paused());

    ctx.client.set_paused(&true);
    assert!(ctx.client.is_paused());

    ctx.client.set_paused(&false);
    assert!(!ctx.client.is_paused());
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_accrue_panics_when_paused() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);
    ctx.client.set_paused(&true);
    ctx.client.accrue(&owner, &1u64, &100u32);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_miss_panics_when_paused() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);
    ctx.client.set_paused(&true);
    ctx.client.miss(&owner, &1u64);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_redeem_panics_when_paused() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);
    // Accrue first so there are enough points.
    ctx.client.accrue(&owner, &1u64, &100u32);
    ctx.client.set_paused(&true);
    ctx.client.redeem(&owner, &MIN_REDEEM);
}

// ─── set_renewal_caller ──────────────────────────────────────────────────────

#[test]
fn test_set_renewal_caller_succeeds() {
    let ctx = setup();
    let new_caller = Address::generate(&ctx.env);
    // Should not panic.
    ctx.client.set_renewal_caller(&new_caller);
}

// ─── multiple users are independent ─────────────────────────────────────────

#[test]
fn test_multiple_owners_independent_balances() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    let bob = Address::generate(&ctx.env);

    ctx.client.accrue(&alice, &1u64, &100u32);
    ctx.client.accrue(&alice, &1u64, &200u32);
    ctx.client.accrue(&bob, &2u64, &100u32);

    // Alice has two renewals, Bob has one.
    assert_eq!(
        ctx.client.balance(&alice),
        BASE_POINTS + (BASE_POINTS + STREAK_BONUS)
    );
    assert_eq!(ctx.client.balance(&bob), BASE_POINTS);
    assert_eq!(ctx.client.streak(&alice), 2);
    assert_eq!(ctx.client.streak(&bob), 1);
}

#[test]
fn test_miss_does_not_affect_other_owner() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    let bob = Address::generate(&ctx.env);

    ctx.client.accrue(&alice, &1u64, &100u32);
    ctx.client.accrue(&bob, &2u64, &100u32);

    ctx.client.miss(&alice, &1u64);

    assert_eq!(ctx.client.streak(&alice), 0);
    assert_eq!(ctx.client.streak(&bob), 1);
}

// ─── account query ───────────────────────────────────────────────────────────

#[test]
fn test_account_returns_full_state() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);

    ctx.client.accrue(&owner, &1u64, &100u32);
    ctx.client.accrue(&owner, &1u64, &200u32);
    ctx.client.redeem(&owner, &MIN_REDEEM);

    let acct = ctx.client.account(&owner);
    assert_eq!(acct.streak, 2);
    assert_eq!(acct.total_redeems, 1);
    assert_eq!(acct.last_renewal_ledger, 200u32);
    assert!(acct.lifetime_points >= acct.points);
}

// ─── streak query ────────────────────────────────────────────────────────────

#[test]
fn test_streak_returns_zero_for_new_owner() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);
    assert_eq!(ctx.client.streak(&owner), 0);
}

// ─── uninitialized contract ──────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn test_is_paused_before_init_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let contract = env.register(LoyaltyRewardsContract, ());
    let client = LoyaltyRewardsContractClient::new(&env, &contract);
    client.is_paused();
}
