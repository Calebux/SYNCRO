#![no_std]

use soroban_sdk::{contract, contractevent, contractimpl, contracttype, Address, Env};

// ── Storage keys ──────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
enum ContractKey {
    Admin,
    Paused,
}

#[contracttype]
#[derive(Clone)]
struct SwitchKey {
    sub_id: u64,
}

// ── Data types ────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SwitchState {
    Active,
    Lapsed,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeadMansSwitch {
    pub sub_id: u64,
    pub owner: Address,
    pub lapse_threshold: u64,
    pub last_heartbeat: u64,
    pub state: SwitchState,
    pub created_at: u64,
}

// ── Events ────────────────────────────────────────────────────────

#[contractevent]
pub struct SwitchRegistered {
    pub sub_id: u64,
    pub owner: Address,
    pub lapse_threshold: u64,
}

#[contractevent]
pub struct HeartbeatReceived {
    pub sub_id: u64,
    pub timestamp: u64,
}

#[contractevent]
pub struct SwitchLapsed {
    pub sub_id: u64,
    pub last_heartbeat: u64,
    pub current_time: u64,
}

#[contractevent]
pub struct SwitchCancelled {
    pub sub_id: u64,
}

#[contractevent]
pub struct PauseToggled {
    pub paused: bool,
}

// ── Contract ──────────────────────────────────────────────────────

#[contract]
pub struct DeadMansSwitchContract;

#[contractimpl]
impl DeadMansSwitchContract {
    // ── Admin / Pause management ──────────────────────────────────

    /// Initialize the contract with an admin address.
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&ContractKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&ContractKey::Admin, &admin);
        env.storage().instance().set(&ContractKey::Paused, &false);
    }

    fn require_admin(env: &Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&ContractKey::Admin)
            .expect("Contract not initialized");
        admin.require_auth();
    }

    /// Pause or unpause all switch operations. Admin only.
    pub fn set_paused(env: Env, paused: bool) {
        Self::require_admin(&env);
        env.storage().instance().set(&ContractKey::Paused, &paused);
        PauseToggled { paused }.publish(&env);
    }

    /// Query the current pause state.
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&ContractKey::Paused)
            .unwrap_or(false)
    }

    // ── Switch lifecycle ──────────────────────────────────────────

    /// Register a dead man's switch for a subscription.
    ///
    /// The `lapse_threshold` is measured in ledger timestamp seconds.
    /// If no heartbeat is received within this window, the switch lapses
    /// and emits a `SwitchLapsed` event (the auto-cancel callback).
    pub fn register_switch(env: Env, owner: Address, sub_id: u64, lapse_threshold: u64) {
        if Self::is_paused(env.clone()) {
            panic!("Protocol is paused");
        }

        owner.require_auth();

        if lapse_threshold == 0 {
            panic!("Lapse threshold must be greater than 0");
        }

        let switch_key = SwitchKey { sub_id };
        if env.storage().persistent().has(&switch_key) {
            panic!("Switch already registered for this subscription");
        }

        let now = env.ledger().timestamp();
        let switch_data = DeadMansSwitch {
            sub_id,
            owner: owner.clone(),
            lapse_threshold,
            last_heartbeat: now,
            state: SwitchState::Active,
            created_at: now,
        };

        env.storage().persistent().set(&switch_key, &switch_data);

        SwitchRegistered {
            sub_id,
            owner,
            lapse_threshold,
        }
        .publish(&env);
    }

    /// Send a heartbeat to reset the lapse timer.
    ///
    /// Must be called by the switch owner before the lapse threshold
    /// expires to prevent auto-cancellation.
    pub fn heartbeat(env: Env, caller: Address, sub_id: u64) {
        if Self::is_paused(env.clone()) {
            panic!("Protocol is paused");
        }

        caller.require_auth();

        let switch_key = SwitchKey { sub_id };
        let mut switch_data: DeadMansSwitch = env
            .storage()
            .persistent()
            .get(&switch_key)
            .expect("Switch not found");

        if switch_data.state != SwitchState::Active {
            panic!("Switch is not active");
        }

        if caller != switch_data.owner {
            panic!("Unauthorized: caller must be switch owner");
        }

        let now = env.ledger().timestamp();
        switch_data.last_heartbeat = now;
        env.storage().persistent().set(&switch_key, &switch_data);

        HeartbeatReceived {
            sub_id,
            timestamp: now,
        }
        .publish(&env);
    }

    /// Check whether the switch has lapsed.
    ///
    /// If the elapsed time since the last heartbeat exceeds the threshold,
    /// the switch is marked as `Lapsed` and a `SwitchLapsed` event is emitted.
    /// This event serves as the auto-cancel callback that off-chain services
    /// should listen for to cancel/pause the associated subscription.
    ///
    /// This function is intentionally permissionless — any watcher, bot, or
    /// keeper service may trigger lapse detection without authorization.
    /// It also deliberately bypasses the protocol pause flag so that safety
    /// checks continue to fire even when other operations are paused.
    ///
    /// Returns the current `SwitchState`.
    pub fn check_lapse(env: Env, sub_id: u64) -> SwitchState {
        let switch_key = SwitchKey { sub_id };
        let mut switch_data: DeadMansSwitch = env
            .storage()
            .persistent()
            .get(&switch_key)
            .expect("Switch not found");

        if switch_data.state != SwitchState::Active {
            return switch_data.state;
        }

        let now = env.ledger().timestamp();
        let elapsed = now.saturating_sub(switch_data.last_heartbeat);

        if elapsed > switch_data.lapse_threshold {
            switch_data.state = SwitchState::Lapsed;
            env.storage().persistent().set(&switch_key, &switch_data);

            SwitchLapsed {
                sub_id,
                last_heartbeat: switch_data.last_heartbeat,
                current_time: now,
            }
            .publish(&env);
        }

        switch_data.state
    }

    /// Manually cancel/disable a dead man's switch. Owner only.
    pub fn cancel_switch(env: Env, caller: Address, sub_id: u64) {
        caller.require_auth();

        let switch_key = SwitchKey { sub_id };
        let mut switch_data: DeadMansSwitch = env
            .storage()
            .persistent()
            .get(&switch_key)
            .expect("Switch not found");

        if caller != switch_data.owner {
            panic!("Unauthorized: caller must be switch owner");
        }

        if switch_data.state == SwitchState::Cancelled {
            panic!("Switch already cancelled");
        }

        switch_data.state = SwitchState::Cancelled;
        env.storage().persistent().set(&switch_key, &switch_data);

        SwitchCancelled { sub_id }.publish(&env);
    }

    /// Get the current state of a dead man's switch.
    pub fn get_switch(env: Env, sub_id: u64) -> DeadMansSwitch {
        let switch_key = SwitchKey { sub_id };
        env.storage()
            .persistent()
            .get(&switch_key)
            .expect("Switch not found")
    }
}

#[cfg(test)]
mod test;
