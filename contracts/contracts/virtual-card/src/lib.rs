#![no_std]
#![allow(deprecated)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, vec, Address, Env, String, Vec,
};

// ============================================================================
// Constants
// ============================================================================

/// Seconds in a ledger-time day bucket (UTC epoch).
const SECONDS_PER_DAY: u64 = 86_400;
/// Rolling 30-day month bucket length in seconds.
const SECONDS_PER_MONTH: u64 = 86_400 * 30;

/// Time (in seconds) a contract must be continuously paused before any card
/// holder may invoke the escape-hatch withdrawal for their own balance.
///
/// 7 days — compile-time constant, not admin-settable.
pub const ESCAPE_HATCH_GRACE_PERIOD_SECS: u64 = 7 * 24 * 60 * 60; // 604 800 s

// ============================================================================
// Error Types
// ============================================================================

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum VirtualCardError {
    CardNotFound = 1,
    Unauthorized = 2,
    CardInactive = 3,
    InvalidCardState = 4,
    LimitExceeded = 5,
    InvalidInput = 6,
    Expired = 7,
    DuplicateCard = 8,
    NotSupported = 9,
    InternalError = 10,
    CounterOverflow = 11,
    DailyLimitExceeded = 12,
    MonthlyLimitExceeded = 13,
    MerchantNotAllowed = 14,
    MerchantBlocked = 15,
    ContractNotPaused = 16,
    GracePeriodNotElapsed = 17,
}

// ── Card ID u32 Upgrade Path Consideration ─────────────────────────────────────
// `card_id` is currently typed as `u32` (max ~4.29B unique card IDs).
// For high-volume multi-tenant scaling where issuance may exceed 4,294,967,295 cards:
// 1. Upgrade contract state key from `DataKey::CardCounter` (u32) to `u64`.
// 2. Migration: Retain `CardMeta(u32)` for backwards-compatible lookups while
//    introducing `CardMetaV2(u64)` (or expanding `CardMeta(u64)`) in next WASM build.
// 3. Off-chain SDK & DB mappings should parse card IDs as `u64`/`BigInt` to prevent truncation.

// ============================================================================
// Storage Keys
// ============================================================================

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    CardCounter,
    CardMeta(u32),
    CardBalance(u32),
    CardStatus(u32),
    TxCounter,
    SpendCounters(u32),
    MerchantAllowlist(u32),
    MerchantBlocklist(u32),
    /// Unix timestamp at which the contract entered the paused state.
    /// Key absent ⟹ contract is not paused.
    PausedSince,
}

