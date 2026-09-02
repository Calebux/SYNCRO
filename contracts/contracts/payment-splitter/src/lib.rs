#![no_std]

//! # Payment Splitter
//!
//! A Soroban contract that atomically distributes a subscription renewal
//! payment across **N payers** according to pre-configured **basis-point
//! shares** (total must equal exactly 10 000 = 100 %).
//!
//! ## Lifecycle
//! 1. `init(admin)` — deploy once.
//! 2. `configure_split(caller, split_id, token, merchant, total_amount, payers)`
//!    — an authorised caller records how a future renewal is to be split.
//! 3. `execute_split(caller, split_id)` — triggers the atomic fan-out:
//!    for each payer their pro-rata share is transferred to the merchant via
//!    `token::transfer_from`.  Either **all** transfers succeed or the whole
//!    transaction reverts (Soroban's all-or-nothing semantics).
//!
//! ## Key invariants
//! * Shares must sum to exactly `BASIS_POINTS` (10 000).
//! * No payer may appear twice in the same split.
//! * No share may be zero.
//! * Only the original `caller` (or the contract admin) may execute a split.
//! * A split may only be executed once; afterwards it is marked `Executed`.
//! * Rounding dust is added to the **first** payer's share so the merchant
//!   always receives exactly `total_amount`.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    Address, Env, Vec,
};
use syncro_common;

// ── Constants ─────────────────────────────────────────────────────────────────

/// Total basis points (100 %).  Shares must sum to exactly this value.
pub const BASIS_POINTS: u32 = 10_000;

/// Maximum number of payers per split (prevents ledger-entry bloat).
pub const MAX_PAYERS: u32 = 50;

// ── Storage keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Split(u64),
    SplitCount,
}

// ── Data types ────────────────────────────────────────────────────────────────

/// A single payer's allocation expressed in basis points.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayerShare {
    /// Address that will be debited for this share.
    pub payer: Address,
    /// Basis-point fraction (1 = 0.01 %, 10 000 = 100 %).
    pub share_bps: u32,
}

/// State machine for a configured split.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SplitStatus {
    /// Configured and awaiting execution.
    Pending,
    /// Already executed; cannot be replayed.
    Executed,
    /// Cancelled by the caller or admin before execution.
    Cancelled,
}

/// Full configuration stored on-chain for a split.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SplitConfig {
    /// Unique identifier.
    pub id: u64,
    /// Account that created and is authorised to execute this split.
    pub caller: Address,
    /// Token contract (e.g. USDC).
    pub token: Address,
    /// Merchant / payee receiving the consolidated payment.
    pub merchant: Address,
    /// Gross amount the merchant should receive (in token's base unit).
    pub total_amount: i128,
    /// Per-payer allocation (sorted, no duplicates, sums to BASIS_POINTS).
    pub payers: Vec<PayerShare>,
    /// Lifecycle status.
    pub status: SplitStatus,
    /// Ledger timestamp of configuration.
    pub created_at: u64,
    /// Ledger timestamp of execution (0 if not yet executed).
    pub executed_at: u64,
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum SplitterError {
    AlreadyInitialized = 3000,
    NotInitialized = 3001,
    SplitNotFound = 3002,
    Unauthorized = 3003,
    InvalidAmount = 3004,
    NoPayers = 3005,
    TooManyPayers = 3006,
    ZeroShare = 3007,
    DuplicatePayer = 3008,
    SharesMustSum100Pct = 3009,
    AlreadyExecuted = 3010,
    AlreadyCancelled = 3011,
    MerchantIsPayer = 3012,
}

// ── Events ────────────────────────────────────────────────────────────────────

/// Emitted when a new split is recorded on-chain.
#[contractevent]
pub struct SplitConfigured {
    pub split_id: u64,
    pub caller: Address,
    pub token: Address,
    pub merchant: Address,
    pub total_amount: i128,
    pub payer_count: u32,
}

/// Emitted once per payer transfer during execution.
#[contractevent]
pub struct SplitTransferExecuted {
    pub split_id: u64,
    pub payer: Address,
    pub amount: i128,
}

/// Emitted when the whole split is atomically complete.
#[contractevent]
pub struct SplitExecuted {
    pub split_id: u64,
    pub caller: Address,
    pub merchant: Address,
    pub total_amount: i128,
    pub payer_count: u32,
    pub executed_at: u64,
}

