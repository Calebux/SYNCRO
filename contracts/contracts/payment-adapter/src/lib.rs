#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Env,
};
use syncro_common;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Token(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenPolicy {
    pub token: Address,
    pub decimals: u32,
    pub cap_display_units: i128,
    pub settled_display_units: i128,
    pub active: bool,
    pub created_at: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PaymentAdapterError {
    AlreadyInitialized = 1900,
    NotInitialized = 1901,
    Unauthorized = 1902,
    InvalidAmount = 1903,
    InvalidCap = 1904,
    TokenNotAllowlisted = 1905,
    TokenInactive = 1906,
    CapExceeded = 1907,
    UnsupportedDecimals = 1908,
}

#[contractevent]
pub struct TokenAllowlisted {
    pub token: Address,
    pub decimals: u32,
    pub cap_display_units: i128,
}

#[contractevent]
pub struct TokenAllowlistRevoked {
    pub token: Address,
}

#[contractevent]
pub struct RenewalSettled {
    pub payer: Address,
    pub merchant: Address,
    pub token: Address,
    pub amount_display_units: i128,
    pub amount_raw_units: i128,
    pub remaining_display_units: i128,
}

#[contract]
pub struct PaymentAdapterContract;

#[contractimpl]
impl PaymentAdapterContract {
    pub fn init(env: Env, admin: Address) -> Result<(), PaymentAdapterError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(PaymentAdapterError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        Ok(())
    }

    fn require_admin(env: &Env) -> Result<Address, PaymentAdapterError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(PaymentAdapterError::NotInitialized)?;
        admin.require_auth();
        Ok(admin)
    }

    fn load_policy(env: &Env, token: &Address) -> Result<TokenPolicy, PaymentAdapterError> {
        env.storage()
            .persistent()
            .get(&DataKey::Token(token.clone()))
            .ok_or(PaymentAdapterError::TokenNotAllowlisted)
    }

    fn decimal_factor(decimals: u32) -> Result<i128, PaymentAdapterError> {
        if decimals > 18 {
            return Err(PaymentAdapterError::UnsupportedDecimals);
        }

        let mut factor: i128 = 1;
        for _ in 0..decimals {
            factor = factor
                .checked_mul(10)
                .ok_or(PaymentAdapterError::UnsupportedDecimals)?;
        }

        Ok(factor)
    }

    pub fn allow_token(
        env: Env,
        token: Address,
        cap_display_units: i128,
    ) -> Result<(), PaymentAdapterError> {
        Self::require_admin(&env)?;

        if cap_display_units <= 0 {
            return Err(PaymentAdapterError::InvalidCap);
        }

        let decimals = token::Client::new(&env, &token).decimals();
        let policy = TokenPolicy {
            token: token.clone(),
            decimals,
            cap_display_units,
            settled_display_units: 0,
            active: true,
            created_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Token(token.clone()), &policy);

        TokenAllowlisted {
            token,
            decimals,
            cap_display_units,
        }
        .publish(&env);

        Ok(())
    }

    pub fn revoke_token(env: Env, token: Address) -> Result<(), PaymentAdapterError> {
        Self::require_admin(&env)?;

        let mut policy = Self::load_policy(&env, &token)?;
        policy.active = false;
        env.storage()
            .persistent()
            .set(&DataKey::Token(token.clone()), &policy);

        TokenAllowlistRevoked { token }.publish(&env);
        Ok(())
    }

    pub fn settle_renewal(
        env: Env,
        payer: Address,
        merchant: Address,
        token: Address,
        amount_display_units: i128,
    ) -> Result<i128, PaymentAdapterError> {
        if amount_display_units <= 0 {
            return Err(PaymentAdapterError::InvalidAmount);
        }

        payer.require_auth();

        let mut policy = Self::load_policy(&env, &token)?;
        if !policy.active {
            return Err(PaymentAdapterError::TokenInactive);
        }

        let new_total = policy
            .settled_display_units
            .checked_add(amount_display_units)
            .ok_or(PaymentAdapterError::CapExceeded)?;
        if new_total > policy.cap_display_units {
            return Err(PaymentAdapterError::CapExceeded);
        }

        let factor = Self::decimal_factor(policy.decimals)?;
        let amount_raw_units = amount_display_units
            .checked_mul(factor)
            .ok_or(PaymentAdapterError::UnsupportedDecimals)?;

        let token_client = token::Client::new(&env, &token);
        token_client.transfer_from(
            &env.current_contract_address(),
            &payer,
            &merchant,
            &amount_raw_units,
        );

        policy.settled_display_units = new_total;
        env.storage()
            .persistent()
            .set(&DataKey::Token(token.clone()), &policy);

        RenewalSettled {
            payer,
            merchant,
            token,
            amount_display_units,
            amount_raw_units,
            remaining_display_units: policy.cap_display_units - new_total,
        }
        .publish(&env);

        Ok(amount_raw_units)
    }

    pub fn get_policy(env: Env, token: Address) -> Result<TokenPolicy, PaymentAdapterError> {
        Self::load_policy(&env, &token)
    }

    pub fn available(env: Env, token: Address) -> i128 {
        match Self::load_policy(&env, &token) {
            Ok(policy) if policy.active => policy.cap_display_units - policy.settled_display_units,
            _ => 0,
        }
    }

    pub fn is_allowed(env: Env, token: Address) -> bool {
        matches!(Self::load_policy(&env, &token), Ok(policy) if policy.active)
    }

    /// Returns the contract version.
    /// Incremented when the implementation changes (used for deployments).
    pub fn version(_env: Env) -> u32 {
        syncro_common::version(&_env)
    }

    /// Returns the contract interface version.
    /// Incremented when public methods or error handling changes.
    /// Used to detect API mismatches at runtime.
    pub fn interface_version(_env: Env) -> u32 {
        syncro_common::interface_version_call(&_env)
    }
}

#[cfg(test)]
mod test;
