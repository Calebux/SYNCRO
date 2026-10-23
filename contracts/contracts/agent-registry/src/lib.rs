#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env,
};
use syncro_contract_common as syncro_common;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InvalidScope = 4,
    NoPendingAdmin = 5,
    NotPendingAdmin = 6,
    NotRegistered = 7,
    MissingScope = 8,
    /// The agent is registered but its authority has expired (issue #1656).
    AuthorityExpired = 9,
    /// The requested expiry is not strictly in the future (issue #1656).
    InvalidExpiry = 10,
}


#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct ScopeSet(pub u32);

impl ScopeSet {
    pub const RENEWALS: u32 = 1 << 0;
    pub const GIFTCARDS: u32 = 1 << 1;
    pub const APPROVALS: u32 = 1 << 2;
    // Remaining bits (3..=31) are reserved for future scopes.
    pub const ALL_DEFINED: u32 = Self::RENEWALS | Self::GIFTCARDS | Self::APPROVALS;

    pub fn is_valid(&self) -> bool {
        (self.0 & !Self::ALL_DEFINED) == 0
    }

    pub fn contains(&self, other: &ScopeSet) -> bool {
        (self.0 & other.0) == other.0
    }

    pub fn union(&self, other: &ScopeSet) -> ScopeSet {
        ScopeSet(self.0 | other.0)
    }

    pub fn difference(&self, other: &ScopeSet) -> ScopeSet {
        ScopeSet(self.0 & !other.0)
    }
}



#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    /// Address that has been nominated to become admin but has not yet accepted.
    PendingAdmin,
    /// Scope mask (`u32`) for a registered agent.  Unchanged since v1.
    Agent(Address),
    /// Principal that owns / granted authority to the agent. Required for
    /// principal-managed register / update / revoke (v3).
    AgentPrincipal(Address),
    /// Optional expiry for an agent's authority, as a ledger timestamp
    /// (`u64`, seconds).  Stored under its OWN key so that entries written
    /// before issue #1656 (a bare `u32` under `Agent`) stay readable with no
    /// migration.  Key absent => the authority never expires.
    AgentExpiry(Address),
}

#[contract]
pub struct AgentRegistry;

#[contractimpl]
impl AgentRegistry {
    /// Initialize the contract with an admin address.
    pub fn init(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        syncro_common::ttl::extend_instance(&env);
        Ok(())
    }

    fn require_admin(env: &Env) -> Result<Address, Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;

