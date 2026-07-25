#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype,
    vec, Address, BytesN, Env, String, Vec,
};

// ============================================================================
// CONSTANTS
// ============================================================================

/// Default time-lock duration in seconds (48 hours).
pub const DEFAULT_TIMELOCK_SECONDS: u64 = 172_800;

/// Required approvals threshold (2-of-3).
pub const REQUIRED_APPROVALS: u32 = 2;

// ============================================================================
// STORAGE KEYS
// ============================================================================

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Guardians,
    GuardianCount,
    Admin,
    ProposalCount,
    Proposal(u64),
    RollbackWasmHash,
    RollbackContractId,
    RollbackConsumed,
    UpgradesPaused,
    TimelockOverride,
    ApprovedBy(u64),
}

// ============================================================================
// DATA TYPES
// ============================================================================

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProposalState {
    Pending,
    Approved,
    Ready,
    Executed,
    Cancelled,
    RolledBack,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeProposal {
    pub id: u64,
    pub description: String,
    pub target_contract: String,
    pub new_wasm_hash: BytesN<32>,
    pub proposer: Address,
    pub state: ProposalState,
    pub created_at: u64,
    pub approved_at: u64,
    pub executable_at: u64,
    pub previous_wasm_hash: BytesN<32>,
}

// ============================================================================
// ERRORS
// ============================================================================

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum UpgradeError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    NotGuardian = 4,
    ProposalNotFound = 5,
    InvalidStateTransition = 6,
    AlreadyApprovedBySigner = 7,
    DuplicateGuardian = 8,
    GuardianSetFull = 9,
    UpgradesPaused = 10,
    TimelockNotExpired = 11,
    NoRollbackAvailable = 12,
    RollbackAlreadyConsumed = 13,
    InvalidArgument = 14,
}

// ============================================================================
// EVENTS
// ============================================================================

#[contractevent]
pub struct UpgradeProposed {
    pub proposal_id: u64,
    pub target_contract: String,
    pub new_wasm_hash: BytesN<32>,
    pub proposer: Address,
}

#[contractevent]
pub struct UpgradeApproved {
    pub proposal_id: u64,
    pub approved_by: Address,
    pub approvals_count: u32,
}

#[contractevent]
pub struct UpgradeReady {
    pub proposal_id: u64,
    pub executable_at: u64,
}

#[contractevent]
pub struct UpgradeExecuted {
    pub proposal_id: u64,
    pub new_wasm_hash: BytesN<32>,
    pub previous_wasm_hash: BytesN<32>,
}

#[contractevent]
pub struct UpgradeRolledBack {
    pub proposal_id: u64,
    pub restored_wasm_hash: BytesN<32>,
}

#[contractevent]
pub struct UpgradeCancelled {
    pub proposal_id: u64,
    pub cancelled_by: Address,
}

#[contractevent]
pub struct GuardianSetChanged {
    pub guardians: Vec<Address>,
}

#[contractevent]
pub struct UpgradesPauseToggled {
    pub paused: bool,
}

// ============================================================================
// CONTRACT — Init & Helpers
// ============================================================================

#[contract]
pub struct ContractUpgradeGovernance;

#[contractimpl]
impl ContractUpgradeGovernance {
    pub fn init(env: Env, admin: Address, guardians: Vec<Address>) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!(UpgradeError::AlreadyInitialized);
        }
        let count = guardians.len();
        if count < 2 || count > 3 {
            panic!(UpgradeError::InvalidArgument);
        }
        for i in 0..count {
            for j in (i + 1)..count {
                if guardians.get_unchecked(i) == guardians.get_unchecked(j) {
                    panic!(UpgradeError::DuplicateGuardian);
                }
            }
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Guardians, &guardians);
        env.storage().instance().set(&DataKey::GuardianCount, &(count as u32));
        env.storage().instance().set(&DataKey::UpgradesPaused, &false);
        env.storage().instance().set(&DataKey::ProposalCount, &0u64);
        env.storage().instance().set(&DataKey::RollbackConsumed, &false);
    }

    fn require_admin(env: &Env) {
        let admin: Address = env.storage().instance()
            .get(&DataKey::Admin).expect("not initialized");
        admin.require_auth();
    }

    fn require_initialized(env: &Env) {
        if !env.storage().instance().has(&DataKey::Admin) {
            panic!(UpgradeError::NotInitialized);
        }
    }

    fn require_not_paused(env: &Env) {
        let paused: bool = env.storage().instance()
            .get(&DataKey::UpgradesPaused).unwrap_or(false);
        if paused { panic!(UpgradeError::UpgradesPaused); }
    }

    fn is_guardian(env: &Env, addr: &Address) -> bool {
        let guardians: Vec<Address> = env.storage().instance()
            .get(&DataKey::Guardians).expect("not initialized");
        guardians.iter().any(|g| g == *addr)
    }

    fn timelock_duration(env: &Env) -> u64 {
        env.storage().instance()
            .get(&DataKey::TimelockOverride)
            .unwrap_or(DEFAULT_TIMELOCK_SECONDS)
    }

    fn save_rollback_slot(env: &Env, wasm_hash: BytesN<32>, contract_id: String) {
        env.storage().persistent().set(&DataKey::RollbackWasmHash, &wasm_hash);
        env.storage().persistent().set(&DataKey::RollbackContractId, &contract_id);
    }
}

