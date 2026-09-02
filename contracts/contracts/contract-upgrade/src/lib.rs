#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error,
    vec, Address, BytesN, Env, String, Vec,
};
use syncro_common;

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
    BatchProposal(u64),
    /// Per-target rollback WASM hash.
    RollbackWasmHash(Address),
    /// Per-target rollback consumption flag.
    RollbackConsumed(Address),
    UpgradesPaused,
    TimelockOverride,
    ContractTimelock(Address),
    Governed(Address),
    GovernedList,
    ApprovedBy(u64),
    /// Currently executable (Pending/Approved) proposal for a target.
    ActiveProposal(Address),
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
    Invalidated,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeProposal {
    pub id: u64,
    pub description: String,
    pub target_contract: Address,
    pub new_wasm_hash: BytesN<32>,
    pub proposer: Address,
    pub state: ProposalState,
    pub created_at: u64,
    pub approved_at: u64,
    pub executable_at: u64,
    pub previous_wasm_hash: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchUpgradeProposal {
    pub id: u64,
    pub description: String,
    pub targets: Vec<Address>,
    pub new_wasm_hashes: Vec<BytesN<32>>,
    pub previous_wasm_hashes: Vec<BytesN<32>>,
    pub proposer: Address,
    pub state: ProposalState,
    pub created_at: u64,
    pub approved_at: u64,
    pub executable_at: u64,
}

// ============================================================================
// ERRORS
// ============================================================================

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum UpgradeError {
    NotInitialized = 1700,
    AlreadyInitialized = 1701,
    Unauthorized = 1702,
    NotGuardian = 1703,
    ProposalNotFound = 1704,
    InvalidStateTransition = 1705,
    AlreadyApprovedBySigner = 1706,
    DuplicateGuardian = 1707,
    GuardianSetFull = 1708,
    UpgradesPaused = 1709,
    TimelockNotExpired = 1710,
    NoRollbackAvailable = 1711,
    RollbackAlreadyConsumed = 1712,
    InvalidArgument = 1713,
    ContractNotGoverned = 1714,
    TargetMismatch = 1715,
    ProposalInvalidated = 1716,
    BatchLengthMismatch = 1717,
    EmptyBatch = 1718,
    DuplicateTarget = 1719,
}

// ============================================================================
// EVENTS
// ============================================================================

#[contractevent]
pub struct UpgradeProposed {
    pub proposal_id: u64,
    pub target_contract: Address,
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
    pub target_contract: Address,
    pub new_wasm_hash: BytesN<32>,
    pub previous_wasm_hash: BytesN<32>,
}

#[contractevent]
pub struct UpgradeRolledBack {
    pub proposal_id: u64,
    pub target_contract: Address,
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

#[contractevent]
pub struct GovernedContractRegistered {
    pub target: Address,
    pub timelock_seconds: u64,
}

#[contractevent]
pub struct BatchUpgradeProposed {
    pub proposal_id: u64,
    pub target_count: u32,
    pub proposer: Address,
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
            panic_with_error!(&env, UpgradeError::AlreadyInitialized);
        }
        let count = guardians.len();
        if count < 2 || count > 3 {
            panic_with_error!(&env, UpgradeError::InvalidArgument);
        }
        for i in 0..count {
            for j in (i + 1)..count {
                if guardians.get_unchecked(i) == guardians.get_unchecked(j) {
                    panic_with_error!(&env, UpgradeError::DuplicateGuardian);
                }
            }
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Guardians, &guardians);
        env.storage().instance().set(&DataKey::GuardianCount, &(count as u32));
        env.storage().instance().set(&DataKey::UpgradesPaused, &false);
        env.storage().instance().set(&DataKey::ProposalCount, &0u64);
        let empty: Vec<Address> = vec![&env];
        env.storage().instance().set(&DataKey::GovernedList, &empty);
    }

    fn require_admin(env: &Env) {
        let admin: Address = env.storage().instance()
            .get(&DataKey::Admin).expect("not initialized");
        admin.require_auth();
    }

    fn require_initialized(env: &Env) {
        if !env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(env, UpgradeError::NotInitialized);
        }
    }

    fn require_not_paused(env: &Env) {
        let paused: bool = env.storage().instance()
            .get(&DataKey::UpgradesPaused).unwrap_or(false);
        if paused { panic_with_error!(env, UpgradeError::UpgradesPaused); }
    }

    fn is_guardian(env: &Env, addr: &Address) -> bool {
        let guardians: Vec<Address> = env.storage().instance()
            .get(&DataKey::Guardians).expect("not initialized");
        guardians.iter().any(|g| g == *addr)
    }

    fn require_governed(env: &Env, target: &Address) {
        let governed: bool = env.storage().instance()
            .get(&DataKey::Governed(target.clone())).unwrap_or(false);
        if !governed {
            panic_with_error!(env, UpgradeError::ContractNotGoverned);
        }
    }

    fn timelock_duration(env: &Env, target: &Address) -> u64 {
        if let Some(override_secs) = env.storage().instance()
            .get::<DataKey, u64>(&DataKey::ContractTimelock(target.clone()))
        {
            return override_secs;
        }
        env.storage().instance()
            .get(&DataKey::TimelockOverride)
            .unwrap_or(DEFAULT_TIMELOCK_SECONDS)
    }

    fn save_rollback_slot(env: &Env, target: &Address, wasm_hash: BytesN<32>) {
        env.storage().persistent()
            .set(&DataKey::RollbackWasmHash(target.clone()), &wasm_hash);
        env.storage().persistent()
            .set(&DataKey::RollbackConsumed(target.clone()), &false);
    }

    fn is_open_state(state: ProposalState) -> bool {
        state == ProposalState::Pending || state == ProposalState::Approved
    }

    fn next_proposal_id(env: &Env) -> u64 {
        let count: u64 = env.storage().instance()
            .get(&DataKey::ProposalCount).unwrap_or(0);
        count + 1
    }

    fn claim_or_invalidate(env: &Env, target: &Address, new_id: u64) -> ProposalState {
        let active: Option<u64> = env.storage().persistent()
            .get(&DataKey::ActiveProposal(target.clone()));
        if let Some(existing_id) = active {
            if let Some(existing) = env.storage().persistent()
                .get::<DataKey, UpgradeProposal>(&DataKey::Proposal(existing_id))
            {
                if Self::is_open_state(existing.state) && existing_id != new_id {
                    return ProposalState::Invalidated;
                }
            }
            if let Some(existing) = env.storage().persistent()
                .get::<DataKey, BatchUpgradeProposal>(&DataKey::BatchProposal(existing_id))
            {
                if Self::is_open_state(existing.state) && existing_id != new_id {
                    return ProposalState::Invalidated;
                }
            }
        }
        env.storage().persistent()
            .set(&DataKey::ActiveProposal(target.clone()), &new_id);
        ProposalState::Pending
    }

    fn clear_active_if_matches(env: &Env, target: &Address, proposal_id: u64) {
        let active: Option<u64> = env.storage().persistent()
            .get(&DataKey::ActiveProposal(target.clone()));
        if active == Some(proposal_id) {
            env.storage().persistent()
                .remove(&DataKey::ActiveProposal(target.clone()));
        }
    }
}

