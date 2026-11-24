#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Vec,
};

// ── Test harness ──────────────────────────────────────────────────────────────

struct Ctx {
    env: Env,
    admin: Address,
    caller: Address,
    merchant: Address,
    /// Three generic payer accounts.
    payers: [Address; 3],
    token: Address,
    token_client: TokenClient<'static>,
    splitter: PaymentSplitterContractClient<'static>,
}

/// Fund `amount` tokens to each payer and approve the contract to spend them.
fn fund_and_approve(ctx: &Ctx, amount: i128) {
    let sac = StellarAssetClient::new(&ctx.env, &ctx.token);
    for p in &ctx.payers {
        sac.mint(p, &amount);
        ctx.token_client
            .approve(p, &ctx.splitter.address, &amount, &1_000_000u32);
    }
}

fn setup() -> Ctx {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let caller = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payers = [
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    ];

    // Deploy a Stellar-asset token.
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token = sac.address();
    let token_client = TokenClient::new(&env, &token);

    // Deploy the splitter contract.
    let contract_id = env.register(PaymentSplitterContract, ());
    let splitter = PaymentSplitterContractClient::new(&env, &contract_id);
    splitter.init(&admin);

    Ctx {
        env,
        admin,
        caller,
        merchant,
        payers,
        token,
        token_client,
        splitter,
    }
}

// ── Helper: build a Vec<PayerShare> from tuples ───────────────────────────────

fn make_payers(env: &Env, shares: &[(&Address, u32)]) -> Vec<PayerShare> {
    let mut v = Vec::new(env);
    for (addr, bps) in shares {
        v.push_back(PayerShare {
            payer: (*addr).clone(),
            share_bps: *bps,
        });
    }
    v
}

// ── Happy-path: equal 3-way split (3334 + 3333 + 3333 = 10 000) ──────────────

#[test]
fn test_equal_three_way_split() {
    let ctx = setup();
    let total: i128 = 1_000_000; // 1 USDC (6 decimals)
    fund_and_approve(&ctx, total);

    // Shares: 33.34 %, 33.33 %, 33.33 %  (sum = 10 000 bps)
    let payers = make_payers(
        &ctx.env,
        &[
            (&ctx.payers[0], 3334),
            (&ctx.payers[1], 3333),
            (&ctx.payers[2], 3333),
        ],
    );

    let split_id =
        ctx.splitter
            .configure_split(&ctx.caller, &ctx.token, &ctx.merchant, &total, &payers);

    assert_eq!(split_id, 1);
    assert_eq!(ctx.splitter.split_count(), 1);

    // Advance ledger so executed_at is non-zero.
    ctx.env.ledger().with_mut(|l| {
        l.timestamp = 100;
    });

    ctx.splitter.execute_split(&ctx.caller, &split_id);

    // Merchant must receive exactly `total`.
    assert_eq!(ctx.token_client.balance(&ctx.merchant), total);

    // Payer 0 pays 333 400 (33.34 %).
    // Payer 1 pays 333 300 (33.33 %).
    // Payer 2 pays 333 300 (33.33 %).
    // sum = 999 999 which is 1 short — dust goes to payer 0, so payer 0 = 333 401? No:
    // floor(1_000_000 * 3334 / 10_000) = 333_400
    // floor(1_000_000 * 3333 / 10_000) = 333_300
    // floor(1_000_000 * 3333 / 10_000) = 333_300
    // allocated = 999_999 → dust = 1 → payer 0 gets 333_401? No, payer 0 already 333_400 + 1 = 333_401
    // Wait: 333_400 + 333_300 + 333_300 = 1_000_000 — actually no dust here. Let's verify:
    // 3334 + 3333 + 3333 = 10_000 ✓
    // 1_000_000 * 3334 / 10_000 = 333_400
    // 1_000_000 * 3333 / 10_000 = 333_300
    // total allocated = 333_400 + 333_300 + 333_300 = 1_000_000 ✓

    assert_eq!(
        ctx.token_client.balance(&ctx.payers[0]),
        total - total * 3334 / 10_000
    );
    assert_eq!(
        ctx.token_client.balance(&ctx.payers[1]),
        total - total * 3333 / 10_000
    );
    assert_eq!(
        ctx.token_client.balance(&ctx.payers[2]),
        total - total * 3333 / 10_000
    );

    // Split is marked Executed.
    let split = ctx.splitter.get_split(&split_id);
    assert_eq!(split.status, SplitStatus::Executed);
    assert!(split.executed_at > 0);
}

// ── Happy-path: 2-way uneven split with dust ─────────────────────────────────