// ============================================================================
// CONTRACT — Guardian Management & Proposal
// ============================================================================

#[contractimpl]
impl ContractUpgradeGovernance {
    pub fn get_guardians(env: Env) -> Vec<Address> {
        Self::require_initialized(&env);
        env.storage().instance()
            .get(&DataKey::Guardians).expect("not initialized")
    }

    pub fn get_guardian_count(env: Env) -> u32 {
        Self::require_initialized(&env);
        env.storage().instance()
            .get(&DataKey::GuardianCount).unwrap_or(0)
    }

    pub fn set_guardians(env: Env, new_guardians: Vec<Address>) {
        Self::require_admin(&env);
        let count = new_guardians.len();
        if count < 2 || count > 3 { panic!(UpgradeError::InvalidArgument); }
        for i in 0..count {
            for j in (i + 1)..count {
                if new_guardians.get_unchecked(i) == new_guardians.get_unchecked(j) {
                    panic!(UpgradeError::DuplicateGuardian);
                }
            }
        }
        env.storage().instance().set(&DataKey::Guardians, &new_guardians);
        env.storage().instance().set(&DataKey::GuardianCount, &(count as u32));
        GuardianSetChanged { guardians: new_guardians }.publish(&env);
    }

    pub fn propose_upgrade(
        env: Env,
        proposer: Address,
        target_contract: String,
        new_wasm_hash: BytesN<32>,
        previous_wasm_hash: BytesN<32>,
        description: String,
    ) -> u64 {
        Self::require_initialized(&env);
        Self::require_not_paused(&env);
        if !Self::is_guardian(&env, &proposer) { panic!(UpgradeError::NotGuardian); }
        proposer.require_auth();

        let count: u64 = env.storage().instance()
            .get(&DataKey::ProposalCount).unwrap_or(0);
        let proposal_id = count + 1;
        let now = env.ledger().timestamp();

        let proposal = UpgradeProposal {
            id: proposal_id,
            description,
            target_contract: target_contract.clone(),
            new_wasm_hash: new_wasm_hash.clone(),
            proposer: proposer.clone(),
            state: ProposalState::Pending,
            created_at: now,
            approved_at: 0,
            executable_at: 0,
            previous_wasm_hash: previous_wasm_hash.clone(),
        };

        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
        env.storage().instance().set(&DataKey::ProposalCount, &proposal_id);
        let empty: Vec<Address> = vec![&env];
        env.storage().persistent().set(&DataKey::ApprovedBy(proposal_id), &empty);

        UpgradeProposed {
            proposal_id,
            target_contract: proposal.target_contract.clone(),
            new_wasm_hash,
            proposer,
        }.publish(&env);

        proposal_id
    }
}

// ============================================================================
// CONTRACT — Approval, Execution, Rollback, Admin
// ============================================================================

