//! # Agent Spend-Cap Contract
//!
//! A principal issues a spend cap to an agent, denominated in token units, for
//! a fixed period.  The gateway calls [`AgentSpendCapContract::can_transact`]
//! before forwarding a paid request and calls
//! [`AgentSpendCapContract::record_spend`] to settle once the request completes.
//!
//! ## Design decisions
//!
//! **Admission-only enforcement**
//! The cap is checked *and* consumed at admission (`can_transact` + internal
//! atomic debit), not at settlement.  This makes enforcement synchronous with
//! the request decision and avoids a settlement window where the agent could
//! race multiple concurrent requests against the same headroom.
//!
//! **No rollover**
//! Unused allowance does NOT carry forward into the next period.  This bounds
//! the principal's worst-case exposure: a cap of N means the agent can spend
//! at most N per period, not N × (missed_periods + 1).
//!
//! **Period rollover**
//! At the start of a new period the `consumed` counter resets to zero
//! automatically (lazy evaluation on admission/query, no cron needed).
//!
//! **Scoped caps (issue #1658)**
//! A cap may carry an optional scope key (a provider id or route scope encoded
//! as a `Symbol`, e.g. `inference`, `storage`).  `can_transact_scoped` debits
//! every cap of the `(principal, agent)` pair that matches the request: the
//! cap scoped to the requested key AND any unscoped cap (which acts as an
//! overall ceiling).  All matching caps must have headroom or nothing is
//! debited.  An agent that exhausted its `inference` cap can therefore still
//! spend under its `storage` cap.  `can_transact(cap_id, ..)` is unchanged and
//! debits exactly the named cap, so unscoped caps behave as before.
//!
//! **Suspend / resume**
//! A principal may suspend a cap at any time; suspended caps fail admission
//! with a distinct `CapSuspended` error, separate from `CapExceeded`.

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, Symbol, Vec,
};
use syncro_contract_common as syncro_common;

// ============================================================================
// Constants
// ============================================================================

/// Minimum challenge / period length: 1 hour in seconds.
pub const MIN_PERIOD_SECS: u64 = 3_600;
/// Maximum challenge / period length: 1 year in seconds.
pub const MAX_PERIOD_SECS: u64 = 365 * 24 * 3_600;
/// Maximum number of caps one principal may issue to one agent.  Bounds the
/// work `can_transact_scoped` does per call.
pub const MAX_CAPS_PER_PAIR: u32 = 32;

// ============================================================================
// Error types
// ============================================================================

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum SpendCapError {
    /// The cap record does not exist.
    CapNotFound = 1,
    /// Caller is not the principal that issued the cap.
    Unauthorized = 2,
    /// The cap is suspended; no spending allowed.
    CapSuspended = 3,
    /// The requested amount would exceed the remaining allowance.
    CapExceeded = 4,
    /// A numeric parameter was out of the accepted range.
    InvalidInput = 5,
    /// The contract counter overflowed (practically unreachable).
    CounterOverflow = 6,
    /// The cap has already been issued for this (principal, agent) pair.
    DuplicateCap = 7,
    /// The period length is outside the contract-enforced bounds.
    InvalidPeriod = 8,
    /// No cap of the (principal, agent) pair matches the requested scope.
    NoMatchingCap = 9,
    /// The (principal, agent) pair already has `MAX_CAPS_PER_PAIR` caps.
    TooManyCaps = 10,
    /// The contract is already initialized.
    AlreadyInitialized = 11,
    /// The contract has no admin yet (init not called).
    NotInitialized = 12,
    /// No admin transfer is in progress.
    NoPendingAdmin = 13,
    /// The caller is not the nominated pending admin.
    NotPendingAdmin = 14,
}

// ============================================================================
// Storage keys
// ============================================================================

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Contract admin (issue #1659: enables admin-key rotation without
    /// redeploying). Unset until `init` is called.
    Admin,
    /// Address nominated to become admin; absent when no transfer is active.
    PendingAdmin,
    /// Spend cap record keyed by its numeric cap_id.
    Cap(u64),
    /// Global cap counter.
    CapCounter,
    /// Optional scope key of a cap (`Symbol`).  Key absent => unscoped cap.
    /// Kept in its own entry so caps stored before issue #1658 still decode:
    /// the `SpendCap` struct layout is unchanged.
    CapScope(u64),
    /// Ids of every cap issued for a (principal, agent) pair, in issue order.
    /// Caps issued before issue #1658 are not in this index.
    PairCaps(Address, Address),
}

// ============================================================================
// Data types
// ============================================================================

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CapStatus {
    Active = 1,
    Suspended = 2,
}

/// A spend cap issued by `principal` to `agent`.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SpendCap {
    /// Unique identifier, auto-assigned.
    pub id: u64,
    /// The address that controls (and funded) this cap.
    pub principal: Address,
    /// The agent whose requests are gated by this cap.
    pub agent: Address,
    /// Maximum spend allowed per period, in token units.
    pub allowance: i128,
    /// How much of the current period's allowance has been consumed.
    pub consumed: i128,
    /// Length of each cap period in seconds.
    pub period_secs: u64,
    /// Ledger timestamp at which the current period started.
    pub period_started_at: u64,
    /// Whether the cap is currently usable.
    pub status: CapStatus,
}