#[test]
fn test_two_way_split_with_rounding_dust() {
    let ctx = setup();
    // 3 tokens, split 5000/5000 but total is odd → no dust here.
    // Use total = 3, split 6667/3333 (sum = 10 000).
    // floor(3 * 6667 / 10_000) = 2, floor(3 * 3333 / 10_000) = 0? No:
    // Use total = 10, split 3334/6666.
    // floor(10 * 3334 / 10_000) = 3
    // floor(10 * 6666 / 10_000) = 6
    // allocated = 9 → dust = 1 goes to first payer → first payer pays 4.
    let total: i128 = 10;

    let sac = StellarAssetClient::new(&ctx.env, &ctx.token);
    for p in &ctx.payers[0..2] {
        sac.mint(p, &(total * 2)); // plenty of balance
        ctx.token_client
            .approve(p, &ctx.splitter.address, &(total * 2), &1_000_000u32);
    }

    let payers = make_payers(&ctx.env, &[(&ctx.payers[0], 3334), (&ctx.payers[1], 6666)]);

    let split_id =
        ctx.splitter
            .configure_split(&ctx.caller, &ctx.token, &ctx.merchant, &total, &payers);

    ctx.splitter.execute_split(&ctx.caller, &split_id);

    // Merchant receives exactly 10.
    assert_eq!(ctx.token_client.balance(&ctx.merchant), total);

    // floor(10 * 3334 / 10_000) = 3, dust = 1 → payer[0] pays 4.
    // floor(10 * 6666 / 10_000) = 6 → payer[1] pays 6.
    // Total: 4 + 6 = 10 ✓
    assert_eq!(ctx.token_client.balance(&ctx.payers[0]), total * 2 - 4);
    assert_eq!(ctx.token_client.balance(&ctx.payers[1]), total * 2 - 6);
}

// ── Happy-path: single payer at 100 % ────────────────────────────────────────

#[test]
fn test_single_payer_full_amount() {
    let ctx = setup();
    let total: i128 = 500_000;

    StellarAssetClient::new(&ctx.env, &ctx.token).mint(&ctx.payers[0], &total);
    ctx.token_client
        .approve(&ctx.payers[0], &ctx.splitter.address, &total, &1_000_000u32);

    let payers = make_payers(&ctx.env, &[(&ctx.payers[0], 10_000)]);
    let split_id =
        ctx.splitter
            .configure_split(&ctx.caller, &ctx.token, &ctx.merchant, &total, &payers);

    ctx.splitter.execute_split(&ctx.caller, &split_id);

    assert_eq!(ctx.token_client.balance(&ctx.merchant), total);
    assert_eq!(ctx.token_client.balance(&ctx.payers[0]), 0);
}

// ── Idempotency: cannot execute twice ────────────────────────────────────────

#[test]
#[should_panic]
fn test_execute_twice_panics() {
    let ctx = setup();
    let total: i128 = 100_000;
    fund_and_approve(&ctx, total);

    let payers = make_payers(&ctx.env, &[(&ctx.payers[0], 10_000)]);
    let split_id =
        ctx.splitter
            .configure_split(&ctx.caller, &ctx.token, &ctx.merchant, &total, &payers);

    ctx.splitter.execute_split(&ctx.caller, &split_id);
    // Second call must panic.
    ctx.splitter.execute_split(&ctx.caller, &split_id);
}

// ── Shares that do not sum to 100 % are rejected ─────────────────────────────

#[test]
#[should_panic]
fn test_shares_not_summing_to_100pct_rejected() {
    let ctx = setup();
    // 5000 + 4999 = 9999, not 10 000.
    let payers = make_payers(&ctx.env, &[(&ctx.payers[0], 5000), (&ctx.payers[1], 4999)]);
    ctx.splitter.configure_split(
        &ctx.caller,
        &ctx.token,
        &ctx.merchant,
        &1_000_000i128,
        &payers,
    );
}

// ── Shares that exceed 100 % are rejected ────────────────────────────────────

#[test]
#[should_panic]
fn test_shares_exceeding_100pct_rejected() {
    let ctx = setup();
    // 5001 + 5000 = 10 001.
    let payers = make_payers(&ctx.env, &[(&ctx.payers[0], 5001), (&ctx.payers[1], 5000)]);
    ctx.splitter.configure_split(
        &ctx.caller,
        &ctx.token,
        &ctx.merchant,
        &1_000_000i128,
        &payers,
    );
}

// ── Duplicate payer in the same split is rejected ────────────────────────────

