#![no_std]
#![allow(deprecated)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Env, String, Symbol,
};

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
}

// ============================================================================
// Contract
// ============================================================================

#[contract]
pub struct VirtualCardContract;

#[contractimpl]
impl VirtualCardContract {
    /// Issue a new virtual card for a user with an initial balance.
    /// Emits a `card_issued` event.
    pub fn issue_card(
        env: Env,
        user: Address,
        amount: i128,
        card_type: CardType,
        expires_at: u64,
    ) -> Result<u32, VirtualCardError> {
        user.require_auth();

        if amount < 0 {
            return Err(VirtualCardError::InvalidInput);
        }

        let current_ts = env.ledger().timestamp();
        if expires_at > 0 && expires_at <= current_ts {
            return Err(VirtualCardError::Expired);
        }

        // Increment card counter
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
        };

        env.storage()
            .persistent()
            .set(&DataKey::CardMeta(card_id), &card);

        env.events().publish(
            (Symbol::new(&env, "card_issued"), user),
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

        if amount > card.balance {
            return Err(VirtualCardError::LimitExceeded);
        }

        card.balance -= amount;

        // Auto-cancel card when balance reaches zero (Disposable-style behaviour)
        if card.balance == 0 {
            card.status = CardStatus::Closed;
        }

        env.storage()
            .persistent()
            .set(&DataKey::CardMeta(card_id), &card);

        // Increment transaction counter
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
                Symbol::new(&env, "payment_processed"),
                Symbol::new(&env, "card"),
            ),
            (card_id, amount, merchant, current_ts),
        );

        Ok(tx_id)
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
    /// Emits a `card_activated` event.
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
            (Symbol::new(&env, "card_activated"), caller),
            (card_id, env.ledger().timestamp()),
        );

        Ok(())
    }

    /// Deactivate / permanently close a card. Caller must be the card holder.
    /// Emits a `card_deactivated` event.
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
                Symbol::new(&env, "card_deactivated"),
                Symbol::new(&env, "card"),
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
            (Symbol::new(&env, "card_suspended"), caller),
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
                c.balance >= amount
            }
        }
    }

    /// Returns the contract version.
    pub fn version(_env: Env) -> u32 {
        1
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod fuzz;


#[cfg(test)]
mod negative;

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    fn setup() -> (Env, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let user = Address::generate(&env);
        (env, user)
    }

    #[test]
    fn test_issue_card_success() {
        let (env, user) = setup();
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = client.issue_card(&user, &1000_i128, &CardType::Standard, &0_u64);

        assert_eq!(card_id, 1);
        assert_eq!(client.get_balance(&card_id), 1000_i128);
    }

    #[test]
    fn test_issue_card_negative_amount() {
        let (env, user) = setup();
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let result = client.try_issue_card(&user, &(-1_i128), &CardType::Standard, &0_u64);
        assert!(result.is_err());
    }

    #[test]
    fn test_process_payment_deducts_balance() {
        let (env, user) = setup();
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = client.issue_card(&user, &500_i128, &CardType::Standard, &0_u64);

        client.process_payment(&card_id, &200_i128, &String::from_str(&env, "merchant_a"));

        assert_eq!(client.get_balance(&card_id), 300_i128);
    }

    #[test]
    fn test_process_payment_limit_exceeded() {
        let (env, user) = setup();
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = client.issue_card(&user, &100_i128, &CardType::Standard, &0_u64);

        let result =
            client.try_process_payment(&card_id, &200_i128, &String::from_str(&env, "merchant_b"));
        assert!(result.is_err());
    }

    #[test]
    fn test_suspended_card_cannot_process_payment() {
        let (env, user) = setup();
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = client.issue_card(&user, &100_i128, &CardType::Standard, &0_u64);

        // Suspend the card as the holder
        client.suspend_card(&card_id, &user);

        // Attempt to process a payment from a suspended card
        let res = client.try_process_payment(
            &card_id,
            &50_i128,
            &String::from_str(&env, "merchant_suspended"),
        );

        // Expect the specific typed error for inactive/suspended cards
        assert_eq!(res, Err(Ok(VirtualCardError::CardInactive)));
    }

    #[test]
    fn test_auto_close_on_zero_balance() {
        let (env, user) = setup();
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = client.issue_card(&user, &100_i128, &CardType::Disposable, &0_u64);

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

        let card_id = client.issue_card(&user, &100_i128, &CardType::Standard, &0_u64);

        assert!(client.verify_ownership(&card_id, &user));
        assert!(!client.verify_ownership(&card_id, &other));
    }

    #[test]
    fn test_deactivate_card() {
        let (env, user) = setup();
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = client.issue_card(&user, &100_i128, &CardType::Standard, &0_u64);

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

        let card_id = client.issue_card(&user, &100_i128, &CardType::Standard, &0_u64);

        let result =
            client.try_deactivate_card(&card_id, &attacker, &String::from_str(&env, "attack"));
        assert!(result.is_err());
    }

    #[test]
    fn test_can_transact() {
        let (env, user) = setup();
        let contract_id = env.register(VirtualCardContract, ());
        let client = VirtualCardContractClient::new(&env, &contract_id);

        let card_id = client.issue_card(&user, &100_i128, &CardType::Standard, &0_u64);

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
        ];
        assert_eq!(errors.len(), 10);
    }
}
