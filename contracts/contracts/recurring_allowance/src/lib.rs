#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    Address, Env,
};

// ── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Allowance(Address, Address, Address), // (user, merchant, token)
}

// ── Data Types ───────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecurringAllowance {
    pub user: Address,
    pub merchant: Address,
    pub token: Address,
    pub per_period_cap: i128,
    pub period_duration: u64,
    pub absolute_cap: i128,
    pub expiration: u64,
    pub current_period_start: u64,
    pub current_period_spent: i128,
    pub total_spent: i128,
    pub is_active: bool,
}

// ── Error Types ──────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RecurringAllowanceError {
    AllowanceNotFound = 1,
    AllowanceInactive = 2,
    Unauthorized = 3,
    InvalidAmount = 4,
    InvalidCap = 5,
    InvalidPeriod = 6,
    Expired = 7,
    PeriodCapExceeded = 8,
    AbsoluteCapExceeded = 9,
    AlreadyActive = 10,
}

// ── Events ───────────────────────────────────────────────────────────────────

#[contractevent]
pub struct AllowanceGranted {
    pub user: Address,
    pub merchant: Address,
    pub token: Address,
    pub per_period_cap: i128,
    pub period_duration: u64,
    pub absolute_cap: i128,
    pub expiration: u64,
}

#[contractevent]
pub struct AllowanceRevoked {
    pub user: Address,
    pub merchant: Address,
    pub token: Address,
}

#[contractevent]
pub struct AllowanceConsumed {
    pub user: Address,
    pub merchant: Address,
    pub token: Address,
    pub amount: i128,
    pub period_spent: i128,
    pub total_spent: i128,
}

#[contractevent]
pub struct AllowanceUpdated {
    pub user: Address,
    pub merchant: Address,
    pub token: Address,
    pub new_per_period_cap: i128,
    pub new_period_duration: u64,
    pub new_absolute_cap: i128,
    pub new_expiration: u64,
}

// ── Contract Implementation ──────────────────────────────────────────────────

#[contract]
pub struct RecurringAllowanceContract;

#[contractimpl]
impl RecurringAllowanceContract {
    /// Grant a recurring allowance to a merchant for spending tokens from user's account.
    ///
    /// # Arguments
    /// * `user` - Authorizing account (fund source)
    /// * `merchant` - Authorized merchant allowed to pull tokens
    /// * `token` - Token contract address
    /// * `per_period_cap` - Max pull amount allowed in any single period (> 0)
    /// * `period_duration` - Duration of a period in seconds (> 0)
    /// * `absolute_cap` - Lifetime spending limit across all periods (0 for unlimited)
    /// * `expiration` - Timestamp after which no pulls are permitted (0 for no expiration)
    pub fn grant_allowance(
        env: Env,
        user: Address,
        merchant: Address,
        token: Address,
        per_period_cap: i128,
        period_duration: u64,
        absolute_cap: i128,
        expiration: u64,
    ) {
        user.require_auth();

        if per_period_cap <= 0 {
            panic_with_error!(&env, RecurringAllowanceError::InvalidAmount);
        }
        if period_duration == 0 {
            panic_with_error!(&env, RecurringAllowanceError::InvalidPeriod);
        }
        if absolute_cap < 0 || (absolute_cap > 0 && absolute_cap < per_period_cap) {
            panic_with_error!(&env, RecurringAllowanceError::InvalidCap);
        }

        let now = env.ledger().timestamp();
        if expiration > 0 && expiration <= now {
            panic_with_error!(&env, RecurringAllowanceError::Expired);
        }

        let key = DataKey::Allowance(user.clone(), merchant.clone(), token.clone());

        let allowance = RecurringAllowance {
            user: user.clone(),
            merchant: merchant.clone(),
            token: token.clone(),
            per_period_cap,
            period_duration,
            absolute_cap,
            expiration,
            current_period_start: now,
            current_period_spent: 0,
            total_spent: 0,
            is_active: true,
        };

        env.storage().persistent().set(&key, &allowance);

        AllowanceGranted {
            user,
            merchant,
            token,
            per_period_cap,
            period_duration,
            absolute_cap,
            expiration,
        }
        .publish(&env);
    }

