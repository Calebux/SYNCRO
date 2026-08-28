#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env,
};

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
}


#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Scope {
    Renewals = 1,
    GiftCards = 2,
    Approvals = 4,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentRecord {
    pub scopes: u32,
    pub registered_at: u64,
    pub active: bool,
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


    /// Register a new agent with the provided scope mask. Admin only.
    pub fn register(env: Env, agent: Address, initial_scopes: u32) -> Result<(), Error> {
        Self::require_admin(&env)?;

        let record = AgentRecord {
            scopes: initial_scopes,
            registered_at: env.ledger().timestamp(),
            active: true,
        };
        env.storage().persistent().set(&DataKey::Agent(agent.clone()), &record);

        env.events()
            .publish((symbol_short!("agent"), symbol_short!("reg")), agent);

        Ok(())
    }

    pub fn update_scopes(
        env: Env,
        agent: Address,
        scopes: u32,
    ) -> Result<(), Error> {
        Self::require_admin(&env)?;

        let mut record: AgentRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Agent(agent.clone()))
            .ok_or(Error::Unauthorized)?;
        if !record.active {
            return Err(Error::Unauthorized);
        }

        record.scopes = scopes;

        env.storage()
            .persistent()
            .set(&DataKey::Agent(agent.clone()), &record);

        env.events().publish(
            (symbol_short!("agent"), symbol_short!("scopes")),
            (agent, scopes),
        );

        Ok(())
    }


    /// Revoke an agent's authorization. Admin only.
    pub fn revoke_agent(env: Env, agent: Address) -> Result<(), Error> {
        Self::require_admin(&env)?;

        let mut record: AgentRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Agent(agent.clone()))
            .ok_or(Error::Unauthorized)?;
        record.active = false;
        env.storage().persistent().set(&DataKey::Agent(agent.clone()), &record);

        env.events().publish(
            (symbol_short!("agent"), symbol_short!("revoke")),
            agent,
        );

        Ok(())
    }

    /// Check if an agent is authorized.
    pub fn is_authorized(env: Env, agent: Address) -> bool {
        env.storage()
            .persistent()
            .get::<_, AgentRecord>(&DataKey::Agent(agent))
            .map(|record| record.active)
            .unwrap_or(false)
    }

    /// Panic if an agent is not authorized.
    pub fn require_authorized(env: Env, agent: Address) {
        if !Self::is_authorized(env, agent) {
            panic!("agent not authorized");
        }
    }

    pub fn has_scope(env: Env, agent: Address, scope: Scope) -> bool {
        match env
            .storage()
            .persistent()
            .get::<_, AgentRecord>(&DataKey::Agent(agent))
        {
            Some(record) => record.active && (record.scopes & scope as u32) != 0,
            None => false,
        }
    }

      /// Enforce agent authorization + scope
    pub fn require_scope(env: Env, agent: Address, scope: Scope) {
        agent.require_auth();

        if !Self::has_scope(env, agent, scope) {
            panic!("agent missing required scope");
        }
    }

}

mod test;