// ============================================================================
// CONTRACT — Guardian Management, Registry & Proposal
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
        Self::require_not_paused(&env);
        let count = new_guardians.len();
        if count < 2 || count > 3 { panic_with_error!(&env, UpgradeError::InvalidArgument); }
        for i in 0..count {
            for j in (i + 1)..count {
                if new_guardians.get_unchecked(i) == new_guardians.get_unchecked(j) {
                    panic_with_error!(&env, UpgradeError::DuplicateGuardian);
                }
            }
        }
        env.storage().instance().set(&DataKey::Guardians, &new_guardians);
        env.storage().instance().set(&DataKey::GuardianCount, &(count as u32));
        GuardianSetChanged { guardians: new_guardians }.publish(&env);
    }

    /// Register a contract that this governance instance is allowed to upgrade.
    /// `timelock_seconds` of 0 uses the global default; otherwise it must be >= 3600.
    pub fn register_governed_contract(env: Env, target: Address, timelock_seconds: u64) {
        Self::require_admin(&env);
        if timelock_seconds > 0 && timelock_seconds < 3600 {
            panic_with_error!(&env, UpgradeError::InvalidArgument);
        }
        env.storage().instance().set(&DataKey::Governed(target.clone()), &true);
        if timelock_seconds >= 3600 {
            env.storage().instance()
                .set(&DataKey::ContractTimelock(target.clone()), &timelock_seconds);
        }
        let mut list: Vec<Address> = env.storage().instance()
            .get(&DataKey::GovernedList).unwrap_or(vec![&env]);
        if !list.iter().any(|a| a == target) {
            list.push_back(target.clone());
            env.storage().instance().set(&DataKey::GovernedList, &list);
        }
        GovernedContractRegistered { target, timelock_seconds }.publish(&env);
    }

    pub fn unregister_governed_contract(env: Env, target: Address) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::Governed(target.clone()), &false);
        let list: Vec<Address> = env.storage().instance()
            .get(&DataKey::GovernedList).unwrap_or(vec![&env]);
        let mut next: Vec<Address> = vec![&env];
        for addr in list.iter() {
            if addr != target {
                next.push_back(addr);
            }
        }
        env.storage().instance().set(&DataKey::GovernedList, &next);
    }

    pub fn get_governed_contracts(env: Env) -> Vec<Address> {
        Self::require_initialized(&env);
        env.storage().instance()
            .get(&DataKey::GovernedList).unwrap_or(vec![&env])
    }

    pub fn is_governed(env: Env, target: Address) -> bool {
        Self::require_initialized(&env);
        env.storage().instance()
            .get(&DataKey::Governed(target)).unwrap_or(false)
    }

    pub fn set_contract_timelock(env: Env, target: Address, duration_seconds: u64) {
        Self::require_admin(&env);
        Self::require_governed(&env, &target);
        if duration_seconds < 3600 {
            panic_with_error!(&env, UpgradeError::InvalidArgument);
        }
        env.storage().instance()
            .set(&DataKey::ContractTimelock(target), &duration_seconds);
    }

    pub fn get_contract_timelock(env: Env, target: Address) -> u64 {
        Self::require_initialized(&env);
        Self::timelock_duration(&env, &target)
    }

    pub fn propose_upgrade(
        env: Env,
        proposer: Address,
        target_contract: Address,
        new_wasm_hash: BytesN<32>,
        previous_wasm_hash: BytesN<32>,
        description: String,
    ) -> u64 {
        Self::require_initialized(&env);
        Self::require_not_paused(&env);
        if !Self::is_guardian(&env, &proposer) { panic_with_error!(&env, UpgradeError::NotGuardian); }
        proposer.require_auth();
        Self::require_governed(&env, &target_contract);

        let proposal_id = Self::next_proposal_id(&env);
        let now = env.ledger().timestamp();
        let state = Self::claim_or_invalidate(&env, &target_contract, proposal_id);

        let proposal = UpgradeProposal {
            id: proposal_id,
            description,
            target_contract: target_contract.clone(),
            new_wasm_hash: new_wasm_hash.clone(),
            proposer: proposer.clone(),
            state,
            created_at: now,
            approved_at: 0,
            executable_at: 0,
            previous_wasm_hash,
        };

        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
        env.storage().instance().set(&DataKey::ProposalCount, &proposal_id);
        let empty: Vec<Address> = vec![&env];
        env.storage().persistent().set(&DataKey::ApprovedBy(proposal_id), &empty);

        UpgradeProposed {
            proposal_id,
            target_contract,
            new_wasm_hash,
            proposer,
        }.publish(&env);

        proposal_id
    }

    /// Propose an atomic multi-target upgrade. Execution is all-or-nothing.
    pub fn propose_batch_upgrade(
        env: Env,
        proposer: Address,
        targets: Vec<Address>,
        new_wasm_hashes: Vec<BytesN<32>>,
        previous_wasm_hashes: Vec<BytesN<32>>,
        description: String,
    ) -> u64 {
        Self::require_initialized(&env);
        Self::require_not_paused(&env);
        if !Self::is_guardian(&env, &proposer) { panic_with_error!(&env, UpgradeError::NotGuardian); }
        proposer.require_auth();

        let n = targets.len();
        if n == 0 {
            panic_with_error!(&env, UpgradeError::EmptyBatch);
        }
        if n != new_wasm_hashes.len() || n != previous_wasm_hashes.len() {
            panic_with_error!(&env, UpgradeError::BatchLengthMismatch);
        }
        for i in 0..n {
            let t = targets.get_unchecked(i);
            Self::require_governed(&env, &t);
            for j in (i + 1)..n {
                if t == targets.get_unchecked(j) {
                    panic_with_error!(&env, UpgradeError::DuplicateTarget);
                }
            }
        }

        let proposal_id = Self::next_proposal_id(&env);
        let now = env.ledger().timestamp();

        let mut state = ProposalState::Pending;
        for t in targets.iter() {
            if Self::claim_or_invalidate(&env, &t, proposal_id) == ProposalState::Invalidated {
                state = ProposalState::Invalidated;
            }
        }
        // If any target already had an open proposal, do not claim the others.
        if state == ProposalState::Invalidated {
            for t in targets.iter() {
                Self::clear_active_if_matches(&env, &t, proposal_id);
            }
        }

        let proposal = BatchUpgradeProposal {
            id: proposal_id,
            description,
            targets: targets.clone(),
            new_wasm_hashes,
            previous_wasm_hashes,
            proposer: proposer.clone(),
            state,
            created_at: now,
            approved_at: 0,
            executable_at: 0,
        };

        env.storage().persistent().set(&DataKey::BatchProposal(proposal_id), &proposal);
        env.storage().instance().set(&DataKey::ProposalCount, &proposal_id);
        let empty: Vec<Address> = vec![&env];
        env.storage().persistent().set(&DataKey::ApprovedBy(proposal_id), &empty);

        BatchUpgradeProposed {
            proposal_id,
            target_count: n,
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
        if !Self::is_guardian(&env, &guardian) { panic_with_error!(&env, UpgradeError::NotGuardian); }
        guardian.require_auth();

        let single: Option<UpgradeProposal> = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id));
        let batch: Option<BatchUpgradeProposal> = env.storage().persistent()
            .get(&DataKey::BatchProposal(proposal_id));

        if single.is_none() && batch.is_none() {
            panic_with_error!(&env, UpgradeError::ProposalNotFound);
        }

        let current_state = if let Some(ref p) = single { p.state } else { batch.as_ref().unwrap().state };
        if current_state == ProposalState::Invalidated {
            panic_with_error!(&env, UpgradeError::ProposalInvalidated);
        }
        if current_state != ProposalState::Pending {
            panic_with_error!(&env, UpgradeError::InvalidStateTransition);
        }

        let mut approved_by: Vec<Address> = env.storage().persistent()
            .get(&DataKey::ApprovedBy(proposal_id)).expect("approved list not found");
        if approved_by.iter().any(|a| a == guardian) {
            panic_with_error!(&env, UpgradeError::AlreadyApprovedBySigner);
        }

        approved_by.push_back(guardian.clone());
        env.storage().persistent().set(&DataKey::ApprovedBy(proposal_id), &approved_by);
        let approvals_count = approved_by.len() as u32;

        if approvals_count >= REQUIRED_APPROVALS {
            let now = env.ledger().timestamp();
            if let Some(mut proposal) = single {
                let timelock = Self::timelock_duration(&env, &proposal.target_contract);
                proposal.state = ProposalState::Approved;
                proposal.approved_at = now;
                proposal.executable_at = now + timelock;
                env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
                UpgradeReady { proposal_id, executable_at: proposal.executable_at }.publish(&env);
            } else if let Some(mut proposal) = batch {
                // Batch timelock is the max of the per-target timelocks.
                let mut timelock = 0u64;
                for t in proposal.targets.iter() {
                    let d = Self::timelock_duration(&env, &t);
                    if d > timelock { timelock = d; }
                }
                proposal.state = ProposalState::Approved;
                proposal.approved_at = now;
                proposal.executable_at = now + timelock;
                env.storage().persistent().set(&DataKey::BatchProposal(proposal_id), &proposal);
                UpgradeReady { proposal_id, executable_at: proposal.executable_at }.publish(&env);
            }
        }

        UpgradeApproved { proposal_id, approved_by: guardian, approvals_count }.publish(&env);
    }

    /// Execute an approved upgrade after the timelock has expired.
    /// `target_contract` must match the proposal; rollback is stored per target.
    pub fn execute_upgrade(
        env: Env,
        proposal_id: u64,
        executor: Address,
        target_contract: Address,
        new_wasm_hash: BytesN<32>,
    ) {
        Self::require_initialized(&env);
        Self::require_not_paused(&env);
        if !Self::is_guardian(&env, &executor) {
            let admin: Address = env.storage().instance()
                .get(&DataKey::Admin).expect("not initialized");
            if executor != admin { panic_with_error!(&env, UpgradeError::Unauthorized); }
        }
        executor.require_auth();

        let mut proposal: UpgradeProposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id)).expect("proposal not found");
        if proposal.state == ProposalState::Invalidated {
            panic_with_error!(&env, UpgradeError::ProposalInvalidated);
        }
        if proposal.state != ProposalState::Approved {
            panic_with_error!(&env, UpgradeError::InvalidStateTransition);
        }
        if proposal.target_contract != target_contract {
            panic_with_error!(&env, UpgradeError::TargetMismatch);
        }
        if proposal.new_wasm_hash != new_wasm_hash {
            panic_with_error!(&env, UpgradeError::InvalidArgument);
        }
        let now = env.ledger().timestamp();
        if now < proposal.executable_at {
            panic_with_error!(&env, UpgradeError::TimelockNotExpired);
        }

        Self::save_rollback_slot(&env, &target_contract, proposal.previous_wasm_hash.clone());

        proposal.state = ProposalState::Executed;
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
        Self::clear_active_if_matches(&env, &target_contract, proposal_id);

        UpgradeExecuted {
            proposal_id,
            target_contract,
            new_wasm_hash,
            previous_wasm_hash: proposal.previous_wasm_hash.clone(),
        }.publish(&env);
    }

    /// Execute a batch proposal. Either every target is upgraded or none are.
    /// All validation runs before any rollback slot is written.
    pub fn execute_batch_upgrade(env: Env, proposal_id: u64, executor: Address) {
        Self::require_initialized(&env);
        Self::require_not_paused(&env);
        if !Self::is_guardian(&env, &executor) {
            let admin: Address = env.storage().instance()
                .get(&DataKey::Admin).expect("not initialized");
            if executor != admin { panic_with_error!(&env, UpgradeError::Unauthorized); }
        }
        executor.require_auth();

        let mut proposal: BatchUpgradeProposal = env.storage().persistent()
            .get(&DataKey::BatchProposal(proposal_id)).expect("proposal not found");
        if proposal.state == ProposalState::Invalidated {
            panic_with_error!(&env, UpgradeError::ProposalInvalidated);
        }
        if proposal.state != ProposalState::Approved {
            panic_with_error!(&env, UpgradeError::InvalidStateTransition);
        }
        let now = env.ledger().timestamp();
        if now < proposal.executable_at {
            panic_with_error!(&env, UpgradeError::TimelockNotExpired);
        }

        // VALIDATE ALL before mutating ANY — all-or-nothing.
        let n = proposal.targets.len();
        for i in 0..n {
            let target = proposal.targets.get_unchecked(i);
            Self::require_governed(&env, &target);
            let active: Option<u64> = env.storage().persistent()
                .get(&DataKey::ActiveProposal(target.clone()));
            if let Some(aid) = active {
                if aid != proposal_id {
                    panic_with_error!(&env, UpgradeError::ProposalInvalidated);
                }
            }
        }

        // APPLY ALL
        for i in 0..n {
            let target = proposal.targets.get_unchecked(i);
            let prev = proposal.previous_wasm_hashes.get_unchecked(i);
            let new_hash = proposal.new_wasm_hashes.get_unchecked(i);
            Self::save_rollback_slot(&env, &target, prev.clone());
            Self::clear_active_if_matches(&env, &target, proposal_id);
            UpgradeExecuted {
                proposal_id,
                target_contract: target.clone(),
                new_wasm_hash: new_hash.clone(),
                previous_wasm_hash: prev,
            }.publish(&env);
        }

        proposal.state = ProposalState::Executed;
        env.storage().persistent().set(&DataKey::BatchProposal(proposal_id), &proposal);
    }

    /// Rollback a single target to its previous WASM version.
    pub fn rollback_upgrade(
        env: Env,
        caller: Address,
        target_contract: Address,
        previous_wasm_hash: BytesN<32>,
    ) {
        Self::require_initialized(&env);
        Self::require_not_paused(&env);
        let is_admin = {
            let admin: Address = env.storage().instance()
                .get(&DataKey::Admin).expect("not initialized");
            caller == admin
        };
        if !is_admin && !Self::is_guardian(&env, &caller) {
            panic_with_error!(&env, UpgradeError::Unauthorized);
        }
        caller.require_auth();

        let consumed: bool = env.storage().persistent()
            .get(&DataKey::RollbackConsumed(target_contract.clone())).unwrap_or(true);
        if consumed {
            panic_with_error!(&env, UpgradeError::RollbackAlreadyConsumed);
        }

        let stored_hash: BytesN<32> = match env.storage().persistent()
            .get(&DataKey::RollbackWasmHash(target_contract.clone()))
        {
            Some(h) => h,
            None => panic_with_error!(&env, UpgradeError::NoRollbackAvailable),
        };
        if stored_hash != previous_wasm_hash {
            panic_with_error!(&env, UpgradeError::InvalidArgument);
        }

        env.storage().persistent()
            .set(&DataKey::RollbackConsumed(target_contract.clone()), &true);

        UpgradeRolledBack {
            proposal_id: 0,
            target_contract,
            restored_wasm_hash: previous_wasm_hash,
        }.publish(&env);
    }

    pub fn cancel_proposal(env: Env, proposal_id: u64) {
        Self::require_admin(&env);
        if let Some(mut proposal) = env.storage().persistent()
            .get::<DataKey, UpgradeProposal>(&DataKey::Proposal(proposal_id))
        {
            if proposal.state == ProposalState::Executed
                || proposal.state == ProposalState::Cancelled
                || proposal.state == ProposalState::RolledBack {
                panic_with_error!(&env, UpgradeError::InvalidStateTransition);
            }
            let target = proposal.target_contract.clone();
            proposal.state = ProposalState::Cancelled;
            env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
            Self::clear_active_if_matches(&env, &target, proposal_id);
            UpgradeCancelled { proposal_id, cancelled_by: env.current_contract_address() }.publish(&env);
            return;
        }
        if let Some(mut proposal) = env.storage().persistent()
            .get::<DataKey, BatchUpgradeProposal>(&DataKey::BatchProposal(proposal_id))
        {
            if proposal.state == ProposalState::Executed
                || proposal.state == ProposalState::Cancelled
                || proposal.state == ProposalState::RolledBack {
                panic_with_error!(&env, UpgradeError::InvalidStateTransition);
            }
            let targets = proposal.targets.clone();
            proposal.state = ProposalState::Cancelled;
            env.storage().persistent().set(&DataKey::BatchProposal(proposal_id), &proposal);
            for t in targets.iter() {
                Self::clear_active_if_matches(&env, &t, proposal_id);
            }
            UpgradeCancelled { proposal_id, cancelled_by: env.current_contract_address() }.publish(&env);
            return;
        }
        panic_with_error!(&env, UpgradeError::ProposalNotFound);
    }

    pub fn set_timelock(env: Env, duration_seconds: u64) {
        Self::require_admin(&env);
        if duration_seconds < 3600 { panic_with_error!(&env, UpgradeError::InvalidArgument); }
        env.storage().instance().set(&DataKey::TimelockOverride, &duration_seconds);
    }

    pub fn get_timelock(env: Env) -> u64 {
        Self::require_initialized(&env);
        env.storage().instance()
            .get(&DataKey::TimelockOverride)
            .unwrap_or(DEFAULT_TIMELOCK_SECONDS)
    }

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

    pub fn get_batch_proposal(env: Env, proposal_id: u64) -> BatchUpgradeProposal {
        env.storage().persistent()
            .get(&DataKey::BatchProposal(proposal_id)).expect("proposal not found")
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

    pub fn get_rollback_wasm_hash(env: Env, target: Address) -> Option<BytesN<32>> {
        env.storage().persistent().get(&DataKey::RollbackWasmHash(target))
    }

    pub fn is_rollback_available(env: Env, target: Address) -> bool {
        let consumed: bool = env.storage().persistent()
            .get(&DataKey::RollbackConsumed(target.clone())).unwrap_or(true);
        let has_hash: bool = env.storage().persistent()
            .has(&DataKey::RollbackWasmHash(target));
        !consumed && has_hash
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