    /// Revoke an existing active allowance. Only user (authorizer) can call this.
    pub fn revoke_allowance(env: Env, user: Address, merchant: Address, token: Address) {
        user.require_auth();

        let key = DataKey::Allowance(user.clone(), merchant.clone(), token.clone());

        let mut allowance: RecurringAllowance =
            env.storage().persistent().get(&key).unwrap_or_else(|| {
                panic_with_error!(&env, RecurringAllowanceError::AllowanceNotFound)
            });

        if !allowance.is_active {
            panic_with_error!(&env, RecurringAllowanceError::AllowanceInactive);
        }

        allowance.is_active = false;
        env.storage().persistent().set(&key, &allowance);

        AllowanceRevoked {
            user,
            merchant,
            token,
        }
        .publish(&env);
    }

    /// Consume (pull) tokens from user according to granted recurring allowance limits.
    /// Only merchant can call this.
    pub fn consume_allowance(
        env: Env,
        merchant: Address,
        user: Address,
        token: Address,
        amount: i128,
    ) {
        merchant.require_auth();

        if amount <= 0 {
            panic_with_error!(&env, RecurringAllowanceError::InvalidAmount);
        }

        let key = DataKey::Allowance(user.clone(), merchant.clone(), token.clone());

        let mut allowance: RecurringAllowance =
            env.storage().persistent().get(&key).unwrap_or_else(|| {
                panic_with_error!(&env, RecurringAllowanceError::AllowanceNotFound)
            });

        if !allowance.is_active {
            panic_with_error!(&env, RecurringAllowanceError::AllowanceInactive);
        }

        let now = env.ledger().timestamp();
        if allowance.expiration > 0 && now >= allowance.expiration {
            panic_with_error!(&env, RecurringAllowanceError::Expired);
        }

        // Check if a new period has started and reset period spend counter if needed
        if now >= allowance.current_period_start + allowance.period_duration {
            let elapsed = now - allowance.current_period_start;
            let periods_passed = elapsed / allowance.period_duration;
            allowance.current_period_start += periods_passed * allowance.period_duration;
            allowance.current_period_spent = 0;
        }

        // Validate per-period cap
        if allowance.current_period_spent + amount > allowance.per_period_cap {
            panic_with_error!(&env, RecurringAllowanceError::PeriodCapExceeded);
        }

        // Validate absolute lifetime cap
        if allowance.absolute_cap > 0 && allowance.total_spent + amount > allowance.absolute_cap {
            panic_with_error!(&env, RecurringAllowanceError::AbsoluteCapExceeded);
        }

        // Execute token transfer from user to merchant using contract spending authority
        let token_client = token::Client::new(&env, &token);
        token_client.transfer_from(&env.current_contract_address(), &user, &merchant, &amount);

        // Update allowance state
        allowance.current_period_spent += amount;
        allowance.total_spent += amount;

        env.storage().persistent().set(&key, &allowance);

        AllowanceConsumed {
            user,
            merchant,
            token,
            amount,
            period_spent: allowance.current_period_spent,
            total_spent: allowance.total_spent,
        }
        .publish(&env);
    }

    /// Update parameters of an existing allowance. Only user (authorizer) can call this.
    pub fn update_allowance(
        env: Env,
        user: Address,
        merchant: Address,
        token: Address,
        new_per_period_cap: i128,
        new_period_duration: u64,
        new_absolute_cap: i128,
        new_expiration: u64,
    ) {
        user.require_auth();

        if new_per_period_cap <= 0 {
            panic_with_error!(&env, RecurringAllowanceError::InvalidAmount);
        }
        if new_period_duration == 0 {
            panic_with_error!(&env, RecurringAllowanceError::InvalidPeriod);
        }
        if new_absolute_cap < 0 || (new_absolute_cap > 0 && new_absolute_cap < new_per_period_cap) {
            panic_with_error!(&env, RecurringAllowanceError::InvalidCap);
        }

        let now = env.ledger().timestamp();
        if new_expiration > 0 && new_expiration <= now {
            panic_with_error!(&env, RecurringAllowanceError::Expired);
        }

        let key = DataKey::Allowance(user.clone(), merchant.clone(), token.clone());

        let mut allowance: RecurringAllowance =
            env.storage().persistent().get(&key).unwrap_or_else(|| {
                panic_with_error!(&env, RecurringAllowanceError::AllowanceNotFound)
            });

        if !allowance.is_active {
            panic_with_error!(&env, RecurringAllowanceError::AllowanceInactive);
        }

        allowance.per_period_cap = new_per_period_cap;
        allowance.period_duration = new_period_duration;
        allowance.absolute_cap = new_absolute_cap;
        allowance.expiration = new_expiration;

        env.storage().persistent().set(&key, &allowance);

        AllowanceUpdated {
            user,
            merchant,
            token,
            new_per_period_cap,
            new_period_duration,
            new_absolute_cap,
            new_expiration,
        }
        .publish(&env);
    }