#[test]
#[should_panic]
fn test_duplicate_payer_rejected() {
    let ctx = setup();
    let payers = make_payers(
        &ctx.env,
        &[
            (&ctx.payers[0], 5000),
            (&ctx.payers[0], 5000), // same address twice
        ],
    );
    ctx.splitter.configure_split(
        &ctx.caller,
        &ctx.token,
        &ctx.merchant,
        &1_000_000i128,
        &payers,
    );
}

// ── Zero-share entry is rejected ─────────────────────────────────────────────

#[test]
#[should_panic]
fn test_zero_share_rejected() {
    let ctx = setup();
    let payers = make_payers(
        &ctx.env,
        &[
            (&ctx.payers[0], 10_000),
            (&ctx.payers[1], 0), // zero share
        ],
    );
    ctx.splitter.configure_split(
        &ctx.caller,
        &ctx.token,
        &ctx.merchant,
        &1_000_000i128,
        &payers,
    );
}

// ── Merchant appearing as a payer is rejected ────────────────────────────────

#[test]
#[should_panic]
fn test_merchant_as_payer_rejected() {
    let ctx = setup();
    // Merchant is in the payer list.
    let payers = make_payers(&ctx.env, &[(&ctx.merchant, 5000), (&ctx.payers[0], 5000)]);
    ctx.splitter.configure_split(
        &ctx.caller,
        &ctx.token,
        &ctx.merchant,
        &1_000_000i128,
        &payers,
    );
}

// ── Zero total_amount is rejected ────────────────────────────────────────────

#[test]
#[should_panic]
fn test_zero_total_amount_rejected() {
    let ctx = setup();
    let payers = make_payers(&ctx.env, &[(&ctx.payers[0], 10_000)]);
    ctx.splitter.configure_split(
        &ctx.caller,
        &ctx.token,
        &ctx.merchant,
        &0i128, // invalid
        &payers,
    );
}

// ── Unauthorised caller cannot execute ───────────────────────────────────────

#[test]
#[should_panic]
fn test_unauthorized_caller_cannot_execute() {
    let ctx = setup();
    let total: i128 = 100_000;
    fund_and_approve(&ctx, total);

    let payers = make_payers(&ctx.env, &[(&ctx.payers[0], 10_000)]);
    let split_id =
        ctx.splitter
            .configure_split(&ctx.caller, &ctx.token, &ctx.merchant, &total, &payers);

    let rogue = Address::generate(&ctx.env);
    // Rogue address is neither the original caller nor the admin.
    ctx.splitter.execute_split(&rogue, &split_id);
}

// ── Admin can execute on behalf of caller ────────────────────────────────────

#[test]
fn test_admin_can_execute() {
    let ctx = setup();
    let total: i128 = 100_000;
    fund_and_approve(&ctx, total);

    let payers = make_payers(&ctx.env, &[(&ctx.payers[0], 10_000)]);
    let split_id =
        ctx.splitter
            .configure_split(&ctx.caller, &ctx.token, &ctx.merchant, &total, &payers);

    // Admin executes instead of original caller.
    ctx.splitter.execute_split(&ctx.admin, &split_id);

    assert_eq!(ctx.token_client.balance(&ctx.merchant), total);
}

// ── Cancel: a pending split can be cancelled ─────────────────────────────────

#[test]
fn test_cancel_pending_split() {
    let ctx = setup();
    let total: i128 = 100_000;
    let payers = make_payers(&ctx.env, &[(&ctx.payers[0], 10_000)]);
    let split_id =
        ctx.splitter
            .configure_split(&ctx.caller, &ctx.token, &ctx.merchant, &total, &payers);

    ctx.splitter.cancel_split(&ctx.caller, &split_id);

    let split = ctx.splitter.get_split(&split_id);
    assert_eq!(split.status, SplitStatus::Cancelled);
}

// ── Execute after cancel panics ───────────────────────────────────────────────

#[test]
#[should_panic]
fn test_execute_cancelled_split_panics() {
    let ctx = setup();
    let total: i128 = 100_000;
    fund_and_approve(&ctx, total);

    let payers = make_payers(&ctx.env, &[(&ctx.payers[0], 10_000)]);
    let split_id =
        ctx.splitter
            .configure_split(&ctx.caller, &ctx.token, &ctx.merchant, &total, &payers);

    ctx.splitter.cancel_split(&ctx.caller, &split_id);
    ctx.splitter.execute_split(&ctx.caller, &split_id); // must panic
}

// ── Unauthorised cancel is rejected ──────────────────────────────────────────