// ============================================================================
// Data Types
// ============================================================================

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CardStatus {
    Pending = 0,
    Active = 1,
    Suspended = 2,
    Closed = 3,
    AwaitingActivation = 4,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CardType {
    Standard = 0,
    Premium = 1,
    Restricted = 2,
    Corporate = 3,
    Disposable = 4,
    Custom = 5,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Card {
    pub id: u32,
    pub holder: Address,
    pub card_type: CardType,
    pub balance: i128,
    pub status: CardStatus,
    pub created_at: u64,
    pub expires_at: u64,
    /// Max spend per rolling day bucket (0 = unlimited).
    pub daily_limit: i128,
    /// Max spend per rolling 30-day bucket (0 = unlimited).
    pub monthly_limit: i128,
}

/// Rolling spend counters keyed by ledger timestamp buckets.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpendCounters {
    pub daily_bucket: u64,
    pub daily_spent: i128,
    pub monthly_bucket: u64,
    pub monthly_spent: i128,
}

// ============================================================================
// Contract
// ============================================================================

#[contract]
pub struct VirtualCardContract;

impl VirtualCardContract {
    fn daily_bucket(ts: u64) -> u64 {
        ts / SECONDS_PER_DAY
    }

    fn monthly_bucket(ts: u64) -> u64 {
        ts / SECONDS_PER_MONTH
    }

    /// Load spend counters and lazily reset buckets that have rolled over.
    fn load_spend_counters(env: &Env, card_id: u32) -> SpendCounters {
        let ts = env.ledger().timestamp();
        let current_daily = Self::daily_bucket(ts);
        let current_monthly = Self::monthly_bucket(ts);

        let mut counters: SpendCounters = env
            .storage()
            .persistent()
            .get(&DataKey::SpendCounters(card_id))
            .unwrap_or(SpendCounters {
                daily_bucket: current_daily,
                daily_spent: 0,
                monthly_bucket: current_monthly,
                monthly_spent: 0,
            });

        if counters.daily_bucket != current_daily {
            counters.daily_bucket = current_daily;
            counters.daily_spent = 0;
        }
        if counters.monthly_bucket != current_monthly {
            counters.monthly_bucket = current_monthly;
            counters.monthly_spent = 0;
        }

        counters
    }

    fn save_spend_counters(env: &Env, card_id: u32, counters: &SpendCounters) {
        env.storage()
            .persistent()
            .set(&DataKey::SpendCounters(card_id), counters);
    }

    fn merchant_in_list(list: &Vec<String>, merchant: &String) -> bool {
        for i in 0..list.len() {
            if list.get(i).unwrap() == *merchant {
                return true;
            }
        }
        false
    }

    fn check_merchant(
        env: &Env,
        card_id: u32,
        merchant: &String,
    ) -> Result<(), VirtualCardError> {
        let blocklist: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::MerchantBlocklist(card_id))
            .unwrap_or(vec![env]);

        if Self::merchant_in_list(&blocklist, merchant) {
            return Err(VirtualCardError::MerchantBlocked);
        }

        let allowlist: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::MerchantAllowlist(card_id))
            .unwrap_or(vec![env]);

        if allowlist.len() > 0 && !Self::merchant_in_list(&allowlist, merchant) {
            return Err(VirtualCardError::MerchantNotAllowed);
        }

        Ok(())
    }

    fn check_velocity_limits(
        env: &Env,
        card: &Card,
        card_id: u32,
        amount: i128,
    ) -> Result<SpendCounters, VirtualCardError> {
        let mut counters = Self::load_spend_counters(env, card_id);

        if card.daily_limit > 0 {
            let new_daily = counters
                .daily_spent
                .checked_add(amount)
                .ok_or(VirtualCardError::InternalError)?;
            if new_daily > card.daily_limit {
                env.events().publish(
                    (
                        soroban_sdk::Symbol::new(env, "daily_limit_exceeded"),
                        soroban_sdk::Symbol::new(env, "card"),
                    ),
                    (card_id, amount, counters.daily_spent, card.daily_limit),
                );
                return Err(VirtualCardError::DailyLimitExceeded);
            }
        }

        if card.monthly_limit > 0 {
            let new_monthly = counters
                .monthly_spent
                .checked_add(amount)
                .ok_or(VirtualCardError::InternalError)?;
            if new_monthly > card.monthly_limit {
                env.events().publish(
                    (
                        soroban_sdk::Symbol::new(env, "monthly_limit_exceeded"),
                        soroban_sdk::Symbol::new(env, "card"),
                    ),
                    (card_id, amount, counters.monthly_spent, card.monthly_limit),
                );
                return Err(VirtualCardError::MonthlyLimitExceeded);
            }
        }

        counters.daily_spent = counters
            .daily_spent
            .checked_add(amount)
            .ok_or(VirtualCardError::InternalError)?;
        counters.monthly_spent = counters
            .monthly_spent
            .checked_add(amount)
            .ok_or(VirtualCardError::InternalError)?;

        Ok(counters)
    }

    fn remaining_for_limit(limit: i128, spent: i128) -> i128 {
        if limit <= 0 {
            i128::MAX
        } else {
            limit.saturating_sub(spent)
        }
    }
}

#[contractimpl]
impl VirtualCardContract {
    /// Issue a new virtual card for a user with an initial balance.
    /// Emits a `card_issued` event.
    ///
    /// `daily_limit` and `monthly_limit` of 0 mean unlimited for that window.
    pub fn issue_card(
        env: Env,
        user: Address,
        amount: i128,
        card_type: CardType,
        expires_at: u64,
        daily_limit: i128,
        monthly_limit: i128,
    ) -> Result<u32, VirtualCardError> {
        user.require_auth();

        if amount < 0 || daily_limit < 0 || monthly_limit < 0 {
            return Err(VirtualCardError::InvalidInput);
        }

        let current_ts = env.ledger().timestamp();
        if expires_at > 0 && expires_at <= current_ts {
            return Err(VirtualCardError::Expired);
        }

        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::CardCounter)
            .unwrap_or(0_u32);
        let card_id = count
            .checked_add(1)
            .ok_or(VirtualCardError::CounterOverflow)?;
        env.storage()
            .instance()
            .set(&DataKey::CardCounter, &card_id);

