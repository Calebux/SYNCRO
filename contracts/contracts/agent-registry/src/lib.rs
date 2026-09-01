#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env,
};
use syncro_common;

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
    Agent(Address),
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
        Ok(())
    }

    fn require_admin(env: &Env) -> Result<Address, Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;

        admin.require_auth();
        Ok(admin)
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

        env.storage().instance().set(&DataKey::Admin, &pending);
        env.storage().instance().remove(&DataKey::PendingAdmin);

        env.events().publish(
            (symbol_short!("admin"), symbol_short!("xfer_ok")),
            pending,
        );

        Ok(())
    }


    /// Register a new agent. Admin only.
    pub fn register(env: Env, agent: Address) -> Result<(), Error> {
        Self::require_admin(&env)?;

        // Store an explicit u32 scope mask (initially empty). The previous
        // implementation stored a `bool` here, which is a different type than
        // the `u32` read by `has_scope`/`update_scopes` — reading it back as a
        // u32 would panic on the type mismatch. Initialising to 0 keeps the
        // stored type consistent and means a freshly registered agent has no
        // scopes until `update_scopes` grants them.
        env.storage()
            .persistent()
            .set(&DataKey::Agent(agent.clone()), &0u32);

        env.events()
            .publish((symbol_short!("agent"), symbol_short!("reg")), agent);

        Ok(())
    }

    pub fn update_scopes(
        env: Env,
        agent: Address,
        scopes: ScopeSet,
    ) -> Result<(), Error> {
        Self::require_admin(&env)?;

        if !scopes.is_valid() {
            return Err(Error::InvalidScope);
        }

        if !env.storage().persistent().has(&DataKey::Agent(agent.clone())) {
            return Err(Error::Unauthorized);
        }

        env.storage()
            .persistent()
            .set(&DataKey::Agent(agent.clone()), &scopes.0);

        env.events().publish(
            (symbol_short!("agent"), symbol_short!("scopes")),
            (agent, scopes.0),
        );

        Ok(())
    }


    /// Revoke an agent's authorization. Admin only.
    pub fn revoke_agent(env: Env, agent: Address) -> Result<(), Error> {
        Self::require_admin(&env)?;

        env.storage()
            .persistent()
            .remove(&DataKey::Agent(agent.clone()));

        env.events().publish(
            (symbol_short!("agent"), symbol_short!("revoke")),
            agent,
        );

        Ok(())
    }

    /// Check if an agent is authorized.
    pub fn is_authorized(env: Env, agent: Address) -> bool {
        env.storage().persistent().has(&DataKey::Agent(agent))
    }

    /// Return Err(Error::NotRegistered) if the agent has no registry entry.
    pub fn require_authorized(env: Env, agent: Address) -> Result<(), Error> {
        if !env.storage().persistent().has(&DataKey::Agent(agent)) {
            return Err(Error::NotRegistered);
        }
        Ok(())
    }

    pub fn has_scope(env: Env, agent: Address, scope: ScopeSet) -> bool {
        match env
            .storage()
            .persistent()
            .get::<_, u32>(&DataKey::Agent(agent))
        {
            Some(mask) => ScopeSet(mask).contains(&scope),
            None => false,
        }
    }

    /// Return Err(Error::MissingScope) if the agent lacks the requested scope.
    pub fn require_scope(env: Env, agent: Address, scope: ScopeSet) -> Result<(), Error> {
        agent.require_auth();

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
