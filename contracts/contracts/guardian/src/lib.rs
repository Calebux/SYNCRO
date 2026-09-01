#![no_std]

//! # Guardian Contract
//!
//! A shared guardian contract that can pause/unpause a registered set of contracts
//! in one call for incident response. This provides a centralized emergency stop
//! mechanism controlled by a multisig guardian.
//!
//! ## Features
//! - Register/unregister target contracts
//! - One-shot pause/unpause all registered contracts
//! - Guardian multisig control
//! - Emergency incident response capabilities

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, Address,
    Env, Vec,
};
use syncro_common;

// ── Storage Keys ────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
enum DataKey {
    /// The guardian multisig address (required for all operations)
    Guardian,
    /// List of registered contract addresses that can be paused
    RegisteredContracts,
    /// Tracks whether the guardian has been initialized
    Initialized,
}

// ── Data Types ──────────────────────────────────────────────────────────────────

/// Information about a registered contract
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RegisteredContract {
    /// The contract address
    pub address: Address,
    /// Human-readable name/identifier
    pub name: soroban_sdk::String,
    /// Whether the contract is currently paused
    pub paused: bool,
    /// Registration timestamp
    pub registered_at: u64,
}

// ── Errors ──────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum GuardianError {
    AlreadyInitialized = 2800,
    NotInitialized = 2801,
    Unauthorized = 2802,
    ContractAlreadyRegistered = 2803,
    ContractNotFound = 2804,
    NoContractsRegistered = 2805,
    InvalidAddress = 2806,
}

// ── Events ──────────────────────────────────────────────────────────────────────

#[contractevent]
pub struct GuardianInitialized {
    pub guardian: Address,
}

#[contractevent]
pub struct ContractRegistered {
    pub contract: Address,
    pub name: soroban_sdk::String,
}

#[contractevent]
pub struct ContractUnregistered {
    pub contract: Address,
}

#[contractevent]
pub struct EmergencyPauseAll {
    pub guardian: Address,
    pub contracts_paused: u32,
    pub timestamp: u64,
}

#[contractevent]
pub struct EmergencyUnpauseAll {
    pub guardian: Address,
    pub contracts_unpaused: u32,
    pub timestamp: u64,
}

#[contractevent]
pub struct PauseOperationFailed {
    pub contract: Address,
    pub error: soroban_sdk::String,
}

// ── Contract ────────────────────────────────────────────────────────────────────

#[contract]
pub struct GuardianContract;

#[contractimpl]
impl GuardianContract {
    // ── Initialization ────────────────────────────────────────────

    /// Initialize the guardian contract with a multisig address.
    /// Can only be called once.
    ///
    /// # Arguments
    /// * `guardian` - The multisig address that will control this guardian
    pub fn initialize(env: Env, guardian: Address) {
        if env.storage().instance().has(&DataKey::Initialized) {
            panic_with_error!(&env, GuardianError::AlreadyInitialized);
        }

        guardian.require_auth();

        env.storage().instance().set(&DataKey::Guardian, &guardian);
        env.storage().instance().set(&DataKey::Initialized, &true);
        
        // Initialize empty contract list
        let contracts: Vec<RegisteredContract> = Vec::new(&env);
        env.storage()
            .persistent()
            .set(&DataKey::RegisteredContracts, &contracts);

        GuardianInitialized {
            guardian: guardian.clone(),
        }
        .publish(&env);
    }

    // ── Access Control ────────────────────────────────────────────

    /// Internal helper to verify guardian authorization
    fn require_guardian(env: &Env) {
        if !env.storage().instance().has(&DataKey::Initialized) {
            panic_with_error!(env, GuardianError::NotInitialized);
        }

        let guardian: Address = env
            .storage()
            .instance()
            .get(&DataKey::Guardian)
            .unwrap();
        guardian.require_auth();
    }

    // ── Contract Registration ─────────────────────────────────────

    /// Register a contract to be managed by this guardian.
    /// Only the guardian multisig can register contracts.
    ///
    /// # Arguments
    /// * `contract` - The address of the contract to register
    /// * `name` - A human-readable name for the contract
    pub fn register_contract(env: Env, contract: Address, name: soroban_sdk::String) {
        Self::require_guardian(&env);

        let mut contracts: Vec<RegisteredContract> = env
            .storage()
            .persistent()
            .get(&DataKey::RegisteredContracts)
            .unwrap();

        // Check if contract is already registered
        for i in 0..contracts.len() {
            let reg = contracts.get(i).unwrap();
            if reg.address == contract {
                panic_with_error!(&env, GuardianError::ContractAlreadyRegistered);
            }
        }

        // Add new contract
        let registered_contract = RegisteredContract {
            address: contract.clone(),
            name: name.clone(),
            paused: false,
            registered_at: env.ledger().timestamp(),
        };

        contracts.push_back(registered_contract);
        env.storage()
            .persistent()
            .set(&DataKey::RegisteredContracts, &contracts);

        ContractRegistered {
            contract,
            name,
        }
        .publish(&env);
    }

    /// Unregister a contract from guardian management.
    /// Only the guardian multisig can unregister contracts.
    ///
    /// # Arguments
    /// * `contract` - The address of the contract to unregister
    pub fn unregister_contract(env: Env, contract: Address) {
        Self::require_guardian(&env);

        let mut contracts: Vec<RegisteredContract> = env
            .storage()
            .persistent()
            .get(&DataKey::RegisteredContracts)
            .unwrap();

        let mut found_index: Option<u32> = None;
        for i in 0..contracts.len() {
            let reg = contracts.get(i).unwrap();
            if reg.address == contract {
                found_index = Some(i);
                break;
            }
        }

        match found_index {
            Some(index) => {
                contracts.remove(index);
                env.storage()
                    .persistent()
                    .set(&DataKey::RegisteredContracts, &contracts);

                ContractUnregistered {
                    contract,
                }
                .publish(&env);
            }
            None => {
                panic_with_error!(&env, GuardianError::ContractNotFound);
            }
        }
    }

