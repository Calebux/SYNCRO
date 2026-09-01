#![no_std]

//! # Loyalty Rewards Contract
//!
//! Accrues loyalty points to subscribers who renew on time, tracking
//! consecutive-streak multipliers and providing a redeem path against fees.
//!
//! ## Mechanics
//! * **accrue(owner, sub_id, renewal_ledger)** — called by the authorised
//!   renewal contract (or admin) immediately after a successful on-time renewal.
//!   Awards `BASE_POINTS` per renewal plus a streak bonus of
//!   `streak × STREAK_BONUS` points, then increments the streak counter.
//! * **miss(owner, sub_id)** — called when a renewal is late/missed.  Resets
//!   the streak to 0 without awarding any points.
//! * **redeem(owner, amount)** — burns `amount` points from `owner`'s balance
//!   and returns the equivalent fee credit in the same unit so callers can
//!   apply it off-chain or in a token transfer.
//!
//! ## Storage
//! All per-user data (points balance, current streak, last-renewal ledger) is
//! stored in instance storage keyed by the user's `Address`.  Contract
//! configuration (admin, renewal contract, pause flag) lives in persistent
//! storage.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, Address,
    Env,
};
use syncro_common;

// ─── Constants ───────────────────────────────────────────────────────────────

/// Base points awarded for every on-time renewal.
pub const BASE_POINTS: i128 = 100;
/// Additional points per consecutive streak level (multiplied by streak count).
pub const STREAK_BONUS: i128 = 50;
/// Maximum streak level that applies the bonus (cap to bound the multiplier).
pub const MAX_STREAK_BONUS_LEVEL: u32 = 20;
/// Minimum points required for a single redemption call.
pub const MIN_REDEEM: i128 = 100;
/// Points-to-credit ratio: 1 point == 1 unit of fee credit.
pub const POINTS_PER_CREDIT: i128 = 1;

// ─── Error codes ─────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RewardsError {
    NotInitialized = 2500,
    AlreadyInitialized = 2501,
    Unauthorized = 2502,
    Paused = 2503,
    RedeemTooSmall = 2504,
    InsufficientPoints = 2505,
    Overflow = 2506,
}

// ─── Storage keys ────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
enum ConfigKey {
    /// Admin address (persistent).
    Admin,
    /// Authorized caller that may invoke `accrue` / `miss`.
    RenewalCaller,
    /// Global pause flag.
    Paused,
}

#[contracttype]
#[derive(Clone)]
enum UserKey {
    /// Loyalty account for a given owner address.
    Account(Address),
}

// ─── Data types ──────────────────────────────────────────────────────────────

/// Per-user loyalty account stored in instance storage.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LoyaltyAccount {
    /// Total unredeemed points balance.
    pub points: i128,
    /// Current consecutive on-time renewal streak.
    pub streak: u32,
    /// Ledger sequence of the last successful renewal.
    pub last_renewal_ledger: u32,
    /// Cumulative points ever earned (for analytics).
    pub lifetime_points: i128,
    /// Total number of redeems.
    pub total_redeems: u32,
}

// ─── Events ──────────────────────────────────────────────────────────────────

#[contractevent]
pub struct PointsAccrued {
    pub owner: Address,
    pub sub_id: u64,
    pub points_awarded: i128,
    pub new_balance: i128,
    pub new_streak: u32,
}

#[contractevent]
pub struct StreakReset {
    pub owner: Address,
    pub sub_id: u64,
    pub old_streak: u32,
}

#[contractevent]
pub struct PointsRedeemed {
    pub owner: Address,
    pub points_burned: i128,
    pub fee_credit: i128,
    pub remaining_balance: i128,
}

#[contractevent]
pub struct PauseToggled {
    pub paused: bool,
}

// ─── Contract ────────────────────────────────────────────────────────────────

#[contract]
pub struct LoyaltyRewardsContract;

#[contractimpl]
impl LoyaltyRewardsContract {
    // ── Initialisation ───────────────────────────────────────────────────────

