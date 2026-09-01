//! Admin Multisig Module
//! Implements a 2-of-M guardian multisig pattern for destructive contract operations.
//! Non-destructive operations have a fast single-signer path.

use soroban_sdk::{
    contract, contractevent, contracttype, vec, Address, Env, Vec,
    panic_with_error,
};

/// Storage keys for multisig admin state
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AdminKey {
    /// Single admin address (legacy, used for fast non-destructive ops)
    SingleAdmin,
    /// Set of guardian addresses (for destructive ops requiring multisig)
    Guardians,
    /// Number of guardians
    GuardianCount,
    /// Multisig proposal ID counter
    ProposalCount,
    /// Proposal data storage: proposal_id -> AdminProposal
    Proposal(u64),
    /// Approvals per proposal: proposal_id -> Vec<Address>
    ApprovedBy(u64),
    /// Has this contract migrated to multisig? (for migrate_admin_to_multisig)
    HasMigrated,
}

/// Enumeration of destructive admin operations that require multisig approval
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AdminOperation {
    /// Pause or unpause all renewal execution
    SetPaused,
    /// Change global spending cap for a user
    SetUserCap,
    /// Change guardian set
    SetGuardians,
    /// Update logging contract (cross-contract calls, can be high-risk)
    SetLoggingContract,
    /// Update token contract (affects fund transfers)
    SetTokenContract,
    /// Record audit log (can be used to forge records)
    RecordLog,
}

/// Represents a proposed admin action awaiting multisig approval
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminProposal {
    pub id: u64,
    pub operation: AdminOperation,
    pub proposer: Address,
    pub state: ProposalState,
    pub created_at: u64,
    pub approved_at: u64,
    /// Encoded operation data (varies by operation type)
    pub data: Vec<u8>,
}

/// State machine for proposal lifecycle
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProposalState {
    Pending,
    Approved,
    Executed,
    Cancelled,
}

#[contractevent]
pub struct AdminProposalCreated {
    pub proposal_id: u64,
    pub operation: AdminOperation,
    pub proposer: Address,
}

#[contractevent]
pub struct AdminProposalApproved {
    pub proposal_id: u64,
    pub approved_by: Address,
    pub approvals_count: u32,
}

#[contractevent]
pub struct AdminProposalExecuted {
    pub proposal_id: u64,
    pub operation: AdminOperation,
}

#[contractevent]
pub struct GuardianSetChanged {
    pub guardians: Vec<Address>,
    pub threshold: u32,
}

/// Required approvals (2-of-M threshold, where M is guardian count)
pub const REQUIRED_APPROVALS: u32 = 2;

// ============================================================================
// INITIALIZATION & MIGRATION
// ============================================================================

/// Initialize contract with a single admin (backward compatible).
/// Call this once during deployment.
pub fn init_admin(env: &Env, admin: Address) {
    if env.storage().instance().has(&AdminKey::SingleAdmin) {
        panic!("Admin already initialized");
    }
    env.storage().instance().set(&AdminKey::SingleAdmin, &admin);
    env.storage().instance().set(&AdminKey::HasMigrated, &false);
}

/// Migrate from single-admin to multisig guardian governance.
/// Can only be called once. After this, all destructive ops require multisig.
///
/// # Arguments
/// * `env` - Soroban environment
/// * `guardians` - Initial set of guardian addresses (2-3 recommended)
///
/// # Behavior
/// - Requires current admin authorization
/// - Clears single admin role (cannot be called again)
/// - Enables multisig mode for all future operations
pub fn migrate_admin_to_multisig(env: &Env, guardians: Vec<Address>) {
    require_single_admin(env);

    if env.storage().instance().get::<_, bool>(&AdminKey::HasMigrated).unwrap_or(false) {
        panic!("Already migrated to multisig");
    }

    let count = guardians.len() as u32;
    if count < 2 || count > 5 {
        panic!("Guardian count must be between 2 and 5");
    }

    // Validate no duplicates
    for i in 0..(guardians.len()) {
        for j in (i + 1)..(guardians.len()) {
            if guardians.get_unchecked(i) == guardians.get_unchecked(j) {
                panic!("Duplicate guardian address");
            }
        }
    }

    // Store guardians and mark as migrated
    env.storage().instance().set(&AdminKey::Guardians, &guardians.clone());
    env.storage().instance().set(&AdminKey::GuardianCount, &count);
    env.storage().instance().set(&AdminKey::ProposalCount, &0u64);
    env.storage().instance().set(&AdminKey::HasMigrated, &true);

    // Clear single admin (cannot go back)
    env.storage().instance().remove(&AdminKey::SingleAdmin);
}

