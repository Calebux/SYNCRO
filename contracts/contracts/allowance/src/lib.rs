#![no_std]

//! # Recurring Allowance / Spending-Limit Authority
//!
//! A standalone contract that lets a user (the **owner**) pre-authorize a
//! **merchant** to pull funds from the owner's wallet up to two independent
//! caps:
//!
//! * **Per-period cap** — the maximum that may be pulled within any single
//!   rolling period (e.g. "up to 50 USDC per month").
//! * **Absolute cap** — the lifetime ceiling across all periods (e.g. "never
//!   pull more than 600 USDC in total").
//!
//! This authority is completely **decoupled from subscription renewal**: it is
//! a generic spending mandate that a merchant can `consume` on its own schedule
//! for capped recurring pulls, without the owner having to sign every pull.
//!
//! Funds move via the token's `transfer_from`, with this contract acting as the
//! spender. The owner therefore grants a matching token-level `approve` to this
//! contract off-chain; this contract layers per-period and absolute accounting
//! on top of that raw allowance and refuses any pull that would breach either
//! cap.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    Address, Env,
};

// ── Storage keys ────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Allowance(u64),
    AllowanceCount,
    Admin,
    Paused,
}

// ── Data types ──────────────────────────────────────────────────────────────────

/// A recurring spending mandate granted by an owner to a merchant.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Allowance {
    /// Unique, monotonically increasing identifier.
    pub id: u64,
    /// The account granting the authority and whose funds are pulled.
    pub owner: Address,
    /// The account authorized to pull funds.
    pub merchant: Address,
    /// The token contract funds are denominated in.
    pub token: Address,
    /// Maximum amount that may be pulled within a single period.
    pub period_cap: i128,
    /// Lifetime maximum that may be pulled across all periods.
    pub absolute_cap: i128,
    /// Length of a period, in seconds.
    pub period_length: u64,
    /// Start timestamp of the currently active period.
    pub period_start: u64,
    /// Amount already pulled within the current period.
    pub period_spent: i128,
    /// Amount pulled across the lifetime of the allowance.
    pub total_spent: i128,
    /// Whether the allowance is still active (not revoked).
    pub active: bool,
    /// Creation timestamp.
    pub created_at: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum AllowanceError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    AllowanceNotFound = 3,
    Unauthorized = 4,
    InvalidAmount = 5,
    InvalidCap = 6,
    InvalidPeriod = 7,
    SelfAsMerchant = 8,
    NotActive = 9,
    PeriodCapExceeded = 10,
    AbsoluteCapExceeded = 11,
    CapBelowSpent = 12,
    Paused = 13,
}

// ── Events ──────────────────────────────────────────────────────────────────────

#[contractevent]
pub struct AllowanceGranted {
    pub allowance_id: u64,
    pub owner: Address,
    pub merchant: Address,
    pub token: Address,
    pub period_cap: i128,
    pub absolute_cap: i128,
    pub period_length: u64,
}

#[contractevent]
pub struct AllowanceRevoked {
    pub allowance_id: u64,
    pub owner: Address,
}

#[contractevent]
pub struct AllowanceConsumed {
    pub allowance_id: u64,
    pub merchant: Address,
    pub amount: i128,
    pub period_spent: i128,
    pub total_spent: i128,
}

#[contractevent]
pub struct AllowanceCapsUpdated {
    pub allowance_id: u64,
    pub period_cap: i128,
    pub absolute_cap: i128,
}

// ── Contract ────────────────────────────────────────────────────────────────────

#[contract]
pub struct AllowanceContract;

#[contractimpl]
impl AllowanceContract {
    // ── Admin ─────────────────────────────────────────────────────