        admin.require_auth();
        // Every admin call keeps the instance storage (admin, pending admin) alive.
        syncro_common::ttl::extend_instance(env);
        Ok(admin)
    }

    fn require_initialized(env: &Env) -> Result<(), Error> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::NotInitialized);
        }
        syncro_common::ttl::extend_instance(env);
        Ok(())
    }

    /// Authenticate `principal` and verify it owns `agent`.
    fn require_agent_owner(
        env: &Env,
        principal: &Address,
        agent: &Address,
    ) -> Result<(), Error> {
        principal.require_auth();
        let owner: Address = syncro_common::ttl::persistent_get(
            env,
            &DataKey::AgentPrincipal(agent.clone()),
        )
        .ok_or(Error::NotRegistered)?;
        if owner != *principal {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    /// Read the current admin address.
    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    /// Read the pending admin address, if a transfer is in progress.
    pub fn get_pending_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::PendingAdmin)
    }

    /// Step 1 of admin handover: the current admin nominates `new_admin`.
    ///
    /// This does NOT change the admin — the nominee must call `accept_admin`.
    /// A two-step flow prevents an irrecoverable transfer to a wrong/typo'd
    /// address, since a nominee that never accepts leaves the current admin in
    /// place. Re-calling overwrites any previous pending nomination.
    pub fn transfer_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        Self::require_admin(&env)?;

        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);

        env.events().publish(
            (symbol_short!("admin"), symbol_short!("xfer_init")),
            new_admin,
        );

        Ok(())
    }

    /// Cancel an in-progress admin handover. Current admin only.
    pub fn cancel_transfer_admin(env: Env) -> Result<(), Error> {
        Self::require_admin(&env)?;

        if !env.storage().instance().has(&DataKey::PendingAdmin) {
            return Err(Error::NoPendingAdmin);
        }

        env.storage().instance().remove(&DataKey::PendingAdmin);

        env.events().publish(
            (symbol_short!("admin"), symbol_short!("xfer_cxl")),
            (),
        );

        Ok(())
    }

    /// Step 2 of admin handover: the nominated address accepts and becomes admin.
    ///
    /// Requires auth from the pending admin, ensuring only the intended nominee
    /// can complete the transfer.
    pub fn accept_admin(env: Env) -> Result<(), Error> {
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .ok_or(Error::NoPendingAdmin)?;

        // Only the nominee may accept.
        pending.require_auth();
        syncro_common::ttl::extend_instance(&env);

        env.storage().instance().set(&DataKey::Admin, &pending);
        env.storage().instance().remove(&DataKey::PendingAdmin);

        env.events().publish(
            (symbol_short!("admin"), symbol_short!("xfer_ok")),
            pending,
        );

        Ok(())
    }


    /// Register a new agent with no expiry. Principal-authorized.
    pub fn register(env: Env, principal: Address, agent: Address) -> Result<(), Error> {
        Self::require_initialized(&env)?;
        principal.require_auth();
        Self::ensure_registerable(&env, &principal, &agent)?;

        Self::store_new_agent(&env, &principal, &agent);
        // A fresh registration never inherits an expiry from an old one.
        env.storage()
            .persistent()
            .remove(&DataKey::AgentExpiry(agent.clone()));

        env.events().publish(
            (symbol_short!("agent"), symbol_short!("reg")),
            (principal, agent),
        );

        Ok(())
    }

    /// Register a new agent whose authority lapses at `expires_at`
    /// (ledger timestamp, seconds). `None` means "never expires".
    /// Principal-authorized.
    ///
    /// Emits `agent/reg` and, when an expiry is set, `agent/exp_set`.
    pub fn register_with_expiry(
        env: Env,
        principal: Address,
        agent: Address,
        expires_at: Option<u64>,
    ) -> Result<(), Error> {
        Self::require_initialized(&env)?;
        principal.require_auth();
        Self::ensure_registerable(&env, &principal, &agent)?;
        Self::check_expiry(&env, expires_at)?;

        Self::store_new_agent(&env, &principal, &agent);
        Self::write_expiry(&env, &agent, expires_at);

        env.events().publish(
            (symbol_short!("agent"), symbol_short!("reg")),
            (principal, agent),
        );

        Ok(())
    }

    /// Set, extend, shorten or clear (`None`) an agent's expiry. Admin only.
    ///
    /// The agent must be registered. Because expired entries are not deleted,
    /// the admin can also revive an expired agent by setting a new future
    /// expiry. Emits `agent/exp_set` (or `agent/exp_clr` for `None`).
    pub fn set_expiry(
        env: Env,
        agent: Address,
        expires_at: Option<u64>,
    ) -> Result<(), Error> {
        Self::require_admin(&env)?;
        Self::check_expiry(&env, expires_at)?;

        if !syncro_common::ttl::persistent_has(&env, &DataKey::Agent(agent.clone())) {
            return Err(Error::NotRegistered);
        }

        Self::write_expiry(&env, &agent, expires_at);
        Ok(())
    }

    /// Read an agent's expiry (ledger timestamp, seconds), if one is set.
    /// Returns `None` for "never expires" AND for unknown agents; use
    /// `is_authorized` to tell those apart.
    pub fn get_expiry(env: Env, agent: Address) -> Option<u64> {
        syncro_common::ttl::persistent_get::<_, u64>(&env, &DataKey::AgentExpiry(agent))
    }

    /// Reject registration when the agent is already owned by another principal.
    fn ensure_registerable(
        env: &Env,
        principal: &Address,
        agent: &Address,
    ) -> Result<(), Error> {
        if let Some(owner) = syncro_common::ttl::persistent_get::<_, Address>(
            env,
            &DataKey::AgentPrincipal(agent.clone()),
        ) {
            if owner != *principal {
                return Err(Error::Unauthorized);
            }
        }
        Ok(())
    }

    fn store_new_agent(env: &Env, principal: &Address, agent: &Address) {
        // Store an explicit u32 scope mask (initially empty). The previous
        // implementation stored a `bool` here, which is a different type than
        // the `u32` read by `has_scope`/`update_scopes` — reading it back as a
        // u32 would panic on the type mismatch. Initialising to 0 keeps the
        // stored type consistent and means a freshly registered agent has no
        // scopes until `update_scopes` grants them.
        syncro_common::ttl::persistent_set(env, &DataKey::Agent(agent.clone()), &0u32);
        syncro_common::ttl::persistent_set(
            env,
            &DataKey::AgentPrincipal(agent.clone()),
            principal,
        );
    }

    fn clear_agent(env: &Env, agent: &Address) {
        env.storage()
            .persistent()
            .remove(&DataKey::Agent(agent.clone()));
        env.storage()
            .persistent()
            .remove(&DataKey::AgentPrincipal(agent.clone()));
        env.storage()
            .persistent()
            .remove(&DataKey::AgentExpiry(agent.clone()));
    }

    /// Expiry must be strictly in the future (`None` is always fine).
    fn check_expiry(env: &Env, expires_at: Option<u64>) -> Result<(), Error> {
        match expires_at {
            Some(t) if t <= env.ledger().timestamp() => Err(Error::InvalidExpiry),
            _ => Ok(()),
        }
    }

    fn write_expiry(env: &Env, agent: &Address, expires_at: Option<u64>) {
        match expires_at {
            Some(t) => {
                syncro_common::ttl::persistent_set(env, &DataKey::AgentExpiry(agent.clone()), &t);
                env.events().publish(
                    (symbol_short!("agent"), symbol_short!("exp_set")),
                    (agent.clone(), t),
                );
            }
            None => {
                env.storage()
                    .persistent()
                    .remove(&DataKey::AgentExpiry(agent.clone()));
                env.events().publish(
                    (symbol_short!("agent"), symbol_short!("exp_clr")),
                    agent.clone(),
                );
            }
        }
    }

    /// True when the agent has an expiry and the ledger time has reached it.
    /// Authority is valid while `now < expires_at`.
    fn is_expired(env: &Env, agent: &Address) -> bool {
        match syncro_common::ttl::persistent_get::<_, u64>(
            env,
            &DataKey::AgentExpiry(agent.clone()),
        ) {
            Some(t) => env.ledger().timestamp() >= t,
            None => false,
        }
    }

    /// Update an agent's scope mask. Principal-authorized (owner only).
    pub fn update_scopes(
        env: Env,
        principal: Address,
        agent: Address,
        scopes: ScopeSet,
    ) -> Result<(), Error> {
        Self::require_initialized(&env)?;
        Self::require_agent_owner(&env, &principal, &agent)?;

        if !scopes.is_valid() {
            return Err(Error::InvalidScope);
        }

        if !syncro_common::ttl::persistent_has(&env, &DataKey::Agent(agent.clone())) {
            return Err(Error::NotRegistered);
        }

        syncro_common::ttl::persistent_set(&env, &DataKey::Agent(agent.clone()), &scopes.0);

        env.events().publish(
            (symbol_short!("agent"), symbol_short!("scopes")),
            (principal, agent, scopes.0),
        );

        Ok(())
    }


    /// Revoke an agent's authorization. Principal-authorized (owner only).
    pub fn revoke_agent(
        env: Env,
        principal: Address,
        agent: Address,
    ) -> Result<(), Error> {
        Self::require_initialized(&env)?;
        Self::require_agent_owner(&env, &principal, &agent)?;

        Self::clear_agent(&env, &agent);

        env.events().publish(
            (symbol_short!("agent"), symbol_short!("revoke")),
            (principal, agent),
        );

        Ok(())
    }

    /// Admin emergency revoke. Distinct from principal `revoke` (`agent/em_rev`).
    pub fn emergency_revoke(env: Env, agent: Address) -> Result<(), Error> {
        Self::require_admin(&env)?;

        if !syncro_common::ttl::persistent_has(&env, &DataKey::Agent(agent.clone())) {
            return Err(Error::NotRegistered);
        }

        let principal: Option<Address> = syncro_common::ttl::persistent_get(
            &env,
            &DataKey::AgentPrincipal(agent.clone()),
        );

        Self::clear_agent(&env, &agent);

        env.events().publish(
            (symbol_short!("agent"), symbol_short!("em_rev")),
            (principal, agent),
        );

        Ok(())
    }

    /// Read the principal that owns `agent`, if registered under the v3 model.
    pub fn get_principal(env: Env, agent: Address) -> Option<Address> {
        syncro_common::ttl::persistent_get(&env, &DataKey::AgentPrincipal(agent))
    }

    /// Check if an agent is authorized: registered AND not expired.
    pub fn is_authorized(env: Env, agent: Address) -> bool {
        syncro_common::ttl::persistent_has(&env, &DataKey::Agent(agent.clone()))
            && !Self::is_expired(&env, &agent)
    }

    /// Return Err(Error::NotRegistered) if the agent has no registry entry, or
    /// Err(Error::AuthorityExpired) if its authority has lapsed.
    pub fn require_authorized(env: Env, agent: Address) -> Result<(), Error> {
        if !syncro_common::ttl::persistent_has(&env, &DataKey::Agent(agent.clone())) {
            return Err(Error::NotRegistered);
        }
        if Self::is_expired(&env, &agent) {
            return Err(Error::AuthorityExpired);
        }
        Ok(())
    }

    pub fn has_scope(env: Env, agent: Address, scope: ScopeSet) -> bool {
        if Self::is_expired(&env, &agent) {
            return false;
        }
        match syncro_common::ttl::persistent_get::<_, u32>(&env, &DataKey::Agent(agent)) {
            Some(mask) => ScopeSet(mask).contains(&scope),
            None => false,
        }
    }

    /// Return Err(Error::MissingScope) if the agent lacks the requested scope.
    pub fn require_scope(env: Env, agent: Address, scope: ScopeSet) -> Result<(), Error> {
        agent.require_auth();

        if Self::is_expired(&env, &agent) {
            return Err(Error::AuthorityExpired);
        }
        if !Self::has_scope(env, agent.clone(), scope) {
            return Err(Error::MissingScope);
        }
        Ok(())
    }

    /// Return Err(Error::MissingScope) if the agent lacks the requested scopes.
    pub fn require_scopes(env: Env, agent: Address, scopes: ScopeSet) -> Result<(), Error> {
        Self::require_scope(env, agent, scopes)
    }
}

mod test;
#[cfg(test)]
mod negative;
#[cfg(test)]
mod scope_proptests;