// ============================================================================
// AUTHORIZATION HELPERS
// ============================================================================

/// Check if contract is in multisig mode
pub fn is_multisig_enabled(env: &Env) -> bool {
    env.storage().instance().get::<_, bool>(&AdminKey::HasMigrated).unwrap_or(false)
}

/// Require authorization from single admin (only valid before migration)
pub fn require_single_admin(env: &Env) {
    if is_multisig_enabled(env) {
        panic!("Contract has migrated to multisig governance");
    }
    let admin: Address = env
        .storage()
        .instance()
        .get(&AdminKey::SingleAdmin)
        .expect("Admin not initialized");
    admin.require_auth();
}

/// Check if address is a guardian
pub fn is_guardian(env: &Env, addr: &Address) -> bool {
    let guardians: Vec<Address> = env
        .storage()
        .instance()
        .get(&AdminKey::Guardians)
        .unwrap_or_else(|_| vec![env]);
    guardians.iter().any(|g| g == addr)
}

/// Get all current guardians
pub fn get_guardians(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&AdminKey::Guardians)
        .unwrap_or_else(|_| vec![env])
}

// ============================================================================
// PROPOSAL MANAGEMENT
// ============================================================================

/// Propose a destructive admin operation for multisig approval
pub fn propose_admin_operation(
    env: &Env,
    proposer: Address,
    operation: AdminOperation,
    data: Vec<u8>,
) -> u64 {
    if !is_multisig_enabled(env) {
        panic!("Multisig not enabled; use single admin path");
    }
    if !is_guardian(env, &proposer) {
        panic!("Only guardians can propose operations");
    }
    proposer.require_auth();

    let proposal_count: u64 = env
        .storage()
        .instance()
        .get(&AdminKey::ProposalCount)
        .unwrap_or(0);
    let proposal_id = proposal_count + 1;
    let now = env.ledger().timestamp();

    let proposal = AdminProposal {
        id: proposal_id,
        operation,
        proposer: proposer.clone(),
        state: ProposalState::Pending,
        created_at: now,
        approved_at: 0,
        data,
    };

    env.storage()
        .persistent()
        .set(&AdminKey::Proposal(proposal_id), &proposal);
    env.storage()
        .instance()
        .set(&AdminKey::ProposalCount, &proposal_id);

    // Initialize empty approval list
    let empty: Vec<Address> = vec![env];
    env.storage()
        .persistent()
        .set(&AdminKey::ApprovedBy(proposal_id), &empty);

    AdminProposalCreated {
        proposal_id,
        operation,
        proposer,
    }
    .publish(env);

    proposal_id
}

/// Approve a pending proposal (guardian only)
/// When REQUIRED_APPROVALS is reached, proposal transitions to Approved
pub fn approve_proposal(env: &Env, proposal_id: u64, guardian: Address) {
    if !is_guardian(env, &guardian) {
        panic!("Only guardians can approve proposals");
    }
    guardian.require_auth();

    let mut proposal: AdminProposal = env
        .storage()
        .persistent()
        .get(&AdminKey::Proposal(proposal_id))
        .expect("Proposal not found");

    if proposal.state != ProposalState::Pending {
        panic!("Proposal is not in Pending state");
    }

    let mut approved_by: Vec<Address> = env
        .storage()
        .persistent()
        .get(&AdminKey::ApprovedBy(proposal_id))
        .expect("Approval list not found");

    if approved_by.iter().any(|a| a == guardian) {
        panic!("Guardian has already approved this proposal");
    }

    approved_by.push_back(guardian.clone());
    let approvals_count = approved_by.len() as u32;

    if approvals_count >= REQUIRED_APPROVALS {
        proposal.state = ProposalState::Approved;
        proposal.approved_at = env.ledger().timestamp();
    }

    env.storage()
        .persistent()
        .set(&AdminKey::ApprovedBy(proposal_id), &approved_by);
    env.storage()
        .persistent()
        .set(&AdminKey::Proposal(proposal_id), &proposal);

    AdminProposalApproved {
        proposal_id,
        approved_by: guardian,
        approvals_count,
    }
    .publish(env);
}