    /// Initialize the contract with an administrator. Callable once.
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, AllowanceError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
    }

    fn require_admin(env: &Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, AllowanceError::NotInitialized));
        admin.require_auth();
    }

    /// Pause the contract, blocking all new consumption. Admin only.
    pub fn pause(env: Env) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::Paused, &true);
    }

    /// Resume the contract. Admin only.
    pub fn unpause(env: Env) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::Paused, &false);
    }

    /// Whether the contract is currently paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    // ── Allowance lifecycle ───────────────────────────────────────

    /// Grant a merchant the authority to make capped recurring pulls.
    ///
    /// # Arguments
    /// * `owner` — Account granting the authority; its funds are pulled.
    /// * `merchant` — Account authorized to pull funds.
    /// * `token` — Token contract funds are denominated in.
    /// * `period_cap` — Max amount pullable within any single period.
    /// * `absolute_cap` — Lifetime ceiling across all periods.
    /// * `period_length` — Length of a period in seconds.
    ///
    /// # Security
    /// * Requires the owner's authorization.
    /// * Merchant must be distinct from the owner.
    /// * Both caps and the period length must be positive.
    /// * The per-period cap may not exceed the absolute cap.
    pub fn grant_allowance(
        env: Env,
        owner: Address,
        merchant: Address,
        token: Address,
        period_cap: i128,
        absolute_cap: i128,
        period_length: u64,
    ) -> u64 {
        if Self::is_paused(env.clone()) {
            panic_with_error!(&env, AllowanceError::Paused);
        }

        owner.require_auth();

        if owner == merchant {
            panic_with_error!(&env, AllowanceError::SelfAsMerchant);
        }
        if period_cap <= 0 || absolute_cap <= 0 {
            panic_with_error!(&env, AllowanceError::InvalidCap);
        }
        if period_cap > absolute_cap {
            panic_with_error!(&env, AllowanceError::InvalidCap);
        }
        if period_length == 0 {
            panic_with_error!(&env, AllowanceError::InvalidPeriod);
        }

        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::AllowanceCount)
            .unwrap_or(0);
        let allowance_id = count + 1;

        let now = env.ledger().timestamp();
        let allowance = Allowance {
            id: allowance_id,
            owner: owner.clone(),
            merchant: merchant.clone(),
            token: token.clone(),
            period_cap,
            absolute_cap,
            period_length,
            period_start: now,
            period_spent: 0,
            total_spent: 0,
            active: true,
            created_at: now,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Allowance(allowance_id), &allowance);
        env.storage()
            .instance()
            .set(&DataKey::AllowanceCount, &allowance_id);

        AllowanceGranted {
            allowance_id,
            owner,
            merchant,
            token,
            period_cap,
            absolute_cap,
            period_length,
        }
        .publish(&env);

        allowance_id
    }

    /// Revoke an allowance, immediately blocking further pulls.
    /// Only the owner may revoke.
    pub fn revoke_allowance(env: Env, allowance_id: u64) {
        if Self::is_paused(env.clone()) {
            panic_with_error!(&env, AllowanceError::Paused);
        }

        let mut allowance = Self::load(&env, allowance_id);

        allowance.owner.require_auth();

        if !allowance.active {
            // Idempotent: revoking an already-revoked allowance is a no-op panic
            panic_with_error!(&env, AllowanceError::NotActive);
        }

        allowance.active = false;
        env.storage()
            .persistent()
            .set(&DataKey::Allowance(allowance_id), &allowance);

        AllowanceRevoked {
            allowance_id,
            owner: allowance.owner,
        }
        .publish(&env);
    }

    /// Adjust the caps on an existing allowance. Owner only.
    ///
    /// Neither cap may be lowered below what has already been spent (per period
    /// or in total, respectively), and the per-period cap may not exceed the
    /// absolute cap.
    pub fn update_caps(env: Env, allowance_id: u64, period_cap: i128, absolute_cap: i128) {
        if Self::is_paused(env.clone()) {
            panic_with_error!(&env, AllowanceError::Paused);
        }

        let mut allowance = Self::load(&env, allowance_id);
        allowance.owner.require_auth();

        if !allowance.active {
            panic_with_error!(&env, AllowanceError::NotActive);
        }
        if period_cap <= 0 || absolute_cap <= 0 {
            panic_with_error!(&env, AllowanceError::InvalidCap);
        }
        if period_cap > absolute_cap {
            panic_with_error!(&env, AllowanceError::InvalidCap);
        }

        // Reconcile the current period before validating against spent amounts.
        Self::roll_period(&env, &mut allowance);

        if absolute_cap < allowance.total_spent || period_cap < allowance.period_spent {
            panic_with_error!(&env, AllowanceError::CapBelowSpent);
        }

        allowance.period_cap = period_cap;
        allowance.absolute_cap = absolute_cap;
        env.storage()
            .persistent()
            .set(&DataKey::Allowance(allowance_id), &allowance);

        AllowanceCapsUpdated {
            allowance_id,
            period_cap,
            absolute_cap,
        }
        .publish(&env);
    }

    /// Pull `amount` from the owner under a granted allowance.
    ///
    /// Only the designated merchant may consume. The current period is reset
    /// automatically if it has elapsed, then both caps are enforced before any
    /// funds move. Funds are transferred from the owner to the merchant using
    /// the token's `transfer_from`, with this contract as the spender.
    ///
    /// # Security
    /// * Requires the merchant's authorization.
    /// * Rejected when the contract is paused or the allowance is revoked.
    /// * Enforces the per-period cap and the absolute (lifetime) cap.
    pub fn consume(env: Env, allowance_id: u64, amount: i128) {
        if Self::is_paused(env.clone()) {
            panic_with_error!(&env, AllowanceError::Paused);
        }

        let mut allowance = Self::load(&env, allowance_id);

        if !allowance.active {
            panic_with_error!(&env, AllowanceError::NotActive);
        }
        if amount <= 0 {
            panic_with_error!(&env, AllowanceError::InvalidAmount);
        }

        allowance.merchant.require_auth();

        // Reset the period window if the current one has fully elapsed.
        Self::roll_period(&env, &mut allowance);

        // Enforce caps. Use checked arithmetic to be defensive against overflow.
        let new_period_spent = allowance
            .period_spent
            .checked_add(amount)
            .unwrap_or_else(|| panic_with_error!(&env, AllowanceError::PeriodCapExceeded));
        if new_period_spent > allowance.period_cap {
            panic_with_error!(&env, AllowanceError::PeriodCapExceeded);
        }

        let new_total_spent = allowance
            .total_spent
            .checked_add(amount)
            .unwrap_or_else(|| panic_with_error!(&env, AllowanceError::AbsoluteCapExceeded));
        if new_total_spent > allowance.absolute_cap {
            panic_with_error!(&env, AllowanceError::AbsoluteCapExceeded);
        }

        // Move funds: contract is the spender pulling from owner to merchant.
        let token_client = token::Client::new(&env, &allowance.token);
        token_client.transfer_from(
            &env.current_contract_address(),
            &allowance.owner,
            &allowance.merchant,
            &amount,
        );

        allowance.period_spent = new_period_spent;
        allowance.total_spent = new_total_spent;
        env.storage()
            .persistent()
            .set(&DataKey::Allowance(allowance_id), &allowance);

        AllowanceConsumed {
            allowance_id,
            merchant: allowance.merchant,
            amount,
            period_spent: new_period_spent,
            total_spent: new_total_spent,
        }
        .publish(&env);
    }

    // ── Queries ───────────────────────────────────────────────────

    pub fn get_allowance(env: Env, allowance_id: u64) -> Allowance {
        Self::load(&env, allowance_id)
    }

    pub fn get_allowance_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::AllowanceCount)
            .unwrap_or(0)
    }

    /// Amount still pullable *right now*, i.e. the smaller of the remaining
    /// per-period budget (after an implied period reset) and the remaining
    /// lifetime budget. Returns 0 for a revoked allowance.
    pub fn available(env: Env, allowance_id: u64) -> i128 {
        let mut allowance = Self::load(&env, allowance_id);
        if !allowance.active {
            return 0;
        }
        Self::roll_period(&env, &mut allowance);

        let period_remaining = allowance.period_cap - allowance.period_spent;
        let absolute_remaining = allowance.absolute_cap - allowance.total_spent;
        if period_remaining < absolute_remaining {
            period_remaining
        } else {
            absolute_remaining
        }
    }

    // ── Internal helpers ──────────────────────────────────────────

    fn load(env: &Env, allowance_id: u64) -> Allowance {
        env.storage()
            .persistent()
            .get(&DataKey::Allowance(allowance_id))
            .unwrap_or_else(|| panic_with_error!(env, AllowanceError::AllowanceNotFound))
    }

    /// Advance `period_start` and reset `period_spent` if one or more full
    /// periods have elapsed since the current window began. The new window is
    /// aligned to period boundaries so caps track fixed cycles rather than
    /// drifting with each pull.
    fn roll_period(env: &Env, allowance: &mut Allowance) {
        let now = env.ledger().timestamp();
        let elapsed = now.saturating_sub(allowance.period_start);
        if elapsed >= allowance.period_length {
            let periods = elapsed / allowance.period_length;
            allowance.period_start += periods * allowance.period_length;
            allowance.period_spent = 0;
        }
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod test;
#[cfg(test)]
mod negative;


#[cfg(test)]
mod fuzz;