impl SpendCap {
    /// Remaining headroom for the current period.
    pub fn remaining(&self) -> i128 {
        self.allowance.saturating_sub(self.consumed)
    }

    /// True when the current ledger time has crossed into a new period.
    pub fn period_has_rolled(&self, now: u64) -> bool {
        now >= self.period_started_at.saturating_add(self.period_secs)
    }

    /// Roll the period forward (lazy, called on first access in a new period).
    /// Unused allowance is discarded — no carryover by design.
    pub fn roll_period(&mut self, now: u64) {
        if self.period_has_rolled(now) {
            // Advance the window: find the start of the current period.
            let elapsed = now.saturating_sub(self.period_started_at);
            let periods_elapsed = elapsed / self.period_secs;
            self.period_started_at = self
                .period_started_at
                .saturating_add(periods_elapsed * self.period_secs);
            self.consumed = 0;
        }
    }
}

// ============================================================================
// Contract
// ============================================================================

#[contract]
pub struct AgentSpendCapContract;

#[contractimpl]
impl AgentSpendCapContract {
    // ── Admin (two-step transfer, issue #1659) ────────────────────────────────

    /// Initialize the contract with an admin address. Required before any
    /// admin transfer; cap issuance itself stays principal-gated.
    pub fn init(env: Env, admin: Address) -> Result<(), SpendCapError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(SpendCapError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        syncro_common::ttl::extend_instance(&env);
        Ok(())
    }

