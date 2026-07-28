#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

// ─── Helpers ──────────────────────────────────────────────────────────────────

struct Ctx {
    env: Env,
    admin: Address,
    authority: Address,
    contract: Address,
    client: SubscriptionNftContractClient<'static>,
}

fn setup() -> Ctx {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let authority = Address::generate(&env);

    let contract = env.register(SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &contract);
    client.init(&admin, &authority);

    Ctx {
        env,
        admin,
        authority,
        contract,
        client,
    }
}

/// Mint a token with default merchant / expiry and return token_id.
fn mint_default(ctx: &Ctx, owner: &Address, sub_id: u64) -> u64 {
    let merchant = Address::generate(&ctx.env);
    ctx.client.mint(owner, &sub_id, &merchant, &0u64)
}

// ─── init ─────────────────────────────────────────────────────────────────────

#[test]
fn test_init_succeeds() {
    let ctx = setup();
    assert!(!ctx.client.is_paused());
    assert_eq!(ctx.client.total_minted(), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_init_twice_panics() {
    let ctx = setup();
    let other = Address::generate(&ctx.env);
    ctx.client.init(&ctx.admin, &other);
}

// ─── mint ─────────────────────────────────────────────────────────────────────

#[test]
fn test_mint_returns_incrementing_token_id() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);
    let merchant = Address::generate(&ctx.env);

    let id1 = ctx.client.mint(&owner, &1u64, &merchant, &0u64);
    let id2 = ctx.client.mint(&owner, &2u64, &merchant, &0u64);
    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
}

#[test]
fn test_mint_sets_correct_fields() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);
    let merchant = Address::generate(&ctx.env);
    let expires = 9_999_999u64;

    let id = ctx.client.mint(&owner, &42u64, &merchant, &expires);
    let nft = ctx.client.get_token(&id);

    assert_eq!(nft.token_id, id);
    assert_eq!(nft.owner, owner);
    assert_eq!(nft.merchant, merchant);
    assert_eq!(nft.sub_id, 42u64);
    assert_eq!(nft.expires_at, expires);
    assert_eq!(nft.renewal_state, RenewalState::Current);
    assert_eq!(nft.transfer_count, 0);
    assert_eq!(nft.last_transfer_ledger, 0);
}

#[test]
fn test_mint_increments_owner_balance() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);
    assert_eq!(ctx.client.balance_of(&owner), 0);

    mint_default(&ctx, &owner, 1);
    assert_eq!(ctx.client.balance_of(&owner), 1);

    mint_default(&ctx, &owner, 2);
    assert_eq!(ctx.client.balance_of(&owner), 2);
}

#[test]
fn test_mint_registers_sub_token_index() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);
    let id = mint_default(&ctx, &owner, 77u64);
    assert_eq!(ctx.client.token_for_sub(&77u64), Some(id));
}

#[test]
fn test_total_minted_tracks_count() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);
    assert_eq!(ctx.client.total_minted(), 0);
    mint_default(&ctx, &owner, 1);
    mint_default(&ctx, &owner, 2);
    mint_default(&ctx, &owner, 3);
    assert_eq!(ctx.client.total_minted(), 3);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn test_mint_duplicate_sub_id_panics() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);
    mint_default(&ctx, &owner, 1);
    // Second mint with same sub_id should fail.
    mint_default(&ctx, &owner, 1);
}

// ─── owner_of / balance_of ────────────────────────────────────────────────────

#[test]
fn test_owner_of_returns_correct_owner() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);
    let id = mint_default(&ctx, &owner, 1);
    assert_eq!(ctx.client.owner_of(&id), owner);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_owner_of_nonexistent_panics() {
    let ctx = setup();
    ctx.client.owner_of(&999u64);
}

// ─── transfer ─────────────────────────────────────────────────────────────────

#[test]
fn test_transfer_moves_ownership() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    let bob = Address::generate(&ctx.env);
    let id = mint_default(&ctx, &alice, 1);

    ctx.client.transfer(&id, &bob);

    assert_eq!(ctx.client.owner_of(&id), bob);
}