/// Emitted when a split is cancelled.
#[contractevent]
pub struct SplitCancelled {
    pub split_id: u64,
    pub caller: Address,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct PaymentSplitterContract;

#[contractimpl]
impl PaymentSplitterContract {
    // ── Initialisation ────────────────────────────────────────────

    /// Initialise the contract with an administrator. Callable only once.
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, SplitterError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::SplitCount, &0u64);
    }

    // ── Helpers ───────────────────────────────────────────────────

    fn load_split(env: &Env, split_id: u64) -> SplitConfig {
        env.storage()
            .persistent()
            .get(&DataKey::Split(split_id))
            .unwrap_or_else(|| panic_with_error!(env, SplitterError::SplitNotFound))
    }

    fn save_split(env: &Env, split: &SplitConfig) {
        env.storage()
            .persistent()
            .set(&DataKey::Split(split.id), split);
    }

    // ── Validation helpers ────────────────────────────────────────

    /// Validate payer list and return the `u32` payer count.
    fn validate_payers(env: &Env, payers: &Vec<PayerShare>, merchant: &Address) -> u32 {
        let n = payers.len();
        if n == 0 {
            panic_with_error!(env, SplitterError::NoPayers);
        }
        if n > MAX_PAYERS {
            panic_with_error!(env, SplitterError::TooManyPayers);
        }

        let mut total_bps: u32 = 0;

        for i in 0..n {
            let ps = payers.get(i).unwrap();

            if ps.share_bps == 0 {
                panic_with_error!(env, SplitterError::ZeroShare);
            }
            if &ps.payer == merchant {
                panic_with_error!(env, SplitterError::MerchantIsPayer);
            }

            // O(n²) duplicate check — acceptable for MAX_PAYERS ≤ 50.
            for j in 0..i {
                let other = payers.get(j).unwrap();
                if ps.payer == other.payer {
                    panic_with_error!(env, SplitterError::DuplicatePayer);
                }
            }

            total_bps = total_bps
                .checked_add(ps.share_bps)
                .unwrap_or_else(|| panic_with_error!(env, SplitterError::SharesMustSum100Pct));
        }

        if total_bps != BASIS_POINTS {
            panic_with_error!(env, SplitterError::SharesMustSum100Pct);
        }

        n
    }

    // ── Public API ────────────────────────────────────────────────

    /// Record a new split configuration on-chain.
    ///
    /// # Parameters
    /// * `caller`       — Account that authorises this split and will later
    ///                    trigger execution.
    /// * `token`        — Token contract (USDC, XLM-wrapped, etc.).
    /// * `merchant`     — Payee that receives the consolidated payment.
    /// * `total_amount` — Gross amount the merchant should receive.
    /// * `payers`       — List of `(payer, share_bps)` pairs.  Must sum to
    ///                    exactly 10 000 basis points.
    ///
    /// Returns the new monotonically-increasing `split_id`.
    pub fn configure_split(
        env: Env,
        caller: Address,
        token: Address,
        merchant: Address,
        total_amount: i128,
        payers: Vec<PayerShare>,
    ) -> u64 {
        caller.require_auth();

        if total_amount <= 0 {
            panic_with_error!(&env, SplitterError::InvalidAmount);
        }

        let payer_count = Self::validate_payers(&env, &payers, &merchant);

        // Allocate new split_id.
        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::SplitCount)
            .unwrap_or(0);
        let split_id = count + 1;

        let now = env.ledger().timestamp();
        let split = SplitConfig {
            id: split_id,
            caller: caller.clone(),
            token: token.clone(),
            merchant: merchant.clone(),
            total_amount,
            payers,
            status: SplitStatus::Pending,
            created_at: now,
            executed_at: 0,
        };

        Self::save_split(&env, &split);
        env.storage()
            .instance()
            .set(&DataKey::SplitCount, &split_id);

        SplitConfigured {
            split_id,
            caller,
            token,
            merchant,
            total_amount,
            payer_count,
        }
        .publish(&env);

        split_id
    }

    /// Atomically execute a configured split.
    ///
    /// Iterates over all payers and calls `token::transfer_from` for each,
    /// pulling their pro-rata share from their account into the merchant's
    /// account.  This contract must hold a valid token-level `approve` from
    /// each payer before this is called.
    ///
    /// Rounding dust (from integer division) is absorbed into the **first**
    /// payer's transfer so the merchant receives exactly `total_amount`.
    ///
    /// Only the original `caller` or the admin may trigger execution.
    ///
    /// # Atomicity
    /// Soroban transactions are all-or-nothing.  If any single `transfer_from`
    /// fails (insufficient allowance, frozen account, etc.) the entire
    /// transaction reverts and no payer is charged.
    pub fn execute_split(env: Env, caller: Address, split_id: u64) {
        caller.require_auth();

        let mut split = Self::load_split(&env, split_id);

        // Guard: only the configured caller or admin may execute.
        if caller != split.caller {
            // Re-verify via admin path (require_auth already called above for
            // `caller`; load admin separately and check identity).
            let admin: Address = env
                .storage()
                .instance()
                .get(&DataKey::Admin)
                .unwrap_or_else(|| panic_with_error!(&env, SplitterError::NotInitialized));
            if caller != admin {
                panic_with_error!(&env, SplitterError::Unauthorized);
            }
        }

        match split.status {
            SplitStatus::Executed => panic_with_error!(&env, SplitterError::AlreadyExecuted),
            SplitStatus::Cancelled => panic_with_error!(&env, SplitterError::AlreadyCancelled),
            SplitStatus::Pending => {}
        }

        let token_client = token::Client::new(&env, &split.token);
        let contract_addr = env.current_contract_address();

        let n = split.payers.len();
        let total = split.total_amount;

        // Calculate all amounts up-front, assigning dust to the first payer.
        // Use i128 arithmetic throughout to avoid narrowing loss.
        let mut amounts: Vec<i128> = Vec::new(&env);
        let mut allocated: i128 = 0i128;

        for i in 0..n {
            let ps = split.payers.get(i).unwrap();
            // floor(total * share_bps / BASIS_POINTS)
            let amount = total
                .checked_mul(ps.share_bps as i128)
                .unwrap_or_else(|| panic_with_error!(&env, SplitterError::InvalidAmount))
                / BASIS_POINTS as i128;
            amounts.push_back(amount);
            allocated = allocated
                .checked_add(amount)
                .unwrap_or_else(|| panic_with_error!(&env, SplitterError::InvalidAmount));
        }

        // Add rounding dust to the first payer.
        let dust = total - allocated; // always 0 ≤ dust < n
        if n > 0 && dust > 0 {
            let first = amounts.get(0).unwrap();
            amounts.set(0, first + dust);
        }

        // Execute all transfers atomically.
        for i in 0..n {
            let ps = split.payers.get(i).unwrap();
            let amount = amounts.get(i).unwrap();

            token_client.transfer_from(
                &contract_addr,
                &ps.payer,
                &split.merchant,
                &amount,
            );

            SplitTransferExecuted {
                split_id,
                payer: ps.payer.clone(),
                amount,
            }
            .publish(&env);
        }

        // Mark executed.
        let now = env.ledger().timestamp();
        split.status = SplitStatus::Executed;
        split.executed_at = now;
        Self::save_split(&env, &split);

        SplitExecuted {
            split_id,
            caller,
            merchant: split.merchant,
            total_amount: total,
            payer_count: n,
            executed_at: now,
        }
        .publish(&env);
    }

    /// Cancel a pending split. Only the original caller or admin may cancel.
    pub fn cancel_split(env: Env, caller: Address, split_id: u64) {
        caller.require_auth();

        let mut split = Self::load_split(&env, split_id);

        // Authorisation: original caller OR admin.
        if caller != split.caller {
            let admin: Address = env
                .storage()
                .instance()
                .get(&DataKey::Admin)
                .unwrap_or_else(|| panic_with_error!(&env, SplitterError::NotInitialized));
            if caller != admin {
                panic_with_error!(&env, SplitterError::Unauthorized);
            }
        }

        match split.status {
            SplitStatus::Executed => panic_with_error!(&env, SplitterError::AlreadyExecuted),
            SplitStatus::Cancelled => panic_with_error!(&env, SplitterError::AlreadyCancelled),
            SplitStatus::Pending => {}
        }

        split.status = SplitStatus::Cancelled;
        Self::save_split(&env, &split);

        SplitCancelled { split_id, caller }.publish(&env);
    }

    // ── Queries ───────────────────────────────────────────────────

    /// Retrieve the full configuration for a split.
    pub fn get_split(env: Env, split_id: u64) -> SplitConfig {
        Self::load_split(&env, split_id)
    }

    /// Return the total number of splits ever created.
    pub fn split_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::SplitCount)
            .unwrap_or(0)
    }

    /// Return the admin address.
    pub fn admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, SplitterError::NotInitialized))
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
#[cfg(test)]
mod negative;