    // ── Emergency Controls ────────────────────────────────────────

    /// Emergency pause all registered contracts in one call.
    /// This is the primary incident response mechanism.
    /// Only the guardian multisig can trigger this.
    ///
    /// Returns the number of contracts successfully paused.
    pub fn emergency_pause_all(env: Env) -> u32 {
        Self::require_guardian(&env);

        let mut contracts: Vec<RegisteredContract> = env
            .storage()
            .persistent()
            .get(&DataKey::RegisteredContracts)
            .unwrap();

        if contracts.is_empty() {
            panic_with_error!(&env, GuardianError::NoContractsRegistered);
        }

        let mut paused_count: u32 = 0;

        for i in 0..contracts.len() {
            let mut reg = contracts.get(i).unwrap();
            
            // Call the contract's set_paused function
            // We use a generic interface that expects a set_paused(bool) function
            let result = env.try_invoke_contract::<_, ()>(
                &reg.address,
                &soroban_sdk::symbol_short!("set_paused"),
                soroban_sdk::vec![&env, true.into_val(&env)],
            );

            match result {
                Ok(_) => {
                    reg.paused = true;
                    contracts.set(i, reg);
                    paused_count += 1;
                }
                Err(_) => {
                    // Log the failure but continue with other contracts
                    PauseOperationFailed {
                        contract: reg.address.clone(),
                        error: soroban_sdk::String::from_str(&env, "Failed to pause"),
                    }
                    .publish(&env);
                }
            }
        }

        env.storage()
            .persistent()
            .set(&DataKey::RegisteredContracts, &contracts);

        let guardian: Address = env.storage().instance().get(&DataKey::Guardian).unwrap();
        
        EmergencyPauseAll {
            guardian,
            contracts_paused: paused_count,
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);

        paused_count
    }

    /// Unpause all registered contracts in one call.
    /// Use this to resume normal operations after incident resolution.
    /// Only the guardian multisig can trigger this.
    ///
    /// Returns the number of contracts successfully unpaused.
    pub fn emergency_unpause_all(env: Env) -> u32 {
        Self::require_guardian(&env);

        let mut contracts: Vec<RegisteredContract> = env
            .storage()
            .persistent()
            .get(&DataKey::RegisteredContracts)
            .unwrap();

        if contracts.is_empty() {
            panic_with_error!(&env, GuardianError::NoContractsRegistered);
        }

        let mut unpaused_count: u32 = 0;

        for i in 0..contracts.len() {
            let mut reg = contracts.get(i).unwrap();
            
            // Call the contract's set_paused function
            let result = env.try_invoke_contract::<_, ()>(
                &reg.address,
                &soroban_sdk::symbol_short!("set_paused"),
                soroban_sdk::vec![&env, false.into_val(&env)],
            );

            match result {
                Ok(_) => {
                    reg.paused = false;
                    contracts.set(i, reg);
                    unpaused_count += 1;
                }
                Err(_) => {
                    // Log the failure but continue with other contracts
                    PauseOperationFailed {
                        contract: reg.address.clone(),
                        error: soroban_sdk::String::from_str(&env, "Failed to unpause"),
                    }
                    .publish(&env);
                }
            }
        }

        env.storage()
            .persistent()
            .set(&DataKey::RegisteredContracts, &contracts);

        let guardian: Address = env.storage().instance().get(&DataKey::Guardian).unwrap();
        
        EmergencyUnpauseAll {
            guardian,
            contracts_unpaused: unpaused_count,
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);

        unpaused_count
    }

    // ── Queries ───────────────────────────────────────────────────

    /// Get the guardian multisig address
    pub fn get_guardian(env: Env) -> Address {
        if !env.storage().instance().has(&DataKey::Initialized) {
            panic_with_error!(&env, GuardianError::NotInitialized);
        }
        env.storage().instance().get(&DataKey::Guardian).unwrap()
    }

    /// Get all registered contracts
    pub fn get_registered_contracts(env: Env) -> Vec<RegisteredContract> {
        if !env.storage().instance().has(&DataKey::Initialized) {
            panic_with_error!(&env, GuardianError::NotInitialized);
        }
        env.storage()
            .persistent()
            .get(&DataKey::RegisteredContracts)
            .unwrap()
    }

    /// Get the count of registered contracts
    pub fn get_contract_count(env: Env) -> u32 {
        if !env.storage().instance().has(&DataKey::Initialized) {
            panic_with_error!(&env, GuardianError::NotInitialized);
        }
        let contracts: Vec<RegisteredContract> = env
            .storage()
            .persistent()
            .get(&DataKey::RegisteredContracts)
            .unwrap();
        contracts.len()
    }

    /// Check if a specific contract is registered
    pub fn is_contract_registered(env: Env, contract: Address) -> bool {
        if !env.storage().instance().has(&DataKey::Initialized) {
            return false;
        }
        let contracts: Vec<RegisteredContract> = env
            .storage()
            .persistent()
            .get(&DataKey::RegisteredContracts)
            .unwrap_or_else(|| Vec::new(&env));

        for i in 0..contracts.len() {
            let reg = contracts.get(i).unwrap();
            if reg.address == contract {
                return true;
            }
        }
        false
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