#[test]
#[should_panic]
fn test_unauthorized_cancel_rejected() {
    let ctx = setup();
    let total: i128 = 100_000;
    let payers = make_payers(&ctx.env, &[(&ctx.payers[0], 10_000)]);
    let split_id =
        ctx.splitter
            .configure_split(&ctx.caller, &ctx.token, &ctx.merchant, &total, &payers);

    let rogue = Address::generate(&ctx.env);
    ctx.splitter.cancel_split(&rogue, &split_id); // must panic
}

// ── Atomic failure: if any transfer would fail, nothing goes through ──────────
//
// Soroban's transaction model guarantees all-or-nothing: if `transfer_from`
// for any payer panics (e.g. insufficient token allowance), the whole
// transaction is rolled back and the merchant receives nothing.
// We simulate this by funding only payers[0] and payers[1] but not payers[2],
// then providing only 2-payer approvals while still requesting a 3-payer split.
//
// Because `mock_all_auths` is active, auth is mocked, but the token
// contract still enforces balance/allowance.  We set a zero allowance for
// payers[2] to trigger the token-level revert.

#[test]
#[should_panic]
fn test_atomic_failure_no_partial_transfer() {
    let ctx = setup();
    let total: i128 = 300; // 100 per payer
    let per_payer: i128 = 100;

    let sac = StellarAssetClient::new(&ctx.env, &ctx.token);

    // Fund and approve payers[0] and payers[1] but NOT payers[2].
    for i in 0..2usize {
        sac.mint(&ctx.payers[i], &per_payer);
        ctx.token_client.approve(
            &ctx.payers[i],
            &ctx.splitter.address,
            &per_payer,
            &1_000_000u32,
        );
    }
    // payers[2]: funded but allowance is 0 → transfer_from will fail.
    sac.mint(&ctx.payers[2], &per_payer);
    // Deliberately NOT approving ctx.payers[2].

    let payers = make_payers(
        &ctx.env,
        &[
            (&ctx.payers[0], 3334),
            (&ctx.payers[1], 3333),
            (&ctx.payers[2], 3333),
        ],
    );

    let split_id =
        ctx.splitter
            .configure_split(&ctx.caller, &ctx.token, &ctx.merchant, &total, &payers);

    // This must panic: payers[2] has no allowance → token reverts → whole tx reverts.
    ctx.splitter.execute_split(&ctx.caller, &split_id);
}

// ── Non-existent split lookup panics ─────────────────────────────────────────

#[test]
#[should_panic]
fn test_get_nonexistent_split_panics() {
    let ctx = setup();
    ctx.splitter.get_split(&999);
}

// ── Double-init panics ───────────────────────────────────────────────────────

#[test]
#[should_panic]
fn test_double_init_panics() {
    let ctx = setup();
    ctx.splitter.init(&ctx.admin);
}

// ── split_count increments correctly ────────────────────────────────────────

#[test]
fn test_split_count_increments() {
    let ctx = setup();
    assert_eq!(ctx.splitter.split_count(), 0);

    let payers = make_payers(&ctx.env, &[(&ctx.payers[0], 10_000)]);
    ctx.splitter.configure_split(
        &ctx.caller,
        &ctx.token,
        &ctx.merchant,
        &1_000_000i128,
        &payers,
    );
    assert_eq!(ctx.splitter.split_count(), 1);

    ctx.splitter.configure_split(
        &ctx.caller,
        &ctx.token,
        &ctx.merchant,
        &2_000_000i128,
        &payers,
    );
    assert_eq!(ctx.splitter.split_count(), 2);
}

// ── Admin query returns the initialised admin address ────────────────────────

#[test]
fn test_admin_query() {
    let ctx = setup();
    assert_eq!(ctx.splitter.admin(), ctx.admin);
}

// ── Timestamp is recorded on execution ───────────────────────────────────────

#[test]
fn test_executed_at_timestamp_recorded() {
    let ctx = setup();
    let total: i128 = 100_000;
    fund_and_approve(&ctx, total);

    let payers = make_payers(&ctx.env, &[(&ctx.payers[0], 10_000)]);
    let split_id =
        ctx.splitter
            .configure_split(&ctx.caller, &ctx.token, &ctx.merchant, &total, &payers);

    // Advance ledger time.
    ctx.env.ledger().with_mut(|l| {
        l.timestamp = 1_000_000;
    });

    ctx.splitter.execute_split(&ctx.caller, &split_id);

    let split = ctx.splitter.get_split(&split_id);
    assert_eq!(split.executed_at, 1_000_000);
    assert_eq!(split.created_at, split.created_at); // sanity
}
