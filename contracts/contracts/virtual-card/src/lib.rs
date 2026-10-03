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
//! **Suspend / resume**
//! A principal may suspend a cap at any time; suspended caps fail admission
//! with a distinct `CapSuspended` error, separate from `CapExceeded`.

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env,
};

// ============================================================================
// Constants
// ============================================================================

/// Minimum challenge / period length: 1 hour in seconds.
pub const MIN_PERIOD_SECS: u64 = 3_600;
/// Maximum challenge / period length: 1 year in seconds.
pub const MAX_PERIOD_SECS: u64 = 365 * 24 * 3_600;

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
}

// ============================================================================
// Storage keys
// ============================================================================

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Spend cap record keyed by its numeric cap_id.
    Cap(u64),
    /// Global cap counter.
    CapCounter,
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
        principal.require_auth();

        if allowance <= 0 {
            return Err(SpendCapError::InvalidInput);
        }
        if period_secs < MIN_PERIOD_SECS || period_secs > MAX_PERIOD_SECS {
            return Err(SpendCapError::InvalidPeriod);
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

        env.storage().persistent().set(&DataKey::Cap(cap_id), &cap);

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

        let mut cap: SpendCap = env
            .storage()
            .persistent()
            .get(&DataKey::Cap(cap_id))
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
        env.storage().persistent().set(&DataKey::Cap(cap_id), &cap);

        env.events().publish(
            (symbol_short!("cap"), symbol_short!("debited")),
            (cap_id, amount, cap.consumed, cap.allowance),
        );

        Ok(cap.remaining())
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    /// Return the remaining headroom for the current period, accounting for
    /// lazy rollover.  Does NOT mutate state.
    pub fn get_balance(env: Env, cap_id: u64) -> Result<i128, SpendCapError> {
        let mut cap: SpendCap = env
            .storage()
            .persistent()
            .get(&DataKey::Cap(cap_id))
            .ok_or(SpendCapError::CapNotFound)?;

        let now = env.ledger().timestamp();
        cap.roll_period(now);

        Ok(cap.remaining())
    }

    /// Return full cap metadata (after lazy rollover).
    pub fn get_cap(env: Env, cap_id: u64) -> Result<SpendCap, SpendCapError> {
        let mut cap: SpendCap = env
            .storage()
            .persistent()
            .get(&DataKey::Cap(cap_id))
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

        let mut cap: SpendCap = env
            .storage()
            .persistent()
            .get(&DataKey::Cap(cap_id))
            .ok_or(SpendCapError::CapNotFound)?;

        if cap.principal != caller {
            return Err(SpendCapError::Unauthorized);
        }

        cap.status = CapStatus::Suspended;
        env.storage().persistent().set(&DataKey::Cap(cap_id), &cap);

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

        let mut cap: SpendCap = env
            .storage()
            .persistent()
            .get(&DataKey::Cap(cap_id))
            .ok_or(SpendCapError::CapNotFound)?;

        if cap.principal != caller {
            return Err(SpendCapError::Unauthorized);
        }

        cap.status = CapStatus::Active;
        env.storage().persistent().set(&DataKey::Cap(cap_id), &cap);

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

        let mut cap: SpendCap = env
            .storage()
            .persistent()
            .get(&DataKey::Cap(cap_id))
            .ok_or(SpendCapError::CapNotFound)?;

        if cap.principal != caller {
            return Err(SpendCapError::Unauthorized);
        }

        cap.allowance = cap
            .allowance
            .checked_add(additional)
            .ok_or(SpendCapError::InvalidInput)?;

        env.storage().persistent().set(&DataKey::Cap(cap_id), &cap);

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
}

#[cfg(test)]
mod fuzz;

#[cfg(test)]
mod negative;