#[test]
fn test_transfer_updates_balances() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    let bob = Address::generate(&ctx.env);
    let id = mint_default(&ctx, &alice, 1);

    ctx.client.transfer(&id, &bob);

    assert_eq!(ctx.client.balance_of(&alice), 0);
    assert_eq!(ctx.client.balance_of(&bob), 1);
}

#[test]
fn test_transfer_increments_transfer_count() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    let bob = Address::generate(&ctx.env);
    let id = mint_default(&ctx, &alice, 1);

    ctx.client.transfer(&id, &bob);
    assert_eq!(ctx.client.get_token(&id).transfer_count, 1);

    ctx.client.transfer(&id, &alice);
    assert_eq!(ctx.client.get_token(&id).transfer_count, 2);
}

#[test]
fn test_transfer_clears_approval() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    let bob = Address::generate(&ctx.env);
    let charlie = Address::generate(&ctx.env);
    let id = mint_default(&ctx, &alice, 1);

    ctx.client.approve(&id, &charlie);
    assert!(ctx.client.get_approval(&id).is_some());

    ctx.client.transfer(&id, &bob);
    assert!(ctx.client.get_approval(&id).is_none());
}

#[test]
fn test_transfer_updates_last_transfer_ledger() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    let bob = Address::generate(&ctx.env);
    let id = mint_default(&ctx, &alice, 1);
    let ledger_before = ctx.env.ledger().sequence();

    ctx.client.transfer(&id, &bob);
    let nft = ctx.client.get_token(&id);
    assert!(nft.last_transfer_ledger >= ledger_before);
}

// ─── transfer – policy checks ─────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_transfer_blocked_when_overdue() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    let bob = Address::generate(&ctx.env);
    let id = mint_default(&ctx, &alice, 1);

    ctx.client.update_renewal_state(&1u64, &RenewalState::Overdue);
    ctx.client.transfer(&id, &bob);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_transfer_blocked_when_cancelled() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    let bob = Address::generate(&ctx.env);
    let id = mint_default(&ctx, &alice, 1);

    ctx.client.update_renewal_state(&1u64, &RenewalState::Cancelled);
    ctx.client.transfer(&id, &bob);
}

#[test]
fn test_transfer_allowed_when_current() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    let bob = Address::generate(&ctx.env);
    let id = mint_default(&ctx, &alice, 1);

    ctx.client.update_renewal_state(&1u64, &RenewalState::Current);
    ctx.client.transfer(&id, &bob);
    assert_eq!(ctx.client.owner_of(&id), bob);
}

#[test]
fn test_transfer_allowed_in_grace_period() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    let bob = Address::generate(&ctx.env);
    let id = mint_default(&ctx, &alice, 1);

    ctx.client.update_renewal_state(&1u64, &RenewalState::GracePeriod);
    ctx.client.transfer(&id, &bob);
    assert_eq!(ctx.client.owner_of(&id), bob);
}

// ─── approve / revoke ─────────────────────────────────────────────────────────

#[test]
fn test_approve_sets_spender() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);
    let spender = Address::generate(&ctx.env);
    let id = mint_default(&ctx, &owner, 1);

    ctx.client.approve(&id, &spender);
    assert_eq!(ctx.client.get_approval(&id), Some(spender));
}

#[test]
fn test_revoke_approval_clears_spender() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);
    let spender = Address::generate(&ctx.env);
    let id = mint_default(&ctx, &owner, 1);

    ctx.client.approve(&id, &spender);
    ctx.client.revoke_approval(&id);
    assert_eq!(ctx.client.get_approval(&id), None);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_approve_nonexistent_token_panics() {
    let ctx = setup();
    let spender = Address::generate(&ctx.env);
    ctx.client.approve(&999u64, &spender);
}

// ─── burn ─────────────────────────────────────────────────────────────────────