    /// Get allowance details for given (user, merchant, token).
    pub fn get_allowance(
        env: Env,
        user: Address,
        merchant: Address,
        token: Address,
    ) -> RecurringAllowance {
        let key = DataKey::Allowance(user, merchant, token);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, RecurringAllowanceError::AllowanceNotFound))
    }

    /// Get remaining allowance for the current period.
    pub fn get_remaining_period_allowance(
        env: Env,
        user: Address,
        merchant: Address,
        token: Address,
    ) -> i128 {
        let allowance = Self::get_allowance(env.clone(), user, merchant, token);
        if !allowance.is_active {
            return 0;
        }

        let now = env.ledger().timestamp();
        if allowance.expiration > 0 && now >= allowance.expiration {
            return 0;
        }

        let current_spent = if now >= allowance.current_period_start + allowance.period_duration {
            0
        } else {
            allowance.current_period_spent
        };

        allowance.per_period_cap.saturating_sub(current_spent)
    }

    /// Get remaining lifetime allowance (returns -1 if uncapped).
    pub fn get_remaining_absolute_allowance(
        env: Env,
        user: Address,
        merchant: Address,
        token: Address,
    ) -> i128 {
        let allowance = Self::get_allowance(env.clone(), user, merchant, token);
        if !allowance.is_active {
            return 0;
        }

        if allowance.absolute_cap == 0 {
            -1 // Uncapped
        } else {
            allowance.absolute_cap.saturating_sub(allowance.total_spent)
        }
    }
}