        let card = Card {
            id: card_id,
            holder: user.clone(),
            card_type,
            balance: amount,
            status: CardStatus::Active,
            created_at: current_ts,
            expires_at,
            daily_limit,
            monthly_limit,
        };

        env.storage()
            .persistent()
            .set(&DataKey::CardMeta(card_id), &card);

        let counters = SpendCounters {
            daily_bucket: Self::daily_bucket(current_ts),
            daily_spent: 0,
            monthly_bucket: Self::monthly_bucket(current_ts),
            monthly_spent: 0,
        };
        Self::save_spend_counters(&env, card_id, &counters);

        env.events().publish(
            (soroban_sdk::Symbol::new(&env, "card_issued"), user),
            (card_id, amount, current_ts),
        );

        Ok(card_id)
    }

    /// Process a payment from a virtual card.
    /// Deducts `amount` from the card balance and emits a `payment_processed` event.
    /// Auto-closes the card when balance reaches zero.
    pub fn process_payment(
        env: Env,
        card_id: u32,
        amount: i128,
        merchant: String,
    ) -> Result<u32, VirtualCardError> {
        if amount <= 0 {
            return Err(VirtualCardError::InvalidInput);
        }

        let mut card: Card = env
            .storage()
            .persistent()
            .get(&DataKey::CardMeta(card_id))
            .ok_or(VirtualCardError::CardNotFound)?;

        card.holder.require_auth();

        if card.status != CardStatus::Active {
            return Err(VirtualCardError::CardInactive);
        }

        let current_ts = env.ledger().timestamp();
        if card.expires_at > 0 && current_ts > card.expires_at {
            card.status = CardStatus::Closed;
            env.storage()
                .persistent()
                .set(&DataKey::CardMeta(card_id), &card);
            return Err(VirtualCardError::Expired);
        }

        Self::check_merchant(&env, card_id, &merchant)?;

        if amount > card.balance {
            return Err(VirtualCardError::LimitExceeded);
        }

        let counters = Self::check_velocity_limits(&env, &card, card_id, amount)?;

        card.balance -= amount;

        if card.balance == 0 {
            card.status = CardStatus::Closed;
        }

        env.storage()
            .persistent()
            .set(&DataKey::CardMeta(card_id), &card);
        Self::save_spend_counters(&env, card_id, &counters);

        let tx_count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::TxCounter)
            .unwrap_or(0_u32);
        let tx_id = tx_count
            .checked_add(1)
            .ok_or(VirtualCardError::CounterOverflow)?;
        env.storage().instance().set(&DataKey::TxCounter, &tx_id);

        env.events().publish(
            (
                soroban_sdk::Symbol::new(&env, "payment_processed"),
                soroban_sdk::Symbol::new(&env, "card"),
            ),
            (card_id, amount, merchant, current_ts),
        );

        Ok(tx_id)
    }

    /// Set the merchant allowlist for a card. Only the card holder may call this.
    /// When non-empty, only listed merchants may charge the card.
    pub fn set_merchant_allowlist(
        env: Env,
        card_id: u32,
        caller: Address,
        merchants: Vec<String>,
    ) -> Result<(), VirtualCardError> {
        caller.require_auth();

        let card: Card = env
            .storage()
            .persistent()
            .get(&DataKey::CardMeta(card_id))
            .ok_or(VirtualCardError::CardNotFound)?;

        if card.holder != caller {
            return Err(VirtualCardError::Unauthorized);
        }

        env.storage()
            .persistent()
            .set(&DataKey::MerchantAllowlist(card_id), &merchants);

        Ok(())
    }

    /// Set the merchant blocklist for a card. Only the card holder may call this.
    pub fn set_merchant_blocklist(
        env: Env,
        card_id: u32,
        caller: Address,
        merchants: Vec<String>,
    ) -> Result<(), VirtualCardError> {
        caller.require_auth();

        let card: Card = env
            .storage()
            .persistent()
            .get(&DataKey::CardMeta(card_id))
            .ok_or(VirtualCardError::CardNotFound)?;

        if card.holder != caller {
            return Err(VirtualCardError::Unauthorized);
        }

        env.storage()
            .persistent()
            .set(&DataKey::MerchantBlocklist(card_id), &merchants);

        Ok(())
    }

    /// Remaining spend allowance for the current rolling day window.
    pub fn remaining_daily(env: Env, card_id: u32) -> Result<i128, VirtualCardError> {
        let card: Card = env
            .storage()
            .persistent()
            .get(&DataKey::CardMeta(card_id))
            .ok_or(VirtualCardError::CardNotFound)?;

        let counters = Self::load_spend_counters(&env, card_id);
        Ok(Self::remaining_for_limit(
            card.daily_limit,
            counters.daily_spent,
        ))
    }

    /// Remaining spend allowance for the current rolling 30-day window.
    pub fn remaining_monthly(env: Env, card_id: u32) -> Result<i128, VirtualCardError> {
        let card: Card = env
            .storage()
            .persistent()
            .get(&DataKey::CardMeta(card_id))
            .ok_or(VirtualCardError::CardNotFound)?;

        let counters = Self::load_spend_counters(&env, card_id);
        Ok(Self::remaining_for_limit(
            card.monthly_limit,
            counters.monthly_spent,
        ))
    }

    /// Returns the current balance of a card.
    pub fn get_balance(env: Env, card_id: u32) -> i128 {
        let card: Option<Card> = env.storage().persistent().get(&DataKey::CardMeta(card_id));
        card.map(|c| c.balance).unwrap_or(0)
    }

    /// Returns the full card metadata.
    pub fn get_card(env: Env, card_id: u32) -> Result<Card, VirtualCardError> {
        env.storage()
            .persistent()
            .get(&DataKey::CardMeta(card_id))
            .ok_or(VirtualCardError::CardNotFound)
    }

    /// Activate a pending card. Caller must be the card holder.
    pub fn activate_card(env: Env, card_id: u32, caller: Address) -> Result<(), VirtualCardError> {
        caller.require_auth();

        let mut card: Card = env
            .storage()
            .persistent()
            .get(&DataKey::CardMeta(card_id))
            .ok_or(VirtualCardError::CardNotFound)?;

        if card.holder != caller {
            return Err(VirtualCardError::Unauthorized);
        }

        if card.status == CardStatus::Closed {
            return Err(VirtualCardError::InvalidCardState);
        }

        card.status = CardStatus::Active;
        env.storage()
            .persistent()
            .set(&DataKey::CardMeta(card_id), &card);

        env.events().publish(
            (soroban_sdk::Symbol::new(&env, "card_activated"), caller),
            (card_id, env.ledger().timestamp()),
        );

        Ok(())
    }

    /// Deactivate / permanently close a card. Caller must be the card holder.
    pub fn deactivate_card(
        env: Env,
        card_id: u32,
        caller: Address,
        reason: String,
    ) -> Result<(), VirtualCardError> {
        caller.require_auth();

        let mut card: Card = env
            .storage()
            .persistent()
            .get(&DataKey::CardMeta(card_id))
            .ok_or(VirtualCardError::CardNotFound)?;

        if card.holder != caller {
            return Err(VirtualCardError::Unauthorized);
        }

        card.status = CardStatus::Closed;
        env.storage()
            .persistent()
            .set(&DataKey::CardMeta(card_id), &card);

        env.events().publish(
            (
                soroban_sdk::Symbol::new(&env, "card_deactivated"),
                soroban_sdk::Symbol::new(&env, "card"),
            ),
            (card_id, reason, env.ledger().timestamp()),
        );

        Ok(())
    }

    /// Temporarily suspend a card. Caller must be the card holder.
    pub fn suspend_card(env: Env, card_id: u32, caller: Address) -> Result<(), VirtualCardError> {
        caller.require_auth();

        let mut card: Card = env
            .storage()
            .persistent()
            .get(&DataKey::CardMeta(card_id))
            .ok_or(VirtualCardError::CardNotFound)?;

        if card.holder != caller {
            return Err(VirtualCardError::Unauthorized);
        }

        if card.status != CardStatus::Active {
            return Err(VirtualCardError::InvalidCardState);
        }

        card.status = CardStatus::Suspended;
        env.storage()
            .persistent()
            .set(&DataKey::CardMeta(card_id), &card);

        env.events().publish(
            (soroban_sdk::Symbol::new(&env, "card_suspended"), caller),
            (card_id, env.ledger().timestamp()),
        );

        Ok(())
    }

    /// Verify that `claimant` is the holder of `card_id`.
    pub fn verify_ownership(env: Env, card_id: u32, claimant: Address) -> bool {
        let card: Option<Card> = env.storage().persistent().get(&DataKey::CardMeta(card_id));
        card.map(|c| c.holder == claimant).unwrap_or(false)
    }

    /// Check whether a card is eligible to process a given `amount`.
    pub fn can_transact(env: Env, card_id: u32, amount: i128) -> bool {
        let card: Option<Card> = env.storage().persistent().get(&DataKey::CardMeta(card_id));
        match card {
            None => false,
            Some(c) => {
                if c.status != CardStatus::Active {
                    return false;
                }
                if c.expires_at > 0 && env.ledger().timestamp() > c.expires_at {
                    return false;
                }
                if amount > c.balance {
                    return false;
                }
                if Self::check_velocity_limits(&env, &c, card_id, amount).is_err() {
                    return false;
                }
                true
            }
        }
    }

    /// Returns the contract version.
    pub fn version(_env: Env) -> u32 {
        2
    }

    // ── Pause / escape-hatch ─────────────────────────────────────────────────

    /// Pause the contract.
    ///
    /// Only the card-holder should call this in practice; in a real deployment
    /// this would be restricted to an admin key.  For the MVP the caller is
    /// not restricted here — add `caller.require_auth()` + admin check once an
    /// admin key storage pattern is introduced to this contract.
    pub fn pause(env: Env) {
        if !env.storage().instance().has(&DataKey::PausedSince) {
            let now = env.ledger().timestamp();
            env.storage()
                .instance()
                .set(&DataKey::PausedSince, &now);
        }
    }

    /// Unpause the contract.
    pub fn unpause(env: Env) {
        env.storage().instance().remove(&DataKey::PausedSince);
    }

    /// Returns `true` when the contract is currently paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().has(&DataKey::PausedSince)
    }

    /// Emergency escape-hatch — allows a card holder to recover their own
    /// remaining balance after the contract has been paused for longer than
    /// `ESCAPE_HATCH_GRACE_PERIOD_SECS`.
    ///
    /// In this contract the "balance" is an off-chain accounting unit (not
    /// an on-chain token balance), so the escape hatch zeroes the card and
    /// emits an auditable event.  Actual token refund happens off-chain via
    /// the event log; the on-chain record is updated so the card cannot be
    /// double-claimed.
    ///
    /// # Security
    /// * Contract MUST be paused.
    /// * Grace period MUST have elapsed.
    /// * Only the card's recorded holder may call this.
    /// * Calling a second time returns `CardInactive` — the card was already
    ///   closed/zeroed on the first call.
    pub fn escape_hatch_withdraw(
        env: Env,
        card_id: u32,
        caller: Address,
    ) -> Result<i128, VirtualCardError> {
        // ── 1. Contract must be paused ───────────────────────────
        let paused_since: u64 = env
            .storage()
            .instance()
            .get(&DataKey::PausedSince)
            .ok_or(VirtualCardError::ContractNotPaused)?;

        // ── 2. Grace period must have elapsed ────────────────────
        let now = env.ledger().timestamp();
        let elapsed = now.saturating_sub(paused_since);
        if elapsed < ESCAPE_HATCH_GRACE_PERIOD_SECS {
            return Err(VirtualCardError::GracePeriodNotElapsed);
        }

        // ── 3. Load card ──────────────────────────────────────────
        let mut card: Card = env
            .storage()
            .persistent()
            .get(&DataKey::CardMeta(card_id))
            .ok_or(VirtualCardError::CardNotFound)?;

        // ── 4. Caller must be the card holder ────────────────────
        if card.holder != caller {
            return Err(VirtualCardError::Unauthorized);
        }
        caller.require_auth();

        // ── 5. Card must still have a claimable balance ──────────
        // Closed cards have already been settled or previously escaped.
        if card.status == CardStatus::Closed {
            return Err(VirtualCardError::CardInactive);
        }

        let recoverable_balance = card.balance;

        // ── 6. EFFECTS — zero balance and close the card ─────────
        card.balance = 0;
        card.status = CardStatus::Closed;
        env.storage()
            .persistent()
            .set(&DataKey::CardMeta(card_id), &card);

        // ── 7. Emit distinct escape-hatch event ──────────────────
        env.events().publish(
            (
                soroban_sdk::Symbol::new(&env, "escape_hatch"),
                soroban_sdk::Symbol::new(&env, "card"),
            ),
            (card_id, caller, recoverable_balance, paused_since),
        );

        Ok(recoverable_balance)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod fuzz;

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, testutils::Ledger, Env};

    fn setup() -> (Env, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let user = Address::generate(&env);
        (env, user)
    }

    fn issue_standard(
        client: &VirtualCardContractClient,
        user: &Address,
        amount: i128,
    ) -> u32 {
        client.issue_card(user, &amount, &CardType::Standard, &0_u64, &0_i128, &0_i128)
    }

    #[test]
    fn test_issue_card_success() {
        let (env, user) = setup();
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = client.issue_card(
            &user,
            &1000_i128,
            &CardType::Standard,
            &0_u64,
            &100_i128,
            &500_i128,
        );

        assert_eq!(card_id, 1);
        assert_eq!(client.get_balance(&card_id), 1000_i128);

        let card = client.get_card(&card_id);
        assert_eq!(card.daily_limit, 100_i128);
        assert_eq!(card.monthly_limit, 500_i128);
    }

    #[test]
    fn test_issue_card_negative_amount() {
        let (env, user) = setup();
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let result = client.try_issue_card(
            &user,
            &(-1_i128),
            &CardType::Standard,
            &0_u64,
            &0_i128,
            &0_i128,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_process_payment_deducts_balance() {
        let (env, user) = setup();
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = issue_standard(&client, &user, 500_i128);

        client.process_payment(&card_id, &200_i128, &String::from_str(&env, "merchant_a"));

        assert_eq!(client.get_balance(&card_id), 300_i128);
    }

    #[test]
    fn test_process_payment_limit_exceeded() {
        let (env, user) = setup();
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = issue_standard(&client, &user, 100_i128);

        let result =
            client.try_process_payment(&card_id, &200_i128, &String::from_str(&env, "merchant_b"));
        assert!(result.is_err());
    }

    #[test]
    fn test_daily_limit_enforced() {
        let (env, user) = setup();
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = client.issue_card(
            &user,
            &1000_i128,
            &CardType::Standard,
            &0_u64,
            &100_i128,
            &0_i128,
        );

        client.process_payment(&card_id, &80_i128, &String::from_str(&env, "m1"));
        assert_eq!(client.remaining_daily(&card_id), 20_i128);

        let res = client.try_process_payment(
            &card_id,
            &30_i128,
            &String::from_str(&env, "m2"),
        );
        assert_eq!(res, Err(Ok(VirtualCardError::DailyLimitExceeded)));
    }

    #[test]
    fn test_daily_counter_resets_on_new_bucket() {
        let (env, user) = setup();
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = client.issue_card(
            &user,
            &1000_i128,
            &CardType::Standard,
            &0_u64,
            &100_i128,
            &0_i128,
        );

        client.process_payment(&card_id, &90_i128, &String::from_str(&env, "m1"));
        assert_eq!(client.remaining_daily(&card_id), 10_i128);

        env.ledger().set_timestamp(SECONDS_PER_DAY + 1);
        assert_eq!(client.remaining_daily(&card_id), 100_i128);

        client.process_payment(&card_id, &50_i128, &String::from_str(&env, "m1"));
        assert_eq!(client.remaining_daily(&card_id), 50_i128);
    }

    #[test]
    fn test_monthly_limit_enforced() {
        let (env, user) = setup();
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = client.issue_card(
            &user,
            &5000_i128,
            &CardType::Standard,
            &0_u64,
            &0_i128,
            &200_i128,
        );

        client.process_payment(&card_id, &150_i128, &String::from_str(&env, "m1"));

        let res = client.try_process_payment(
            &card_id,
            &60_i128,
            &String::from_str(&env, "m2"),
        );
        assert_eq!(res, Err(Ok(VirtualCardError::MonthlyLimitExceeded)));
    }

    #[test]
    fn test_monthly_counter_resets_on_new_bucket() {
        let (env, user) = setup();
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = client.issue_card(
            &user,
            &5000_i128,
            &CardType::Standard,
            &0_u64,
            &0_i128,
            &200_i128,
        );

        client.process_payment(&card_id, &180_i128, &String::from_str(&env, "m1"));
        assert_eq!(client.remaining_monthly(&card_id), 20_i128);

        env.ledger().set_timestamp(SECONDS_PER_MONTH + 1);
        assert_eq!(client.remaining_monthly(&card_id), 200_i128);
    }

    #[test]
    fn test_merchant_allowlist_rejects_unknown() {
        let (env, user) = setup();
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = issue_standard(&client, &user, 500_i128);

        let allowlist = vec![
            &env,
            String::from_str(&env, "netflix"),
            String::from_str(&env, "spotify"),
        ];
        client.set_merchant_allowlist(&card_id, &user, &allowlist);

        let ok = client.try_process_payment(
            &card_id,
            &10_i128,
            &String::from_str(&env, "netflix"),
        );
        assert!(ok.is_ok());

        let bad = client.try_process_payment(
            &card_id,
            &10_i128,
            &String::from_str(&env, "unknown_merchant"),
        );
        assert_eq!(bad, Err(Ok(VirtualCardError::MerchantNotAllowed)));
    }

    #[test]
    fn test_merchant_blocklist_rejects() {
        let (env, user) = setup();
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = issue_standard(&client, &user, 500_i128);

        let blocklist = vec![&env, String::from_str(&env, "bad_actor")];
        client.set_merchant_blocklist(&card_id, &user, &blocklist);

        let res = client.try_process_payment(
            &card_id,
            &10_i128,
            &String::from_str(&env, "bad_actor"),
        );
        assert_eq!(res, Err(Ok(VirtualCardError::MerchantBlocked)));
    }

    #[test]
    fn test_unauthorized_allowlist_mutation() {
        let (env, user) = setup();
        let attacker = Address::generate(&env);
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = issue_standard(&client, &user, 100_i128);

        let allowlist = vec![&env, String::from_str(&env, "netflix")];
        let res = client.try_set_merchant_allowlist(&card_id, &attacker, &allowlist);
        assert_eq!(res, Err(Ok(VirtualCardError::Unauthorized)));
    }

    #[test]
    fn test_suspended_card_cannot_process_payment() {
        let (env, user) = setup();
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = issue_standard(&client, &user, 100_i128);
        client.suspend_card(&card_id, &user);

        let res = client.try_process_payment(
            &card_id,
            &50_i128,
            &String::from_str(&env, "merchant_suspended"),
        );
        assert_eq!(res, Err(Ok(VirtualCardError::CardInactive)));
    }

    #[test]
    fn test_auto_close_on_zero_balance() {
        let (env, user) = setup();
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = client.issue_card(
            &user,
            &100_i128,
            &CardType::Disposable,
            &0_u64,
            &0_i128,
            &0_i128,
        );

        client.process_payment(&card_id, &100_i128, &String::from_str(&env, "merchant_c"));

        let card = client.get_card(&card_id);
        assert_eq!(card.status, CardStatus::Closed);
    }

    #[test]
    fn test_verify_ownership() {
        let (env, user) = setup();
        let other = Address::generate(&env);
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = issue_standard(&client, &user, 100_i128);

        assert!(client.verify_ownership(&card_id, &user));
        assert!(!client.verify_ownership(&card_id, &other));
    }

    #[test]
    fn test_deactivate_card() {
        let (env, user) = setup();
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = issue_standard(&client, &user, 100_i128);

        client.deactivate_card(&card_id, &user, &String::from_str(&env, "user_request"));

        let card = client.get_card(&card_id);
        assert_eq!(card.status, CardStatus::Closed);
    }

    #[test]
    fn test_unauthorized_deactivation() {
        let (env, user) = setup();
        let attacker = Address::generate(&env);
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = issue_standard(&client, &user, 100_i128);

        let result =
            client.try_deactivate_card(&card_id, &attacker, &String::from_str(&env, "attack"));
        assert!(result.is_err());
    }

    #[test]
    fn test_can_transact() {
        let (env, user) = setup();
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = issue_standard(&client, &user, 100_i128);

        assert!(client.can_transact(&card_id, &50_i128));
        assert!(!client.can_transact(&card_id, &150_i128));
    }

    #[test]
    fn test_error_types_defined() {
        let errors = [
            VirtualCardError::CardNotFound,
            VirtualCardError::Unauthorized,
            VirtualCardError::CardInactive,
            VirtualCardError::InvalidCardState,
            VirtualCardError::LimitExceeded,
            VirtualCardError::InvalidInput,
            VirtualCardError::Expired,
            VirtualCardError::DuplicateCard,
            VirtualCardError::NotSupported,
            VirtualCardError::InternalError,
            VirtualCardError::DailyLimitExceeded,
            VirtualCardError::MonthlyLimitExceeded,
            VirtualCardError::MerchantNotAllowed,
            VirtualCardError::MerchantBlocked,
        ];
        assert_eq!(errors.len(), 14);
    }

    // ── Escape-hatch tests ───────────────────────────────────────

    #[test]
    fn test_escape_hatch_recovers_balance_after_grace_period() {
        let (env, user) = setup();
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = client.issue_card(
            &user,
            &800_i128,
            &CardType::Standard,
            &0_u64,
            &0_i128,
            &0_i128,
        );

        // Spend some balance first
        client.process_payment(&card_id, &200_i128, &String::from_str(&env, "merchant"));
        assert_eq!(client.get_balance(&card_id), 600_i128);

        // Pause and advance past grace period
        client.pause();
        let paused_at = env.ledger().timestamp();
        env.ledger().set_timestamp(paused_at + ESCAPE_HATCH_GRACE_PERIOD_SECS + 1);

        let recovered = client.escape_hatch_withdraw(&card_id, &user);
        assert_eq!(recovered, 600_i128);

        // Card must be closed and zeroed
        let card = client.get_card(&card_id);
        assert_eq!(card.balance, 0_i128);
        assert_eq!(card.status, CardStatus::Closed);
    }

    #[test]
    fn test_escape_hatch_fails_before_grace_period() {
        let (env, user) = setup();
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = issue_standard(&client, &user, 500_i128);

        client.pause();
        let paused_at = env.ledger().timestamp();
        // Only 1 second elapsed
        env.ledger().set_timestamp(paused_at + 1);

        let result = client.try_escape_hatch_withdraw(&card_id, &user);
        assert_eq!(result, Err(Ok(VirtualCardError::GracePeriodNotElapsed)));
    }

    #[test]
    fn test_escape_hatch_fails_when_not_paused() {
        let (env, user) = setup();
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = issue_standard(&client, &user, 500_i128);

        // No pause — must fail
        let result = client.try_escape_hatch_withdraw(&card_id, &user);
        assert_eq!(result, Err(Ok(VirtualCardError::ContractNotPaused)));
    }

    #[test]
    fn test_escape_hatch_fails_after_unpause() {
        let (env, user) = setup();
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = issue_standard(&client, &user, 500_i128);

        client.pause();
        let paused_at = env.ledger().timestamp();
        env.ledger().set_timestamp(paused_at + ESCAPE_HATCH_GRACE_PERIOD_SECS + 1);
        client.unpause();

        let result = client.try_escape_hatch_withdraw(&card_id, &user);
        assert_eq!(result, Err(Ok(VirtualCardError::ContractNotPaused)));
    }

    #[test]
    fn test_escape_hatch_cross_user_theft_prevented() {
        let (env, user) = setup();
        let attacker = Address::generate(&env);
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = issue_standard(&client, &user, 500_i128);

        client.pause();
        let paused_at = env.ledger().timestamp();
        env.ledger().set_timestamp(paused_at + ESCAPE_HATCH_GRACE_PERIOD_SECS + 1);

        // Attacker is not the card holder
        let result = client.try_escape_hatch_withdraw(&card_id, &attacker);
        assert_eq!(result, Err(Ok(VirtualCardError::Unauthorized)));
    }

    #[test]
    fn test_escape_hatch_cannot_double_withdraw() {
        let (env, user) = setup();
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = issue_standard(&client, &user, 500_i128);

        client.pause();
        let paused_at = env.ledger().timestamp();
        env.ledger().set_timestamp(paused_at + ESCAPE_HATCH_GRACE_PERIOD_SECS + 1);

        client.escape_hatch_withdraw(&card_id, &user);

        // Second call must fail — card is now Closed
        let result = client.try_escape_hatch_withdraw(&card_id, &user);
        assert_eq!(result, Err(Ok(VirtualCardError::CardInactive)));
    }

    #[test]
    fn test_escape_hatch_zero_balance_card() {
        let (env, user) = setup();
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        // Issue and immediately spend full balance so it auto-closes
        let card_id = client.issue_card(
            &user,
            &100_i128,
            &CardType::Disposable,
            &0_u64,
            &0_i128,
            &0_i128,
        );
        client.process_payment(&card_id, &100_i128, &String::from_str(&env, "merchant"));

        // Card is now Closed with zero balance
        let card = client.get_card(&card_id);
        assert_eq!(card.status, CardStatus::Closed);

        client.pause();
        let paused_at = env.ledger().timestamp();
        env.ledger().set_timestamp(paused_at + ESCAPE_HATCH_GRACE_PERIOD_SECS + 1);

        // Closed card — escape hatch correctly refuses
        let result = client.try_escape_hatch_withdraw(&card_id, &user);
        assert_eq!(result, Err(Ok(VirtualCardError::CardInactive)));
    }
}
