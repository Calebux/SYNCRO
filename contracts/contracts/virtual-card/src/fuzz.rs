#![cfg(test)]
extern crate std;

use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, EnvTestConfig, Ledger},
    Address, Env, String,
};
// removed unused panic helpers

use super::{CardStatus, CardType, VirtualCardContract, VirtualCardContractClient};

fn fuzz_env() -> Env {
    Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
    })
}

fn fuzz_setup() -> (Env, Address) {
    let env = fuzz_env();
    env.mock_all_auths();
    let user = Address::generate(&env);
    (env, user)
}

fn register_client(env: &Env) -> VirtualCardContractClient<'static> {
    let contract_id = env.register(VirtualCardContract, ());
    VirtualCardContractClient::new(env, &contract_id)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(8))]

    // ── Monetary invariants ──────────────────────────────────────────────────

    /// Issuing a card with any non-negative amount must succeed.
    /// The balance returned by get_balance must equal the issued amount.
    #[test]
    fn fuzz_issue_card_balance_matches(amount in 0i128..=1_000_000_000i128) {
        let (env, user) = fuzz_setup();
        let client = register_client(&env);

        let card_id = client
            .issue_card(&user, &amount, &CardType::Standard, &0u64);

        prop_assert_eq!(client.get_balance(&card_id), amount);
        let card = client.get_card(&card_id);
        prop_assert_eq!(card.balance, amount);
        prop_assert_eq!(card.status, CardStatus::Active);
    }

    /// Balance after a single payment must equal initial_balance - payment_amount.
    /// The invariant holds for any payment ≤ balance.
    #[test]
    fn fuzz_payment_reduces_balance_exactly(
        initial in 1i128..=1_000_000_000i128,
        payment in 1i128..=1_000_000_000i128,
    ) {
        let (env, user) = fuzz_setup();
        let client = register_client(&env);
        let merchant = String::from_str(&env, "merchant");

        let card_id = client
            .issue_card(&user, &initial, &CardType::Standard, &0u64);

        if payment <= initial {
            client.process_payment(&card_id, &payment, &merchant);
            prop_assert_eq!(client.get_balance(&card_id), initial - payment);
        } else {
            let result = client.try_process_payment(&card_id, &payment, &merchant);
            prop_assert!(result.is_err(), "payment exceeding balance must fail");
            prop_assert_eq!(client.get_balance(&card_id), initial, "balance unchanged after rejected payment");
        }
    }

    /// After sequential payments that sum to ≤ initial_balance, the remaining
    /// balance must always equal initial - sum(payments). No funds disappear.
    #[test]
    fn fuzz_sequential_payments_balance_conservation(
        initial in 100i128..=1_000_000_000i128,
        payments in prop::collection::vec(1i128..=100i128, 1..=5),
    ) {
        let (env, user) = fuzz_setup();
        let client = register_client(&env);
        let merchant = String::from_str(&env, "merchant");

        let card_id = client
            .issue_card(&user, &initial, &CardType::Standard, &0u64);

        let mut expected = initial;
        for p in &payments {
            if *p <= expected {
                client.process_payment(&card_id, p, &merchant);
                expected -= p;
            }
        }

        prop_assert_eq!(client.get_balance(&card_id), expected);
    }

    /// Negative and zero payment amounts must always be rejected.
    /// Balance must remain unchanged.
    #[test]
    fn fuzz_invalid_payment_amounts_rejected(
        initial in 1i128..=1_000_000_000i128,
        bad_payment in i128::MIN..=0i128,
    ) {
        let (env, user) = fuzz_setup();
        let client = register_client(&env);
        let merchant = String::from_str(&env, "merchant");

        let card_id = client
            .issue_card(&user, &initial, &CardType::Standard, &0u64);

        let result = client.try_process_payment(&card_id, &bad_payment, &merchant);
        prop_assert!(result.is_err(), "non-positive payment amount must fail");
        prop_assert_eq!(client.get_balance(&card_id), initial);
    }

    /// Negative issue amounts must be rejected.
    #[test]
    fn fuzz_negative_issue_amount_rejected(amount in i128::MIN..=-1i128) {
        let (env, user) = fuzz_setup();
        let client = register_client(&env);

        let result = client.try_issue_card(&user, &amount, &CardType::Standard, &0u64);
        prop_assert!(result.is_err(), "negative issue amount must be rejected");
    }

    // ── State transition invariants ──────────────────────────────────────────

    /// A card that reaches zero balance via process_payment must transition to
    /// Closed automatically — no further payments possible.
    #[test]
    fn fuzz_auto_close_on_zero_balance(amount in 1i128..=1_000_000_000i128) {
        let (env, user) = fuzz_setup();
        let client = register_client(&env);
        let merchant = String::from_str(&env, "merchant");

        let card_id = client
            .issue_card(&user, &amount, &CardType::Disposable, &0u64);

        client.process_payment(&card_id, &amount, &merchant);

        let card = client.get_card(&card_id);
        prop_assert_eq!(card.status, CardStatus::Closed, "card must auto-close at zero balance");
        prop_assert_eq!(card.balance, 0i128);

        // Subsequent payment on closed card must fail
        let result = client.try_process_payment(&card_id, &1i128, &merchant);
        prop_assert!(result.is_err(), "payment on closed card must fail");
    }

    /// Suspending an Active card must transition it to Suspended.
    /// Payments on a Suspended card must be rejected.
    #[test]
    fn fuzz_suspend_blocks_payments(amount in 1i128..=1_000_000_000i128) {
        let (env, user) = fuzz_setup();
        let client = register_client(&env);
        let merchant = String::from_str(&env, "merchant");

        let card_id = client
            .issue_card(&user, &amount, &CardType::Standard, &0u64);

        client.suspend_card(&card_id, &user);

        let card = client.get_card(&card_id);
        prop_assert_eq!(card.status, CardStatus::Suspended);

        let result = client.try_process_payment(&card_id, &1i128, &merchant);
        prop_assert!(result.is_err(), "payment on suspended card must fail");
        prop_assert_eq!(client.get_balance(&card_id), amount, "balance unchanged after suspension");
    }

    /// Deactivating a card must transition it to Closed and block all further
    /// payments. Balance must remain unchanged (funds not destroyed).
    #[test]
    fn fuzz_deactivate_blocks_payments(amount in 1i128..=1_000_000_000i128) {
        let (env, user) = fuzz_setup();
        let client = register_client(&env);
        let merchant = String::from_str(&env, "merchant");
        let reason = String::from_str(&env, "user_request");

        let card_id = client
            .issue_card(&user, &amount, &CardType::Standard, &0u64);

        client.deactivate_card(&card_id, &user, &reason);

        let card = client.get_card(&card_id);
        prop_assert_eq!(card.status, CardStatus::Closed);
        prop_assert_eq!(card.balance, amount, "balance preserved after deactivation");

        let result = client.try_process_payment(&card_id, &1i128, &merchant);
        prop_assert!(result.is_err(), "payment on closed card must fail");
    }

    // ── Authorization invariants ─────────────────────────────────────────────

    /// Only the card holder may suspend their card. A random stranger must be
    /// rejected without mutating card state.
    #[test]
    fn fuzz_unauthorized_suspend_rejected(amount in 1i128..=1_000_000_000i128) {
        let (env, user) = fuzz_setup();
        let attacker = Address::generate(&env);
        let client = register_client(&env);

        let card_id = client
            .issue_card(&user, &amount, &CardType::Standard, &0u64);

        let result = client.try_suspend_card(&card_id, &attacker);
        prop_assert!(result.is_err(), "unauthorized suspend must fail");

        let card = client.get_card(&card_id);
        prop_assert_eq!(card.status, CardStatus::Active, "status must be unchanged");
    }

    /// Only the card holder may deactivate their card. An attacker must be
    /// rejected.
    #[test]
    fn fuzz_unauthorized_deactivate_rejected(amount in 1i128..=1_000_000_000i128) {
        let (env, user) = fuzz_setup();
        let attacker = Address::generate(&env);
        let client = register_client(&env);
        let reason = String::from_str(&env, "attack");

        let card_id = client
            .issue_card(&user, &amount, &CardType::Standard, &0u64);

        let result = client.try_deactivate_card(&card_id, &attacker, &reason);
        prop_assert!(result.is_err(), "unauthorized deactivation must fail");

        let card = client.get_card(&card_id);
        prop_assert_eq!(card.status, CardStatus::Active);
    }

    /// verify_ownership must return true only for the legitimate holder and
    /// false for any other address.
    #[test]
    fn fuzz_ownership_check_correct(amount in 1i128..=1_000_000_000i128) {
        let (env, user) = fuzz_setup();
        let stranger = Address::generate(&env);
        let client = register_client(&env);

        let card_id = client
            .issue_card(&user, &amount, &CardType::Standard, &0u64);

        prop_assert!(client.verify_ownership(&card_id, &user), "holder must be verified");
        prop_assert!(!client.verify_ownership(&card_id, &stranger), "stranger must not be verified");
    }

    // ── Expiry invariants ────────────────────────────────────────────────────

    /// A card whose expiry is in the past (relative to ledger time) must reject
    /// issue_card with Expired.
    #[test]
    fn fuzz_expired_card_issue_rejected(
        amount in 1i128..=1_000_000_000i128,
        past_offset in 1u64..=86_400u64,
    ) {
        let (env, user) = fuzz_setup();
        let client = register_client(&env);

        let now = env.ledger().timestamp();
        // expires_at is in the past
        let expires_at = now.saturating_sub(past_offset);

        // expires_at == 0 means "no expiry", so only test when > 0
        if expires_at > 0 {
            let result = client.try_issue_card(&user, &amount, &CardType::Standard, &expires_at);
            prop_assert!(result.is_err(), "issuing a card with past expiry must fail");
        }
    }

    /// After expiry, process_payment must return Expired and leave persisted
    /// card state unchanged because the failing invocation rolls back.
    #[test]
    fn fuzz_payment_after_expiry_rejected(amount in 1i128..=1_000_000_000i128) {
        let (env, user) = fuzz_setup();
        let client = register_client(&env);
        let merchant = String::from_str(&env, "merchant");

        let now = env.ledger().timestamp();
        let expires_at = now + 100u64;

        let card_id = client
            .issue_card(&user, &amount, &CardType::Standard, &expires_at);

        // Advance ledger past expiry
        env.ledger().set_timestamp(expires_at + 1);

        let result = client.try_process_payment(&card_id, &1i128, &merchant);
        prop_assert!(result.is_err(), "payment after expiry must fail");

        // Failed invocations roll back, so the persisted card remains Active.
        let card = client.get_card(&card_id);
        prop_assert_eq!(card.status, CardStatus::Active);
    }

    // ── Card ID monotonicity ──────────────────────────────────────────────────

    /// Card IDs must be sequentially assigned starting from 1 and must never
    /// skip or repeat.
    #[test]
    fn fuzz_card_id_sequential(n in 1u32..=10u32) {
        let (env, user) = fuzz_setup();
        let client = register_client(&env);

        for expected_id in 1..=n {
            let card_id = client
                .issue_card(&user, &100i128, &CardType::Standard, &0u64);
            prop_assert_eq!(card_id, expected_id, "card IDs must be sequential from 1");
        }
    }
}