#[contractimpl]
impl ContractUpgradeGovernance {
    /// Approve an upgrade proposal (guardian only).
    /// Once REQUIRED_APPROVALS (2-of-3) is reached, the timelock starts.
    pub fn approve_upgrade(env: Env, proposal_id: u64, guardian: Address) {
        Self::require_initialized(&env);
        Self::require_not_paused(&env);
        if !Self::is_guardian(&env, &guardian) { panic!(UpgradeError::NotGuardian); }
        guardian.require_auth();

        let mut proposal: UpgradeProposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id)).expect("proposal not found");
        if proposal.state != ProposalState::Pending {
            panic!(UpgradeError::InvalidStateTransition);
        }

        let mut approved_by: Vec<Address> = env.storage().persistent()
            .get(&DataKey::ApprovedBy(proposal_id)).expect("approved list not found");
        if approved_by.iter().any(|a| a == guardian) {
            panic!(UpgradeError::AlreadyApprovedBySigner);
        }

        approved_by.push_back(guardian.clone());
        env.storage().persistent().set(&DataKey::ApprovedBy(proposal_id), &approved_by);
        let approvals_count = approved_by.len() as u32;

        if approvals_count >= REQUIRED_APPROVALS {
            let now = env.ledger().timestamp();
            let timelock = Self::timelock_duration(&env);
            let executable_at = now + timelock;
            proposal.state = ProposalState::Approved;
            proposal.approved_at = now;
            proposal.executable_at = executable_at;
            env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
            UpgradeReady { proposal_id, executable_at }.publish(&env);
        }

        UpgradeApproved { proposal_id, approved_by: guardian, approvals_count }.publish(&env);
    }

    /// Execute an approved upgrade after the timelock has expired.
    /// Records the rollback slot for the old WASM hash.
    pub fn execute_upgrade(env: Env, proposal_id: u64, executor: Address, new_wasm_hash: BytesN<32>) {
        Self::require_initialized(&env);
        Self::require_not_paused(&env);
        if !Self::is_guardian(&env, &executor) {
            let admin: Address = env.storage().instance()
                .get(&DataKey::Admin).expect("not initialized");
            if executor != admin { panic!(UpgradeError::Unauthorized); }
        }
        executor.require_auth();

        let mut proposal: UpgradeProposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id)).expect("proposal not found");
        if proposal.state != ProposalState::Approved {
            panic!(UpgradeError::InvalidStateTransition);
        }
        let now = env.ledger().timestamp();
        if now < proposal.executable_at {
            panic!(UpgradeError::TimelockNotExpired);
        }

        Self::save_rollback_slot(&env, proposal.previous_wasm_hash.clone(), proposal.target_contract.clone());
        env.storage().persistent().set(&DataKey::RollbackConsumed, &false);

        proposal.state = ProposalState::Executed;
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);

        UpgradeExecuted {
            proposal_id,
            new_wasm_hash,
            previous_wasm_hash: proposal.previous_wasm_hash.clone(),
        }.publish(&env);
    }

    /// Rollback to the previous WASM version.
    /// Admin can rollback directly (emergency). Guardians need rollback to be available.
    pub fn rollback_upgrade(env: Env, caller: Address, previous_wasm_hash: BytesN<32>) {
        Self::require_initialized(&env);
        Self::require_not_paused(&env);
        let is_admin = {
            let admin: Address = env.storage().instance()
                .get(&DataKey::Admin).expect("not initialized");
            caller == admin
        };
        if !is_admin && !Self::is_guardian(&env, &caller) {
            panic!(UpgradeError::Unauthorized);
        }
        caller.require_auth();

        if !is_admin {
            let consumed: bool = env.storage().persistent()
                .get(&DataKey::RollbackConsumed).unwrap_or(true);
            if consumed { panic!(UpgradeError::RollbackAlreadyConsumed); }
        }

        let stored_hash: BytesN<32> = env.storage().persistent()
            .get(&DataKey::RollbackWasmHash).expect("no rollback slot");
        if stored_hash != previous_wasm_hash { panic!(UpgradeError::InvalidArgument); }

        env.storage().persistent().set(&DataKey::RollbackConsumed, &true);

        UpgradeRolledBack { proposal_id: 0, restored_wasm_hash: previous_wasm_hash }.publish(&env);
    }

    /// Cancel a proposal (admin only).
    pub fn cancel_proposal(env: Env, proposal_id: u64) {
        Self::require_admin(&env);
        let mut proposal: UpgradeProposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id)).expect("proposal not found");
        if proposal.state == ProposalState::Executed
            || proposal.state == ProposalState::Cancelled
            || proposal.state == ProposalState::RolledBack {
            panic!(UpgradeError::InvalidStateTransition);
        }
        proposal.state = ProposalState::Cancelled;
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
        UpgradeCancelled { proposal_id, cancelled_by: env.current_contract_address() }.publish(&env);
    }

    /// Set a custom timelock duration (admin only). Minimum 1 hour.
    pub fn set_timelock(env: Env, duration_seconds: u64) {
        Self::require_admin(&env);
        if duration_seconds < 3600 { panic!(UpgradeError::InvalidArgument); }
        env.storage().instance().set(&DataKey::TimelockOverride, &duration_seconds);
    }

    pub fn get_timelock(env: Env) -> u64 {
        Self::require_initialized(&env);
        Self::timelock_duration(&env)
    }

    /// Toggle the paused state of upgrades (admin only).
    pub fn toggle_pause(env: Env) {
        Self::require_admin(&env);
        let paused: bool = env.storage().instance()
            .get(&DataKey::UpgradesPaused).unwrap_or(false);
        let new_paused = !paused;
        env.storage().instance().set(&DataKey::UpgradesPaused, &new_paused);
        UpgradesPauseToggled { paused: new_paused }.publish(&env);
    }

    pub fn is_paused(env: Env) -> bool {
        Self::require_initialized(&env);
        env.storage().instance().get(&DataKey::UpgradesPaused).unwrap_or(false)
    }

    pub fn get_proposal(env: Env, proposal_id: u64) -> UpgradeProposal {
        env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id)).expect("proposal not found")
    }

    pub fn get_proposal_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::ProposalCount).unwrap_or(0)
    }

    pub fn get_approved_by(env: Env, proposal_id: u64) -> Vec<Address> {
        Self::require_initialized(&env);
        env.storage().persistent()
            .get(&DataKey::ApprovedBy(proposal_id)).unwrap_or(vec![&env])
    }

    pub fn get_admin(env: Env) -> Address {
        Self::require_initialized(&env);
        env.storage().instance().get(&DataKey::Admin).expect("not initialized")
    }

    pub fn get_rollback_wasm_hash(env: Env) -> Option<BytesN<32>> {
        env.storage().persistent().get(&DataKey::RollbackWasmHash)
    }

    pub fn is_rollback_available(env: Env) -> bool {
        let consumed: bool = env.storage().persistent()
            .get(&DataKey::RollbackConsumed).unwrap_or(true);
        let has_hash: bool = env.storage().persistent()
            .has(&DataKey::RollbackWasmHash);
        !consumed && has_hash
    }
}

#[cfg(test)]
mod test;