    fn require_admin(env: &Env) -> Result<Address, SpendCapError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(SpendCapError::NotInitialized)?;
        admin.require_auth();
        syncro_common::ttl::extend_instance(env);
        Ok(admin)
    }

    /// Read the current admin address.
    pub fn get_admin(env: Env) -> Result<Address, SpendCapError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(SpendCapError::NotInitialized)
    }

    /// Read the pending admin address, if a transfer is in progress.
    pub fn get_pending_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::PendingAdmin)
    }

    /// Step 1 of admin handover: the current admin nominates `new_admin`.
    /// Shared two-step pattern (issue #1659); see `syncro_common::admin`.
    pub fn transfer_admin(env: Env, new_admin: Address) -> Result<(), SpendCapError> {
        Self::require_admin(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);
        env.events()
            .publish(syncro_common::admin::topic_init(), new_admin);
        Ok(())
    }

    /// Cancel an in-progress admin handover. Current admin only.
    pub fn cancel_transfer_admin(env: Env) -> Result<(), SpendCapError> {
        Self::require_admin(&env)?;
        if !env.storage().instance().has(&DataKey::PendingAdmin) {
            return Err(SpendCapError::NoPendingAdmin);
        }
        env.storage().instance().remove(&DataKey::PendingAdmin);
        env.events()
            .publish(syncro_common::admin::topic_cancel(), ());
        Ok(())
    }

    /// Step 2: the nominated address accepts and becomes admin.
    ///
    /// Only the nominee may accept (`pending.require_auth()`), matching the
    /// rule specified by `syncro_common::admin::can_accept`.
    pub fn accept_admin(env: Env) -> Result<(), SpendCapError> {
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .ok_or(SpendCapError::NoPendingAdmin)?;
        pending.require_auth();
        syncro_common::ttl::extend_instance(&env);
        env.storage().instance().set(&DataKey::Admin, &pending);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        env.events()
            .publish(syncro_common::admin::topic_accept(), pending);
        Ok(())
    }

    // ── Issuance ─────────────────────────────────────────────────────────────

    /// Issue a new spend cap.
    ///
    /// # Arguments
    /// * `principal` — the address funding/controlling this cap (must auth)
    /// * `agent`     — the address whose requests are gated
    /// * `allowance` — max token units spendable per `period_secs` window
    /// * `period_secs` — period length; must be in `[MIN_PERIOD_SECS, MAX_PERIOD_SECS]`
    ///
    /// # Returns
    /// The new `cap_id`.
    pub fn issue_cap(
        env: Env,
        principal: Address,
        agent: Address,
        allowance: i128,
        period_secs: u64,
    ) -> Result<u64, SpendCapError> {
        Self::issue_scoped_cap(env, principal, agent, allowance, period_secs, None)
    }

    /// Issue a spend cap limited to one provider / route scope.
    ///
    /// `scope` is an opaque key (e.g. `inference`, `storage`, or an id the
    /// gateway maps a provider to), at most 32 chars of `[A-Za-z0-9_]`.
    /// `None` issues an unscoped cap, identical to `issue_cap`.
    ///
    /// # Errors
    /// Same as `issue_cap`, plus `TooManyCaps` when the pair already holds
    /// `MAX_CAPS_PER_PAIR` caps.
    pub fn issue_scoped_cap(
        env: Env,
        principal: Address,
        agent: Address,
        allowance: i128,
        period_secs: u64,
        scope: Option<Symbol>,
    ) -> Result<u64, SpendCapError> {
        principal.require_auth();

        if allowance <= 0 {
            return Err(SpendCapError::InvalidInput);
        }
        if period_secs < MIN_PERIOD_SECS || period_secs > MAX_PERIOD_SECS {
            return Err(SpendCapError::InvalidPeriod);
        }

        let pair_key = DataKey::PairCaps(principal.clone(), agent.clone());
        let mut pair_caps: Vec<u64> = syncro_common::ttl::persistent_get(&env, &pair_key)
            .unwrap_or(Vec::new(&env));
        if pair_caps.len() >= MAX_CAPS_PER_PAIR {
            return Err(SpendCapError::TooManyCaps);
        }

        let cap_id = Self::next_id(&env)?;
        let now = env.ledger().timestamp();

        let cap = SpendCap {
            id: cap_id,
            principal: principal.clone(),
            agent: agent.clone(),
            allowance,
            consumed: 0,
            period_secs,
            period_started_at: now,
            status: CapStatus::Active,
        };

        syncro_common::ttl::persistent_set(&env, &DataKey::Cap(cap_id), &cap);

        pair_caps.push_back(cap_id);
        syncro_common::ttl::persistent_set(&env, &pair_key, &pair_caps);

        if let Some(scope_key) = scope {
            syncro_common::ttl::persistent_set(&env, &DataKey::CapScope(cap_id), &scope_key);
            env.events().publish(
                (symbol_short!("cap"), symbol_short!("scoped")),
                (cap_id, scope_key),
            );
        }

        env.events().publish(
            (symbol_short!("cap"), symbol_short!("issued")),
            (cap_id, principal, agent, allowance, period_secs),
        );

        Ok(cap_id)
    }

    // ── Admission gate ────────────────────────────────────────────────────────

    /// Admission query called by the gateway **before** routing a paid request.
    ///
    /// Returns `Ok(remaining_after_debit)` and atomically debits `amount` from
    /// the current period's allowance.  Any error is distinguishable by variant:
    ///
    /// * `CapNotFound`  — no such cap
    /// * `CapSuspended` — cap exists but is suspended
    /// * `CapExceeded`  — cap is active but headroom is insufficient
    ///
    /// The debit is applied inside this call so that concurrent requests cannot
    /// both see positive headroom and both proceed.
    pub fn can_transact(
        env: Env,
        cap_id: u64,
        amount: i128,
    ) -> Result<i128, SpendCapError> {
        if amount <= 0 {
            return Err(SpendCapError::InvalidInput);
        }

        let mut cap: SpendCap = syncro_common::ttl::persistent_get(&env, &DataKey::Cap(cap_id))
            .ok_or(SpendCapError::CapNotFound)?;

        // Lazy period rollover — no carryover.
        let now = env.ledger().timestamp();
        cap.roll_period(now);

        if cap.status == CapStatus::Suspended {
            return Err(SpendCapError::CapSuspended);
        }

        let new_consumed = cap
            .consumed
            .checked_add(amount)
            .ok_or(SpendCapError::InvalidInput)?;

        if new_consumed > cap.allowance {
            env.events().publish(
                (symbol_short!("cap"), symbol_short!("exceeded")),
                (cap_id, amount, cap.consumed, cap.allowance),
            );
            return Err(SpendCapError::CapExceeded);
        }

        // Atomic debit — persist before returning.
        cap.consumed = new_consumed;
        syncro_common::ttl::persistent_set(&env, &DataKey::Cap(cap_id), &cap);

        env.events().publish(
            (symbol_short!("cap"), symbol_short!("debited")),
            (cap_id, amount, cap.consumed, cap.allowance),
        );

        Ok(cap.remaining())
    }

    /// Scoped admission query (issue #1658).
    ///
    /// Debits `amount` from EVERY cap of the `(principal, agent)` pair that
    /// matches `scope`:
    ///
    /// * a cap scoped to the same key matches;
    /// * an unscoped cap matches every request (overall ceiling);
    /// * a cap scoped to a different key never matches;
    /// * when `scope` is `None`, only unscoped caps match.
    ///
    /// All matching caps are checked first and debited together, so a failure
    /// on one cap leaves every cap untouched.  Returns the smallest headroom
    /// left across the matched caps (the binding constraint).
    ///
    /// # Errors
    /// * `NoMatchingCap` — nothing matches the scope
    /// * `CapSuspended`  — a matching cap is suspended
    /// * `CapExceeded`   — a matching cap lacks headroom
    pub fn can_transact_scoped(
        env: Env,
        principal: Address,
        agent: Address,
        scope: Option<Symbol>,
        amount: i128,
    ) -> Result<i128, SpendCapError> {
        if amount <= 0 {
            return Err(SpendCapError::InvalidInput);
        }

        let pair_caps: Vec<u64> = syncro_common::ttl::persistent_get(&env, &DataKey::PairCaps(principal, agent))
            .unwrap_or(Vec::new(&env));
        let now = env.ledger().timestamp();

        // Pass 1: find matching caps and make sure ALL of them can pay.
        let mut matched: Vec<SpendCap> = Vec::new(&env);
        for cap_id in pair_caps.iter() {
            let cap_scope: Option<Symbol> =
                syncro_common::ttl::persistent_get(&env, &DataKey::CapScope(cap_id));
            let matches = match (&cap_scope, &scope) {
                (None, _) => true,
                (Some(have), Some(want)) => have == want,
                (Some(_), None) => false,
            };
            if !matches {
                continue;
            }

            let mut cap: SpendCap = syncro_common::ttl::persistent_get(&env, &DataKey::Cap(cap_id))
                .ok_or(SpendCapError::CapNotFound)?;
            cap.roll_period(now);

            if cap.status == CapStatus::Suspended {
                return Err(SpendCapError::CapSuspended);
            }
            let new_consumed = cap
                .consumed
                .checked_add(amount)
                .ok_or(SpendCapError::InvalidInput)?;
            if new_consumed > cap.allowance {
                env.events().publish(
                    (symbol_short!("cap"), symbol_short!("exceeded")),
                    (cap_id, amount, cap.consumed, cap.allowance),
                );
                return Err(SpendCapError::CapExceeded);
            }
            matched.push_back(cap);
        }

        if matched.is_empty() {
            return Err(SpendCapError::NoMatchingCap);
        }

        // Pass 2: debit every matching cap.
        let mut min_remaining = i128::MAX;
        for matched_cap in matched.iter() {
            let mut cap = matched_cap;
            cap.consumed += amount; // cannot overflow: checked in pass 1
            syncro_common::ttl::persistent_set(&env, &DataKey::Cap(cap.id), &cap);
            env.events().publish(
                (symbol_short!("cap"), symbol_short!("debited")),
                (cap.id, amount, cap.consumed, cap.allowance),
            );
            let remaining = cap.remaining();
            if remaining < min_remaining {
                min_remaining = remaining;
            }
        }

        Ok(min_remaining)
    }

    /// Scope key of a cap, or `None` for an unscoped cap.
    pub fn get_cap_scope(env: Env, cap_id: u64) -> Option<Symbol> {
        syncro_common::ttl::persistent_get(&env, &DataKey::CapScope(cap_id))
    }

    /// Ids of the caps issued by `principal` to `agent` (issue order).
    /// Caps issued before issue #1658 are not listed.
    pub fn get_pair_caps(env: Env, principal: Address, agent: Address) -> Vec<u64> {
        syncro_common::ttl::persistent_get(&env, &DataKey::PairCaps(principal, agent))
            .unwrap_or(Vec::new(&env))
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    /// Return the remaining headroom for the current period, accounting for
    /// lazy rollover.  Does NOT mutate state.
    pub fn get_balance(env: Env, cap_id: u64) -> Result<i128, SpendCapError> {
        let mut cap: SpendCap = syncro_common::ttl::persistent_get(&env, &DataKey::Cap(cap_id))
            .ok_or(SpendCapError::CapNotFound)?;

        let now = env.ledger().timestamp();
        cap.roll_period(now);

        Ok(cap.remaining())
    }

    /// Return full cap metadata (after lazy rollover).
    pub fn get_cap(env: Env, cap_id: u64) -> Result<SpendCap, SpendCapError> {
        let mut cap: SpendCap = syncro_common::ttl::persistent_get(&env, &DataKey::Cap(cap_id))
            .ok_or(SpendCapError::CapNotFound)?;

        let now = env.ledger().timestamp();
        cap.roll_period(now);
        Ok(cap)
    }

    // ── Principal controls ────────────────────────────────────────────────────

    /// Suspend a cap.  Only the issuing principal may call this.
    ///
    /// Returns `CapSuspended` error variant so callers can distinguish it from
    /// suspension due to exceeding the limit.
    pub fn suspend_cap(
        env: Env,
        cap_id: u64,
        caller: Address,
    ) -> Result<(), SpendCapError> {
        caller.require_auth();

        let mut cap: SpendCap = syncro_common::ttl::persistent_get(&env, &DataKey::Cap(cap_id))
            .ok_or(SpendCapError::CapNotFound)?;

        if cap.principal != caller {
            return Err(SpendCapError::Unauthorized);
        }

        cap.status = CapStatus::Suspended;
        syncro_common::ttl::persistent_set(&env, &DataKey::Cap(cap_id), &cap);

        env.events().publish(
            (symbol_short!("cap"), symbol_short!("suspended")),
            (cap_id, caller),
        );

        Ok(())
    }

    /// Resume a previously suspended cap.  Only the issuing principal may call.
    pub fn resume_cap(
        env: Env,
        cap_id: u64,
        caller: Address,
    ) -> Result<(), SpendCapError> {
        caller.require_auth();

        let mut cap: SpendCap = syncro_common::ttl::persistent_get(&env, &DataKey::Cap(cap_id))
            .ok_or(SpendCapError::CapNotFound)?;

        if cap.principal != caller {
            return Err(SpendCapError::Unauthorized);
        }

        cap.status = CapStatus::Active;
        syncro_common::ttl::persistent_set(&env, &DataKey::Cap(cap_id), &cap);

        env.events().publish(
            (symbol_short!("cap"), symbol_short!("resumed")),
            (cap_id, caller),
        );

        Ok(())
    }

    /// Increase the allowance on a cap.  Only the issuing principal may call.
    pub fn top_up_cap(
        env: Env,
        cap_id: u64,
        caller: Address,
        additional: i128,
    ) -> Result<(), SpendCapError> {
        caller.require_auth();

        if additional <= 0 {
            return Err(SpendCapError::InvalidInput);
        }

        let mut cap: SpendCap = syncro_common::ttl::persistent_get(&env, &DataKey::Cap(cap_id))
            .ok_or(SpendCapError::CapNotFound)?;

        if cap.principal != caller {
            return Err(SpendCapError::Unauthorized);
        }

        cap.allowance = cap
            .allowance
            .checked_add(additional)
            .ok_or(SpendCapError::InvalidInput)?;

        syncro_common::ttl::persistent_set(&env, &DataKey::Cap(cap_id), &cap);

        env.events().publish(
            (symbol_short!("cap"), symbol_short!("toppedup")),
            (cap_id, additional, cap.allowance),
        );

        Ok(())
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn next_id(env: &Env) -> Result<u64, SpendCapError> {
        let current: u64 = env
            .storage()
            .instance()
            .get(&DataKey::CapCounter)
            .unwrap_or(0u64);
        let next = current
            .checked_add(1)
            .ok_or(SpendCapError::CounterOverflow)?;
        env.storage()
            .instance()
            .set(&DataKey::CapCounter, &next);
        // Keep the instance storage (cap counter) alive on every issuance.
        syncro_common::ttl::extend_instance(env);
        Ok(next)
    }

    /// Returns the contract version.
    pub fn version(_env: Env) -> u32 {
        3
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, testutils::Ledger, Env};
    use syncro_contract_common as syncro_common;

    fn setup() -> (Env, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let principal = Address::generate(&env);
        let agent = Address::generate(&env);
        (env, principal, agent)
    }

    // Issue a standard cap with a 1-day period and 1000 allowance.
    fn issue_default(
        client: &AgentSpendCapContractClient,
        principal: &Address,
        agent: &Address,
    ) -> u64 {
        client.issue_cap(principal, agent, &1_000_i128, &MIN_PERIOD_SECS)
    }

    // ── Issue ────────────────────────────────────────────────────────────────

    #[test]
    fn test_issue_cap_success() {
        let (env, principal, agent) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let cap_id = issue_default(&client, &principal, &agent);
        assert_eq!(cap_id, 1);

        let cap = client.get_cap(&cap_id);
        assert_eq!(cap.allowance, 1_000);
        assert_eq!(cap.consumed, 0);
        assert_eq!(cap.status, CapStatus::Active);
        assert_eq!(cap.principal, principal);
        assert_eq!(cap.agent, agent);
    }

    #[test]
    fn test_issue_cap_zero_allowance_rejected() {
        let (env, principal, agent) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let res = client.try_issue_cap(&principal, &agent, &0_i128, &MIN_PERIOD_SECS);
        assert_eq!(res, Err(Ok(SpendCapError::InvalidInput)));
    }

    #[test]
    fn test_issue_cap_negative_allowance_rejected() {
        let (env, principal, agent) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let res = client.try_issue_cap(&principal, &agent, &-1_i128, &MIN_PERIOD_SECS);
        assert_eq!(res, Err(Ok(SpendCapError::InvalidInput)));
    }

    #[test]
    fn test_issue_cap_period_too_short_rejected() {
        let (env, principal, agent) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let res = client.try_issue_cap(&principal, &agent, &100_i128, &(MIN_PERIOD_SECS - 1));
        assert_eq!(res, Err(Ok(SpendCapError::InvalidPeriod)));
    }

    #[test]
    fn test_issue_cap_period_too_long_rejected() {
        let (env, principal, agent) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let res = client.try_issue_cap(&principal, &agent, &100_i128, &(MAX_PERIOD_SECS + 1));
        assert_eq!(res, Err(Ok(SpendCapError::InvalidPeriod)));
    }

    #[test]
    fn test_issue_cap_ids_sequential() {
        let (env, principal, agent) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let id1 = issue_default(&client, &principal, &agent);
        let id2 = issue_default(&client, &principal, &agent);
        let id3 = issue_default(&client, &principal, &agent);
        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
        assert_eq!(id3, 3);
    }

    // ── Admission (can_transact) ──────────────────────────────────────────────

    #[test]
    fn test_can_transact_debits_and_returns_remaining() {
        let (env, principal, agent) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let cap_id = issue_default(&client, &principal, &agent);
        let remaining = client.can_transact(&cap_id, &300_i128);
        assert_eq!(remaining, 700_i128);

        // Second call sees updated consumed.
        let remaining2 = client.can_transact(&cap_id, &200_i128);
        assert_eq!(remaining2, 500_i128);
    }

    #[test]
    fn test_can_transact_cap_not_found() {
        let (env, _, _) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let res = client.try_can_transact(&999_u64, &10_i128);
        assert_eq!(res, Err(Ok(SpendCapError::CapNotFound)));
    }

    #[test]
    fn test_can_transact_suspended_cap_returns_cap_suspended() {
        let (env, principal, agent) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let cap_id = issue_default(&client, &principal, &agent);
        client.suspend_cap(&cap_id, &principal);

        let res = client.try_can_transact(&cap_id, &10_i128);
        // Must be CapSuspended, NOT CapExceeded
        assert_eq!(res, Err(Ok(SpendCapError::CapSuspended)));
    }

    #[test]
    fn test_can_transact_exceeded_returns_cap_exceeded() {
        let (env, principal, agent) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let cap_id = issue_default(&client, &principal, &agent);

        // Exhaust the cap.
        client.can_transact(&cap_id, &1_000_i128);

        // Next call must return CapExceeded, not CapSuspended.
        let res = client.try_can_transact(&cap_id, &1_i128);
        assert_eq!(res, Err(Ok(SpendCapError::CapExceeded)));
    }

    #[test]
    fn test_can_transact_exactly_at_limit_succeeds() {
        let (env, principal, agent) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let cap_id = issue_default(&client, &principal, &agent);
        let remaining = client.can_transact(&cap_id, &1_000_i128);
        assert_eq!(remaining, 0_i128);
    }

    #[test]
    fn test_can_transact_one_over_limit_rejected() {
        let (env, principal, agent) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let cap_id = issue_default(&client, &principal, &agent);
        let res = client.try_can_transact(&cap_id, &1_001_i128);
        assert_eq!(res, Err(Ok(SpendCapError::CapExceeded)));
    }

    #[test]
    fn test_can_transact_balance_unchanged_on_failure() {
        let (env, principal, agent) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let cap_id = issue_default(&client, &principal, &agent);
        // Partially consume.
        client.can_transact(&cap_id, &400_i128);

        // Over-limit attempt.
        let _ = client.try_can_transact(&cap_id, &700_i128);

        // Balance must be unchanged at 600.
        assert_eq!(client.get_balance(&cap_id), 600_i128);
    }

    // ── Period rollover ───────────────────────────────────────────────────────

    #[test]
    fn test_period_rollover_resets_consumed_no_carryover() {
        let (env, principal, agent) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let cap_id = issue_default(&client, &principal, &agent);
        // Spend within the period.
        client.can_transact(&cap_id, &900_i128);
        assert_eq!(client.get_balance(&cap_id), 100_i128);

        // Advance past the period.
        let now = env.ledger().timestamp();
        env.ledger().set_timestamp(now + MIN_PERIOD_SECS + 1);

        // New period — full allowance available (no carryover of unused 100).
        assert_eq!(client.get_balance(&cap_id), 1_000_i128);
    }

    #[test]
    fn test_multiple_period_rollovers() {
        let (env, principal, agent) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let cap_id = issue_default(&client, &principal, &agent);
        let start = env.ledger().timestamp();

        // Spend 500 in period 0.
        client.can_transact(&cap_id, &500_i128);

        // Advance 5 periods.
        env.ledger().set_timestamp(start + MIN_PERIOD_SECS * 5 + 1);
        // Full 1000 available — the 500 unused from period 0 does NOT compound.
        assert_eq!(client.get_balance(&cap_id), 1_000_i128);

        // Spend 300 in period 5.
        client.can_transact(&cap_id, &300_i128);
        assert_eq!(client.get_balance(&cap_id), 700_i128);
    }

    #[test]
    fn test_can_transact_triggers_lazy_rollover() {
        let (env, principal, agent) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let cap_id = issue_default(&client, &principal, &agent);
        client.can_transact(&cap_id, &999_i128);

        let now = env.ledger().timestamp();
        env.ledger().set_timestamp(now + MIN_PERIOD_SECS + 1);

        // After rollover 700 should be admitted (new period = 1000 available).
        let remaining = client.can_transact(&cap_id, &700_i128);
        assert_eq!(remaining, 300_i128);
    }

    // ── Suspend / resume ─────────────────────────────────────────────────────

    #[test]
    fn test_suspend_then_resume() {
        let (env, principal, agent) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let cap_id = issue_default(&client, &principal, &agent);
        client.suspend_cap(&cap_id, &principal);

        // Suspended.
        assert_eq!(
            client.try_can_transact(&cap_id, &10_i128),
            Err(Ok(SpendCapError::CapSuspended))
        );

        // Resume.
        client.resume_cap(&cap_id, &principal);
        let remaining = client.can_transact(&cap_id, &10_i128);
        assert_eq!(remaining, 990_i128);
    }

    #[test]
    fn test_suspend_unauthorized_rejected() {
        let (env, principal, agent) = setup();
        let attacker = Address::generate(&env);
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let cap_id = issue_default(&client, &principal, &agent);
        let res = client.try_suspend_cap(&cap_id, &attacker);
        assert_eq!(res, Err(Ok(SpendCapError::Unauthorized)));

        // Cap must still be active.
        assert_eq!(client.get_cap(&cap_id).status, CapStatus::Active);
    }

    #[test]
    fn test_resume_unauthorized_rejected() {
        let (env, principal, agent) = setup();
        let attacker = Address::generate(&env);
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let cap_id = issue_default(&client, &principal, &agent);
        client.suspend_cap(&cap_id, &principal);

        let res = client.try_resume_cap(&cap_id, &attacker);
        assert_eq!(res, Err(Ok(SpendCapError::Unauthorized)));

        // Must remain suspended.
        assert_eq!(client.get_cap(&cap_id).status, CapStatus::Suspended);
    }

    // ── Top-up ────────────────────────────────────────────────────────────────

    #[test]
    fn test_top_up_cap_increases_allowance() {
        let (env, principal, agent) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let cap_id = issue_default(&client, &principal, &agent);
        client.top_up_cap(&cap_id, &principal, &500_i128);

        let cap = client.get_cap(&cap_id);
        assert_eq!(cap.allowance, 1_500_i128);
        assert_eq!(client.get_balance(&cap_id), 1_500_i128);
    }

    #[test]
    fn test_top_up_unauthorized_rejected() {
        let (env, principal, agent) = setup();
        let attacker = Address::generate(&env);
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let cap_id = issue_default(&client, &principal, &agent);
        let res = client.try_top_up_cap(&cap_id, &attacker, &500_i128);
        assert_eq!(res, Err(Ok(SpendCapError::Unauthorized)));
    }

    // ── get_balance ───────────────────────────────────────────────────────────

    #[test]
    fn test_get_balance_unknown_cap() {
        let (env, _, _) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let res = client.try_get_balance(&999_u64);
        assert_eq!(res, Err(Ok(SpendCapError::CapNotFound)));
    }

    // ── version ───────────────────────────────────────────────────────────────

    #[test]
    fn test_version_is_v3() {
        let (env, _, _) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);
        assert_eq!(client.version(), 3_u32);
    }

    // ── Scoped caps (issue #1658) ────────────────────────────────────────────

    fn issue_scoped(
        client: &AgentSpendCapContractClient,
        principal: &Address,
        agent: &Address,
        allowance: i128,
        scope: Option<Symbol>,
    ) -> u64 {
        client.issue_scoped_cap(principal, agent, &allowance, &MIN_PERIOD_SECS, &scope)
    }

    #[test]
    fn test_scoped_cap_exhausted_does_not_block_other_scope() {
        let (env, principal, agent) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let inference = Some(symbol_short!("inference"));
        let storage = Some(symbol_short!("storage"));
        let inf_cap = issue_scoped(&client, &principal, &agent, 5, inference.clone());
        let sto_cap = issue_scoped(&client, &principal, &agent, 1, storage.clone());

        // Exhaust the inference cap.
        assert_eq!(
            client.can_transact_scoped(&principal, &agent, &inference, &5_i128),
            0_i128
        );
        assert_eq!(
            client.try_can_transact_scoped(&principal, &agent, &inference, &1_i128),
            Err(Ok(SpendCapError::CapExceeded))
        );

        // The storage cap is untouched and still spendable.
        assert_eq!(client.get_balance(&sto_cap), 1_i128);
        assert_eq!(
            client.can_transact_scoped(&principal, &agent, &storage, &1_i128),
            0_i128
        );
        assert_eq!(client.get_balance(&inf_cap), 0_i128);
    }

    #[test]
    fn test_scoped_request_without_matching_cap_is_rejected() {
        let (env, principal, agent) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        issue_scoped(&client, &principal, &agent, 100, Some(symbol_short!("inference")));

        assert_eq!(
            client.try_can_transact_scoped(
                &principal,
                &agent,
                &Some(symbol_short!("compute")),
                &1_i128
            ),
            Err(Ok(SpendCapError::NoMatchingCap))
        );
        // A request with no scope only matches unscoped caps.
        assert_eq!(
            client.try_can_transact_scoped(&principal, &agent, &None, &1_i128),
            Err(Ok(SpendCapError::NoMatchingCap))
        );
    }

    #[test]
    fn test_unscoped_cap_is_overall_ceiling_and_debit_is_atomic() {
        let (env, principal, agent) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let inference = Some(symbol_short!("inference"));
        let storage = Some(symbol_short!("storage"));
        let global = issue_scoped(&client, &principal, &agent, 10, None);
        let inf_cap = issue_scoped(&client, &principal, &agent, 8, inference.clone());
        let sto_cap = issue_scoped(&client, &principal, &agent, 8, storage.clone());

        // 8 on inference: debits the inference cap AND the global cap.
        assert_eq!(
            client.can_transact_scoped(&principal, &agent, &inference, &8_i128),
            0_i128
        );
        assert_eq!(client.get_balance(&global), 2_i128);

        // 3 on storage fits its own cap (8) but not the global ceiling (2 left).
        assert_eq!(
            client.try_can_transact_scoped(&principal, &agent, &storage, &3_i128),
            Err(Ok(SpendCapError::CapExceeded))
        );
        // Nothing was debited by the failed call.
        assert_eq!(client.get_balance(&sto_cap), 8_i128);
        assert_eq!(client.get_balance(&global), 2_i128);
        assert_eq!(client.get_balance(&inf_cap), 0_i128);

        // 2 on storage still fits both.
        assert_eq!(
            client.can_transact_scoped(&principal, &agent, &storage, &2_i128),
            0_i128
        );
    }

    #[test]
    fn test_returns_smallest_remaining_headroom() {
        let (env, principal, agent) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let inference = Some(symbol_short!("inference"));
        issue_scoped(&client, &principal, &agent, 100, None);
        issue_scoped(&client, &principal, &agent, 30, inference.clone());

        // global would have 90 left, scoped 20 -> binding constraint is 20.
        assert_eq!(
            client.can_transact_scoped(&principal, &agent, &inference, &10_i128),
            20_i128
        );
    }

    #[test]
    fn test_unscoped_caps_keep_current_behaviour() {
        let (env, principal, agent) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        // issue_cap + can_transact(cap_id) work exactly as before.
        let cap_id = issue_default(&client, &principal, &agent);
        assert_eq!(client.get_cap_scope(&cap_id), None);
        assert_eq!(client.can_transact(&cap_id, &300_i128), 700_i128);

        // And the unscoped cap is also reachable through the scoped path.
        assert_eq!(
            client.can_transact_scoped(&principal, &agent, &None, &100_i128),
            600_i128
        );
        assert_eq!(client.get_balance(&cap_id), 600_i128);
    }

    #[test]
    fn test_can_transact_on_scoped_cap_debits_only_that_cap() {
        let (env, principal, agent) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let global = issue_scoped(&client, &principal, &agent, 10, None);
        let inf_cap = issue_scoped(&client, &principal, &agent, 5, Some(symbol_short!("inference")));

        // Naming the cap explicitly bypasses matching.
        assert_eq!(client.can_transact(&inf_cap, &2_i128), 3_i128);
        assert_eq!(client.get_balance(&global), 10_i128);
    }

    #[test]
    fn test_suspended_scoped_cap_only_blocks_its_own_scope() {
        let (env, principal, agent) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let inference = Some(symbol_short!("inference"));
        let storage = Some(symbol_short!("storage"));
        let inf_cap = issue_scoped(&client, &principal, &agent, 5, inference.clone());
        issue_scoped(&client, &principal, &agent, 5, storage.clone());

        client.suspend_cap(&inf_cap, &principal);

        assert_eq!(
            client.try_can_transact_scoped(&principal, &agent, &inference, &1_i128),
            Err(Ok(SpendCapError::CapSuspended))
        );
        assert_eq!(
            client.can_transact_scoped(&principal, &agent, &storage, &1_i128),
            4_i128
        );
    }

    #[test]
    fn test_scoped_caps_roll_over_independently() {
        let (env, principal, agent) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let inference = Some(symbol_short!("inference"));
        let cap_id = issue_scoped(&client, &principal, &agent, 5, inference.clone());
        client.can_transact_scoped(&principal, &agent, &inference, &5_i128);

        let now = env.ledger().timestamp();
        env.ledger().set_timestamp(now + MIN_PERIOD_SECS + 1);

        assert_eq!(client.get_balance(&cap_id), 5_i128);
        assert_eq!(
            client.can_transact_scoped(&principal, &agent, &inference, &5_i128),
            0_i128
        );
    }

    #[test]
    fn test_scope_and_index_are_recorded() {
        let (env, principal, agent) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        let scoped = issue_scoped(&client, &principal, &agent, 5, Some(symbol_short!("storage")));
        let unscoped = issue_scoped(&client, &principal, &agent, 5, None);

        assert_eq!(client.get_cap_scope(&scoped), Some(symbol_short!("storage")));
        assert_eq!(client.get_cap_scope(&unscoped), None);

        let ids = client.get_pair_caps(&principal, &agent);
        assert_eq!(ids.len(), 2);
        assert_eq!(ids.get(0), Some(scoped));
        assert_eq!(ids.get(1), Some(unscoped));
    }

    #[test]
    fn test_too_many_caps_per_pair_rejected() {
        let (env, principal, agent) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        for _ in 0..MAX_CAPS_PER_PAIR {
            issue_default(&client, &principal, &agent);
        }
        let res = client.try_issue_scoped_cap(&principal, &agent, &10_i128, &MIN_PERIOD_SECS, &None);
        assert_eq!(res, Err(Ok(SpendCapError::TooManyCaps)));

        // A different agent is unaffected.
        let other = Address::generate(&env);
        issue_default(&client, &principal, &other);
    }

    /// Migration check: a cap stored before #1658 has no scope entry and no
    /// index entry.  It must still be readable and spendable by id.
    #[test]
    fn test_legacy_cap_without_scope_entry_still_works() {
        let (env, principal, agent) = setup();
        let id = env.register(AgentSpendCapContract, ());
        let client = AgentSpendCapContractClient::new(&env, &id);

        env.as_contract(&id, || {
            let legacy = SpendCap {
                id: 99,
                principal: principal.clone(),
                agent: agent.clone(),
                allowance: 50,
                consumed: 0,
                period_secs: MIN_PERIOD_SECS,
                period_started_at: 0,
                status: CapStatus::Active,
            };
            syncro_common::ttl::persistent_set(&env, &DataKey::Cap(99), &legacy);
        });

        assert_eq!(client.get_cap_scope(&99_u64), None);
        assert_eq!(client.can_transact(&99_u64, &20_i128), 30_i128);
        // Not indexed, so the scoped path does not see it.
        assert_eq!(client.get_pair_caps(&principal, &agent).len(), 0);
    }
}

#[cfg(test)]
mod fuzz;

#[cfg(test)]
mod admin_transfer;

#[cfg(test)]
mod negative;