/// Execute an approved proposal
pub fn execute_proposal(env: &Env, proposal_id: u64) -> AdminProposal {
    let mut proposal: AdminProposal = env
        .storage()
        .persistent()
        .get(&AdminKey::Proposal(proposal_id))
        .expect("Proposal not found");

    if proposal.state != ProposalState::Approved {
        panic!("Proposal must be in Approved state to execute");
    }

    proposal.state = ProposalState::Executed;
    env.storage()
        .persistent()
        .set(&AdminKey::Proposal(proposal_id), &proposal.clone());

    AdminProposalExecuted {
        proposal_id,
        operation: proposal.operation,
    }
    .publish(env);

    proposal
}

/// Get a specific proposal
pub fn get_proposal(env: &Env, proposal_id: u64) -> Option<AdminProposal> {
    env.storage()
        .persistent()
        .get(&AdminKey::Proposal(proposal_id))
        .ok()
}

/// Get approvals for a proposal
pub fn get_proposal_approvals(env: &Env, proposal_id: u64) -> Vec<Address> {
    env.storage()
        .persistent()
        .get(&AdminKey::ApprovedBy(proposal_id))
        .unwrap_or_else(|_| vec![env])
}

/// Cancel a pending proposal (any guardian)
pub fn cancel_proposal(env: &Env, proposal_id: u64, guardian: Address) {
    if !is_guardian(env, &guardian) {
        panic!("Only guardians can cancel proposals");
    }
    guardian.require_auth();

    let mut proposal: AdminProposal = env
        .storage()
        .persistent()
        .get(&AdminKey::Proposal(proposal_id))
        .expect("Proposal not found");

    if proposal.state != ProposalState::Pending {
        panic!("Only pending proposals can be cancelled");
    }

    proposal.state = ProposalState::Cancelled;
    env.storage()
        .persistent()
        .set(&AdminKey::Proposal(proposal_id), &proposal);
}

// ============================================================================
// GUARDIAN SET MANAGEMENT
// ============================================================================

/// Propose a change to the guardian set
/// This itself is a destructive operation and requires multisig approval
pub fn propose_guardian_change(
    env: &Env,
    proposer: Address,
    new_guardians: Vec<Address>,
) -> u64 {
    let count = new_guardians.len() as u32;
    if count < 2 || count > 5 {
        panic!("Guardian count must be between 2 and 5");
    }

    // Validate no duplicates
    for i in 0..(new_guardians.len()) {
        for j in (i + 1)..(new_guardians.len()) {
            if new_guardians.get_unchecked(i) == new_guardians.get_unchecked(j) {
                panic!("Duplicate guardian address");
            }
        }
    }

    // Encode guardians as bytes for proposal data
    let mut data = vec![env];
    for guardian in new_guardians.iter() {
        // Serialize each address as 32 bytes
        let bytes: soroban_sdk::Bytes = guardian.clone().into_val(env).try_into().unwrap();
        for byte in bytes.iter() {
            data.push_back(byte);
        }
    }

    propose_admin_operation(env, proposer, AdminOperation::SetGuardians, data)
}

/// Execute a guardian set change after multisig approval
pub fn execute_guardian_change(env: &Env, proposal_id: u64, new_guardians: Vec<Address>) {
    let proposal = execute_proposal(env, proposal_id);

    if proposal.operation != AdminOperation::SetGuardians {
        panic!("Proposal is not a guardian change operation");
    }

    let count = new_guardians.len() as u32;
    if count < 2 || count > 5 {
        panic!("Guardian count must be between 2 and 5");
    }

    // Validate no duplicates
    for i in 0..(new_guardians.len()) {
        for j in (i + 1)..(new_guardians.len()) {
            if new_guardians.get_unchecked(i) == new_guardians.get_unchecked(j) {
                panic!("Duplicate guardian address");
            }
        }
    }

    env.storage()
        .instance()
        .set(&AdminKey::Guardians, &new_guardians.clone());
    env.storage()
        .instance()
        .set(&AdminKey::GuardianCount, &count);

    GuardianSetChanged {
        guardians: new_guardians,
        threshold: REQUIRED_APPROVALS,
    }
    .publish(env);
}