    /// Initialise the contract, recording the admin and the address of the
    /// renewal contract that is authorised to call `accrue` / `miss`.
    pub fn init(env: Env, admin: Address, renewal_caller: Address) {
        if env
            .storage()
            .persistent()
            .has(&ConfigKey::Admin)
        {
            panic_with_error!(&env, RewardsError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&ConfigKey::Admin, &admin);
        env.storage()
            .persistent()
            .set(&ConfigKey::RenewalCaller, &renewal_caller);
        env.storage()
            .persistent()
            .set(&ConfigKey::Paused, &false);
    }

    // ── Admin helpers ────────────────────────────────────────────────────────

    /// Toggle the global pause state.  Only admin may call this.
    pub fn set_paused(env: Env, paused: bool) {
        let admin: Address = Self::require_admin(&env);
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&ConfigKey::Paused, &paused);
        env.events()
            .publish(("loyalty_rewards", "pause"), PauseToggled { paused });
    }

    /// Update the authorized renewal caller.  Only admin may call this.
    pub fn set_renewal_caller(env: Env, renewal_caller: Address) {
        Self::require_not_paused(&env);
        let admin: Address = Self::require_admin(&env);
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&ConfigKey::RenewalCaller, &renewal_caller);
    }

    // ── Core entrypoints ─────────────────────────────────────────────────────

    /// Award loyalty points to `owner` for an on-time renewal of `sub_id`.
    ///
    /// Must be called by the registered `renewal_caller`.
    ///
    /// Points awarded = `BASE_POINTS + (streak × STREAK_BONUS)` where the
    /// streak multiplier is capped at `MAX_STREAK_BONUS_LEVEL`.
    ///
    /// Returns the total points awarded in this call.
    pub fn accrue(env: Env, owner: Address, sub_id: u64, renewal_ledger: u32) -> i128 {
        Self::require_not_paused(&env);
        let caller: Address = Self::require_renewal_caller(&env);
        caller.require_auth();

        let mut account = Self::load_account(&env, &owner);

        // Calculate bonus capped at MAX_STREAK_BONUS_LEVEL
        let bonus_levels = account.streak.min(MAX_STREAK_BONUS_LEVEL);
        let streak_bonus = STREAK_BONUS
            .checked_mul(bonus_levels as i128)
            .unwrap_or_else(|| panic_with_error!(&env, RewardsError::Overflow));
        let points_awarded = BASE_POINTS
            .checked_add(streak_bonus)
            .unwrap_or_else(|| panic_with_error!(&env, RewardsError::Overflow));

        account.points = account
            .points
            .checked_add(points_awarded)
            .unwrap_or_else(|| panic_with_error!(&env, RewardsError::Overflow));
        account.lifetime_points = account
            .lifetime_points
            .checked_add(points_awarded)
            .unwrap_or_else(|| panic_with_error!(&env, RewardsError::Overflow));
        account.streak = account
            .streak
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(&env, RewardsError::Overflow));
        account.last_renewal_ledger = renewal_ledger;

        let new_balance = account.points;
        let new_streak = account.streak;
        Self::save_account(&env, &owner, &account);

        env.events().publish(
            ("loyalty_rewards", "accrue"),
            PointsAccrued {
                owner,
                sub_id,
                points_awarded,
                new_balance,
                new_streak,
            },
        );

        points_awarded
    }

    /// Record a missed/late renewal for `owner` on `sub_id`, resetting the
    /// consecutive streak to 0.  No points are awarded.
    ///
    /// Must be called by the registered `renewal_caller`.
    pub fn miss(env: Env, owner: Address, sub_id: u64) {
        Self::require_not_paused(&env);
        let caller: Address = Self::require_renewal_caller(&env);
        caller.require_auth();

        let mut account = Self::load_account(&env, &owner);
        let old_streak = account.streak;

        if old_streak > 0 {
            account.streak = 0;
            Self::save_account(&env, &owner, &account);

            env.events().publish(
                ("loyalty_rewards", "miss"),
                StreakReset {
                    owner,
                    sub_id,
                    old_streak,
                },
            );
        }
    }

    /// Redeem `amount` points from `owner`'s balance.
    ///
    /// The caller must be `owner` (owner authorises their own redemption).
    ///
    /// Returns the fee credit value (`amount × POINTS_PER_CREDIT`).
    pub fn redeem(env: Env, owner: Address, amount: i128) -> i128 {
        Self::require_not_paused(&env);
        Self::require_initialized(&env);
        owner.require_auth();

        if amount < MIN_REDEEM {
            panic_with_error!(&env, RewardsError::RedeemTooSmall);
        }

        let mut account = Self::load_account(&env, &owner);

        if account.points < amount {
            panic_with_error!(&env, RewardsError::InsufficientPoints);
        }

        account.points = account
            .points
            .checked_sub(amount)
            .unwrap_or_else(|| panic_with_error!(&env, RewardsError::Overflow));
        account.total_redeems = account
            .total_redeems
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(&env, RewardsError::Overflow));

        let fee_credit = amount
            .checked_mul(POINTS_PER_CREDIT)
            .unwrap_or_else(|| panic_with_error!(&env, RewardsError::Overflow));

        let remaining_balance = account.points;
        Self::save_account(&env, &owner, &account);

        env.events().publish(
            ("loyalty_rewards", "redeem"),
            PointsRedeemed {
                owner,
                points_burned: amount,
                fee_credit,
                remaining_balance,
            },
        );

        fee_credit
    }

    // ── Read-only queries ────────────────────────────────────────────────────

    /// Return the current points balance for `owner`.
    pub fn balance(env: Env, owner: Address) -> i128 {
        Self::load_account(&env, &owner).points
    }

    /// Return the full loyalty account for `owner`.
    pub fn account(env: Env, owner: Address) -> LoyaltyAccount {
        Self::load_account(&env, &owner)
    }

    /// Return the current streak for `owner`.
    pub fn streak(env: Env, owner: Address) -> u32 {
        Self::load_account(&env, &owner).streak
    }

    /// Return `true` if the contract is paused.
    pub fn is_paused(env: Env) -> bool {
        Self::require_initialized(&env);
        env.storage()
            .persistent()
            .get::<ConfigKey, bool>(&ConfigKey::Paused)
            .unwrap_or(false)
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    fn require_admin(env: &Env) -> Address {
        env.storage()
            .persistent()
            .get::<ConfigKey, Address>(&ConfigKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, RewardsError::NotInitialized))
    }

    fn require_renewal_caller(env: &Env) -> Address {
        env.storage()
            .persistent()
            .get::<ConfigKey, Address>(&ConfigKey::RenewalCaller)
            .unwrap_or_else(|| panic_with_error!(env, RewardsError::NotInitialized))
    }

    fn require_initialized(env: &Env) {
        if !env.storage().persistent().has(&ConfigKey::Admin) {
            panic_with_error!(env, RewardsError::NotInitialized);
        }
    }

    fn require_not_paused(env: &Env) {
        Self::require_initialized(env);
        let paused: bool = env
            .storage()
            .persistent()
            .get::<ConfigKey, bool>(&ConfigKey::Paused)
            .unwrap_or(false);
        if paused {
            panic_with_error!(env, RewardsError::Paused);
        }
    }

    fn load_account(env: &Env, owner: &Address) -> LoyaltyAccount {
        env.storage()
            .instance()
            .get::<UserKey, LoyaltyAccount>(&UserKey::Account(owner.clone()))
            .unwrap_or(LoyaltyAccount {
                points: 0,
                streak: 0,
                last_renewal_ledger: 0,
                lifetime_points: 0,
                total_redeems: 0,
            })
    }

    fn save_account(env: &Env, owner: &Address, account: &LoyaltyAccount) {
        env.storage()
            .instance()
            .set(&UserKey::Account(owner.clone()), account);
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