#[test]
fn test_burn_removes_token() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);
    let id = mint_default(&ctx, &owner, 1);

    ctx.client.burn(&id);

    assert_eq!(ctx.client.token_for_sub(&1u64), None);
    assert_eq!(ctx.client.balance_of(&owner), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_get_token_after_burn_panics() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);
    let id = mint_default(&ctx, &owner, 1);
    ctx.client.burn(&id);
    ctx.client.get_token(&id);
}

#[test]
fn test_burn_allows_remint_of_same_sub_id() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);
    let id1 = mint_default(&ctx, &owner, 1);
    ctx.client.burn(&id1);

    // Now sub_id 1 is free — should be mintable again.
    let id2 = mint_default(&ctx, &owner, 1);
    assert_ne!(id1, id2);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_burn_nonexistent_panics() {
    let ctx = setup();
    ctx.client.burn(&999u64);
}

// ─── update_renewal_state ─────────────────────────────────────────────────────

#[test]
fn test_update_renewal_state_persists() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);
    mint_default(&ctx, &owner, 1);

    ctx.client.update_renewal_state(&1u64, &RenewalState::Overdue);
    let nft = ctx.client.get_token(&1u64);
    assert_eq!(nft.renewal_state, RenewalState::Overdue);

    ctx.client.update_renewal_state(&1u64, &RenewalState::Current);
    let nft2 = ctx.client.get_token(&1u64);
    assert_eq!(nft2.renewal_state, RenewalState::Current);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_update_renewal_state_nonexistent_sub_panics() {
    let ctx = setup();
    ctx.client.update_renewal_state(&999u64, &RenewalState::Overdue);
}

// ─── pause ────────────────────────────────────────────────────────────────────

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
fn test_mint_blocked_when_paused() {
    let ctx = setup();
    ctx.client.set_paused(&true);
    let owner = Address::generate(&ctx.env);
    mint_default(&ctx, &owner, 1);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_transfer_blocked_when_paused() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    let bob = Address::generate(&ctx.env);
    let id = mint_default(&ctx, &alice, 1);
    ctx.client.set_paused(&true);
    ctx.client.transfer(&id, &bob);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_burn_blocked_when_paused() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);
    let id = mint_default(&ctx, &owner, 1);
    ctx.client.set_paused(&true);
    ctx.client.burn(&id);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_approve_blocked_when_paused() {
    let ctx = setup();
    let owner = Address::generate(&ctx.env);
    let spender = Address::generate(&ctx.env);
    let id = mint_default(&ctx, &owner, 1);
    ctx.client.set_paused(&true);
    ctx.client.approve(&id, &spender);
}

// ─── set_mint_authority ───────────────────────────────────────────────────────

#[test]
fn test_set_mint_authority_succeeds() {
    let ctx = setup();
    let new_auth = Address::generate(&ctx.env);
    // Should not panic.
    ctx.client.set_mint_authority(&new_auth);
}

// ─── multiple independent tokens ─────────────────────────────────────────────

#[test]
fn test_multiple_owners_independent() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    let bob = Address::generate(&ctx.env);

    let id1 = mint_default(&ctx, &alice, 1);
    let id2 = mint_default(&ctx, &bob, 2);
    let id3 = mint_default(&ctx, &alice, 3);

    assert_eq!(ctx.client.balance_of(&alice), 2);
    assert_eq!(ctx.client.balance_of(&bob), 1);
    assert_eq!(ctx.client.owner_of(&id1), alice);
    assert_eq!(ctx.client.owner_of(&id2), bob);
    assert_eq!(ctx.client.owner_of(&id3), alice);
}

// ─── token_for_sub ────────────────────────────────────────────────────────────

#[test]
fn test_token_for_sub_returns_none_for_unknown() {
    let ctx = setup();
    assert_eq!(ctx.client.token_for_sub(&999u64), None);
}

// ─── uninitialized guard ──────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn test_is_paused_before_init_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let contract = env.register(SubscriptionNftContract, ());
    let client = SubscriptionNftContractClient::new(&env, &contract);
    client.is_paused();
}