// ── Unit Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::{StellarAssetClient, TokenClient},
    };

    fn setup() -> (Env, Address, Address, Address, TokenClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let merchant = Address::generate(&env);

        let sac = env.register_stellar_asset_contract_v2(admin);
        let token = TokenClient::new(&env, &sac.address());
        let asset_client = StellarAssetClient::new(&env, &sac.address());

        // Mint initial tokens to user
        asset_client.mint(&user, &100_000i128);

        (env, user, merchant, sac.address(), token)
    }

    fn register_contract(env: &Env) -> (Address, RecurringAllowanceContractClient<'static>) {
        let contract_id = env.register(RecurringAllowanceContract, ());
        let client = RecurringAllowanceContractClient::new(env, &contract_id);
        (contract_id, client)
    }

    #[test]
    fn test_grant_and_consume_allowance_success() {
        let (env, user, merchant, token_addr, token) = setup();
        let (contract_id, client) = register_contract(&env);

        token.approve(&user, &contract_id, &100_000i128, &200u32);

        let per_period_cap = 1000i128;
        let period_duration = 86400u64; // 1 day
        let absolute_cap = 5000i128;
        let expiration = 0u64;

        client.grant_allowance(
            &user,
            &merchant,
            &token_addr,
            &per_period_cap,
            &period_duration,
            &absolute_cap,
            &expiration,
        );

        let allowance = client.get_allowance(&user, &merchant, &token_addr);
        assert!(allowance.is_active);
        assert_eq!(allowance.per_period_cap, 1000);
        assert_eq!(allowance.absolute_cap, 5000);

        // Merchant consumes 400
        client.consume_allowance(&merchant, &user, &token_addr, &400i128);
        assert_eq!(token.balance(&user), 99_600);
        assert_eq!(token.balance(&merchant), 400);

        let remaining_period = client.get_remaining_period_allowance(&user, &merchant, &token_addr);
        assert_eq!(remaining_period, 600);

        let remaining_abs = client.get_remaining_absolute_allowance(&user, &merchant, &token_addr);
        assert_eq!(remaining_abs, 4600);
    }

    #[test]
    fn test_period_reset() {
        let (env, user, merchant, token_addr, token) = setup();
        let (contract_id, client) = register_contract(&env);

        token.approve(&user, &contract_id, &100_000i128, &5000u32);

        let period_duration = 1000u64;
        client.grant_allowance(
            &user,
            &merchant,
            &token_addr,
            &500i128,
            &period_duration,
            &0i128,
            &0u64,
        );

        // Consume full period cap
        client.consume_allowance(&merchant, &user, &token_addr, &500i128);
        assert_eq!(
            client.get_remaining_period_allowance(&user, &merchant, &token_addr),
            0
        );

        // Try consuming more in current period - should fail
        let err = client.try_consume_allowance(&merchant, &user, &token_addr, &100i128);
        assert!(err.is_err());

        // Fast forward time into next period
        env.ledger().set_timestamp(env.ledger().timestamp() + 1001);

        // Cap should reset for new period
        assert_eq!(
            client.get_remaining_period_allowance(&user, &merchant, &token_addr),
            500
        );

        // Merchant can consume again
        client.consume_allowance(&merchant, &user, &token_addr, &300i128);
        assert_eq!(
            client.get_remaining_period_allowance(&user, &merchant, &token_addr),
            200
        );
    }

    #[test]
    fn test_absolute_cap_enforcement() {
        let (env, user, merchant, token_addr, token) = setup();
        let (contract_id, client) = register_contract(&env);

        token.approve(&user, &contract_id, &100_000i128, &5000u32);

        let per_period_cap = 500i128;
        let absolute_cap = 800i128;
        let period_duration = 100u64;

        client.grant_allowance(
            &user,
            &merchant,
            &token_addr,
            &per_period_cap,
            &period_duration,
            &absolute_cap,
            &0u64,
        );

        // Period 1: consume 500
        client.consume_allowance(&merchant, &user, &token_addr, &500i128);

        // Period 2: move time
        env.ledger().set_timestamp(env.ledger().timestamp() + 150);

        // Try to consume 400 - should fail because lifetime total would be 900 (> 800 absolute cap)
        let err = client.try_consume_allowance(&merchant, &user, &token_addr, &400i128);
        assert!(err.is_err());

        // Consume 300 - should succeed (total becomes 800)
        client.consume_allowance(&merchant, &user, &token_addr, &300i128);
        assert_eq!(
            client.get_remaining_absolute_allowance(&user, &merchant, &token_addr),
            0
        );
    }

    #[test]
    fn test_revoke_allowance() {
        let (env, user, merchant, token_addr, token) = setup();
        let (contract_id, client) = register_contract(&env);

        token.approve(&user, &contract_id, &100_000i128, &5000u32);

        client.grant_allowance(
            &user,
            &merchant,
            &token_addr,
            &1000i128,
            &3600u64,
            &0i128,
            &0u64,
        );

        client.revoke_allowance(&user, &merchant, &token_addr);

        let allowance = client.get_allowance(&user, &merchant, &token_addr);
        assert!(!allowance.is_active);

        // Consume after revoke should fail
        let err = client.try_consume_allowance(&merchant, &user, &token_addr, &100i128);
        assert!(err.is_err());
    }

    #[test]
    fn test_expiration() {
        let (env, user, merchant, token_addr, token) = setup();
        let (contract_id, client) = register_contract(&env);

        token.approve(&user, &contract_id, &100_000i128, &5000u32);

        let now = env.ledger().timestamp();
        let expiration = now + 500;

        client.grant_allowance(
            &user,
            &merchant,
            &token_addr,
            &1000i128,
            &3600u64,
            &0i128,
            &expiration,
        );

        // Advance ledger beyond expiration
        env.ledger().set_timestamp(expiration + 1);

        let err = client.try_consume_allowance(&merchant, &user, &token_addr, &100i128);
        assert!(err.is_err());
    }

    #[test]
    fn test_update_allowance() {
        let (env, user, merchant, token_addr, _token) = setup();
        let (_contract_id, client) = register_contract(&env);

        client.grant_allowance(
            &user,
            &merchant,
            &token_addr,
            &500i128,
            &1000u64,
            &1000i128,
            &0u64,
        );

        // Update cap to 2000
        client.update_allowance(
            &user,
            &merchant,
            &token_addr,
            &2000i128,
            &2000u64,
            &10000i128,
            &0u64,
        );

        let allowance = client.get_allowance(&user, &merchant, &token_addr);
        assert_eq!(allowance.per_period_cap, 2000);
        assert_eq!(allowance.period_duration, 2000);
        assert_eq!(allowance.absolute_cap, 10000);
    }
}
