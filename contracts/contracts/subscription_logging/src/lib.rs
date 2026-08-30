#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, vec, Address, Bytes,
    BytesN, Env, String, Vec,
};

mod commitment;

/// Maximum plaintext log entries retained on-chain per subscription.
/// Older entries must be anchored and pruned to off-chain archival storage.
pub const MAX_LOGS_IN_STORAGE: u32 = 100;

/// Maximum entries returned by a single paginated `get_logs` query.
pub const MAX_LOGS_PAGE_SIZE: u32 = 50;

// ============================================================================
// LEGACY TYPES (Preserved for backward compatibility)
// ============================================================================

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LogEvent {
    Reminder,
    Approval,
    Renewal,
    Failure,
    Retry,
    Cancellation,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LogEntry {
    pub sub_id: u64,
    pub event: LogEvent,
    pub timestamp: u64,
    pub data: String,
}

// ============================================================================
// PRIVACY-PRESERVING COMMITMENT TYPES
// ============================================================================

/// A cryptographic commitment to an audit event
/// Reveals no subscription metadata on-chain
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuditCommitment {
    /// SHA-256 hash of (event_data || blinding_factor || domain_separator)
    pub commitment_hash: BytesN<32>,
    /// Ledger timestamp when commitment was recorded
    pub timestamp: u64,
    /// Monotonic index to prevent replay attacks
    pub commitment_index: u64,
}

/// Merkle root anchoring a batch of commitments
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MerkleRoot {
    /// Root hash of Merkle tree
    pub root_hash: BytesN<32>,
    /// First commitment index in batch
    pub start_index: u64,
    /// Last commitment index in batch (inclusive)
    pub end_index: u64,
    /// Timestamp when batch was anchored
    pub timestamp: u64,
}

/// Merkle root anchoring a batch of plaintext log entries for a subscription.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LogMerkleRoot {
    pub root_hash: BytesN<32>,
    pub start_index: u64,
    pub end_index: u64,
    pub timestamp: u64,
}

/// Tracks absolute log indices for a subscription's stored window.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LogWindowMeta {
    /// Absolute index of the first entry currently in storage.
    pub base_index: u64,
    /// Total number of logs ever recorded for this subscription.
    pub total_logged: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum SubscriptionLoggingError {
    LogStorageFull = 1,
    RangeNotAnchored = 2,
    InvalidPruneRange = 3,
    InvalidPagination = 4,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    // Legacy keys
    Admin,
    Logs(u64),
    LogWindowMeta(u64),
    LogMerkleRoot(u64, u64),
    LogMerkleRootCount(u64),

    // New commitment keys (no sub_id to prevent linkage)
    CommitmentCount,        // Global counter: u64
    Commitment(u64),        // commitment_index -> AuditCommitment
    MerkleRootCount,        // Number of Merkle roots anchored
    MerkleRootByIndex(u64), // root_index -> MerkleRoot
}

// ============================================================================
// CONTRACT EVENTS
// ============================================================================

#[contractevent]
pub struct LogAppended {
    pub sub_id: u64,
    pub event: LogEvent,
}

#[contractevent]
pub struct CommitmentRecorded {
    pub commitment_index: u64,
    pub commitment_hash: BytesN<32>,
}

#[contractevent]
pub struct MerkleRootAnchored {
    pub root_hash: BytesN<32>,
    pub start_index: u64,
    pub end_index: u64,
}

// ============================================================================
// CONTRACT IMPLEMENTATION
// ============================================================================

#[contract]
pub struct SubscriptionLoggingContract;

#[contractimpl]
impl SubscriptionLoggingContract {
    // ========================================================================
    // INITIALIZATION
    // ========================================================================

    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::CommitmentCount, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::MerkleRootCount, &0u64);
    }

    fn require_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
    }

    fn load_log_window(env: &Env, sub_id: u64) -> LogWindowMeta {
        env.storage()
            .persistent()
            .get(&DataKey::LogWindowMeta(sub_id))
            .unwrap_or(LogWindowMeta {
                base_index: 0,
                total_logged: 0,
            })
    }

    fn save_log_window(env: &Env, sub_id: u64, meta: &LogWindowMeta) {
        env.storage()
            .persistent()
            .set(&DataKey::LogWindowMeta(sub_id), meta);
    }

    fn log_is_anchored(env: &Env, sub_id: u64, up_to_index: u64) -> bool {
        let root_count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::LogMerkleRootCount(sub_id))
            .unwrap_or(0);

        for root_idx in 0..root_count {
            if let Some(root) = env
                .storage()
                .persistent()
                .get::<_, LogMerkleRoot>(&DataKey::LogMerkleRoot(sub_id, root_idx))
            {
                if root.start_index <= up_to_index && root.end_index >= up_to_index {
                    return true;
                }
            }
        }
        false
    }

    fn compute_merkle_root_from_proof(
        env: &Env,
        leaf_hash: BytesN<32>,
        proof_path: Vec<BytesN<32>>,
        proof_directions: Vec<bool>,
    ) -> BytesN<32> {
        let mut current_hash = leaf_hash;
        for i in 0..proof_path.len() {
            let sibling = proof_path.get_unchecked(i);
            let is_right = proof_directions.get_unchecked(i);

            let combined = if is_right {
                let mut bytes = Bytes::new(env);
                bytes.extend_from_slice(&current_hash.to_array());
                bytes.extend_from_slice(&sibling.to_array());
                bytes
            } else {
                let mut bytes = Bytes::new(env);
                bytes.extend_from_slice(&sibling.to_array());
                bytes.extend_from_slice(&current_hash.to_array());
                bytes
            };

            current_hash = env.crypto().sha256(&combined).into();
        }
        current_hash
    }

    // ========================================================================
    // LEGACY PLAINTEXT LOGGING (Deprecated, kept for backward compatibility)
    // ========================================================================

    pub fn record_log(env: Env, sub_id: u64, event: LogEvent, data: String) {
        Self::require_admin(&env);

        let key = DataKey::Logs(sub_id);
        let mut logs: Vec<LogEntry> = env.storage().persistent().get(&key).unwrap_or(vec![&env]);

        if logs.len() >= MAX_LOGS_IN_STORAGE as u32 {
            panic!("Log storage full: anchor and prune before recording more entries");
        }

        let mut meta = Self::load_log_window(&env, sub_id);
        let entry = LogEntry {
            sub_id,
            event: event.clone(),
            timestamp: env.ledger().timestamp(),
            data,
        };

        logs.push_back(entry);
        meta.total_logged = meta
            .total_logged
            .checked_add(1)
            .expect("log index overflow");

        env.storage().persistent().set(&key, &logs);
        Self::save_log_window(&env, sub_id, &meta);

        LogAppended {
            sub_id,
            event,
        }
        .publish(&env);
    }

    /// Return a paginated slice of stored logs for a subscription.
    ///
    /// `offset` is relative to the current in-storage window (0 = oldest stored entry).
    /// At most [`MAX_LOGS_PAGE_SIZE`] entries are returned per call.
    pub fn get_logs(env: Env, sub_id: u64, offset: u32, limit: u32) -> Vec<LogEntry> {
        if limit == 0 || limit > MAX_LOGS_PAGE_SIZE {
            panic!("Invalid pagination limit");
        }

        let key = DataKey::Logs(sub_id);
        let logs: Vec<LogEntry> = env.storage().persistent().get(&key).unwrap_or(vec![&env]);

        if offset as u64 >= logs.len() as u64 {
            return vec![&env];
        }

        let mut results = vec![&env];
        let end = core::cmp::min(logs.len(), offset + limit);
        for i in offset..end {
            results.push_back(logs.get(i).unwrap());
        }
        results
    }

    /// Total number of log entries ever recorded for a subscription.
    pub fn get_log_count(env: Env, sub_id: u64) -> u64 {
        Self::load_log_window(&env, sub_id).total_logged
    }

    /// Anchor a Merkle root over a range of log indices for a subscription.
    pub fn anchor_log_merkle_root(
        env: Env,
        sub_id: u64,
        root_hash: BytesN<32>,
        start_index: u64,
        end_index: u64,
    ) {
        Self::require_admin(&env);

        if end_index < start_index {
            panic!("Invalid range: end_index must be >= start_index");
        }

        let meta = Self::load_log_window(&env, sub_id);
        if end_index >= meta.total_logged {
            panic!("end_index exceeds log count");
        }

        let root_count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::LogMerkleRootCount(sub_id))
            .unwrap_or(0);

        let merkle_root = LogMerkleRoot {
            root_hash: root_hash.clone(),
            start_index,
            end_index,
            timestamp: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::LogMerkleRoot(sub_id, root_count), &merkle_root);
        env.storage()
            .instance()
            .set(&DataKey::LogMerkleRootCount(sub_id), &(root_count + 1));
    }

    /// Remove stored logs with absolute indices `base_index..=up_to_index`.
    /// Requires the range to be covered by an anchored log Merkle root.
    pub fn prune_logs(env: Env, sub_id: u64, up_to_index: u64) {
        Self::require_admin(&env);

        let mut meta = Self::load_log_window(&env, sub_id);
        if up_to_index < meta.base_index {
            panic!("Invalid prune range");
        }

        if !Self::log_is_anchored(&env, sub_id, up_to_index) {
            panic!("Range not covered by anchored Merkle root");
        }

        let key = DataKey::Logs(sub_id);
        let logs: Vec<LogEntry> = env.storage().persistent().get(&key).unwrap_or(vec![&env]);

        let prune_count = up_to_index
            .saturating_sub(meta.base_index)
            .saturating_add(1) as u32;
        if prune_count as u64 > logs.len() as u64 {
            panic!("Invalid prune range");
        }

        let mut remaining = vec![&env];
        for i in prune_count..logs.len() {
            remaining.push_back(logs.get(i).unwrap());
        }

        meta.base_index = up_to_index.saturating_add(1);
        env.storage().persistent().set(&key, &remaining);
        Self::save_log_window(&env, sub_id, &meta);
    }

    /// Verify a (possibly pruned) log entry against an anchored log Merkle root
    /// using the leaf hash supplied from off-chain archival storage.
    pub fn verify_log_merkle_membership(
        env: Env,
        sub_id: u64,
        leaf_hash: BytesN<32>,
        log_index: u64,
        root_index: u64,
        proof_path: Vec<BytesN<32>>,
        proof_directions: Vec<bool>,
    ) -> bool {
        if proof_path.len() != proof_directions.len() {
            return false;
        }

        let merkle_root: LogMerkleRoot = match env
            .storage()
            .persistent()
            .get(&DataKey::LogMerkleRoot(sub_id, root_index))
        {
            Some(r) => r,
            None => return false,
        };

        if log_index < merkle_root.start_index || log_index > merkle_root.end_index {
            return false;
        }

        let computed = Self::compute_merkle_root_from_proof(
            &env,
            leaf_hash,
            proof_path,
            proof_directions,
        );
        computed == merkle_root.root_hash
    }

    // ========================================================================
    // PRIVACY-PRESERVING COMMITMENT FUNCTIONS
    // ========================================================================

    /// Record a cryptographic commitment to an audit event
    ///
    /// # Arguments
    /// * `commitment_hash` - SHA-256(event_data || blinding_factor || domain_separator)
    ///
    /// # Returns
    /// * `commitment_index` - Unique monotonic index for this commitment
    ///
    /// # Privacy
    /// No subscription metadata is stored on-chain. The commitment reveals
    /// nothing about the underlying event without the blinding factor.
    pub fn record_commitment(env: Env, commitment_hash: BytesN<32>) -> u64 {
        Self::require_admin(&env);

        // Get and increment commitment counter
        let commitment_index: u64 = env
            .storage()
            .instance()
            .get(&DataKey::CommitmentCount)
            .unwrap_or(0);

        let next_index = commitment_index
            .checked_add(1)
            .expect("commitment index overflow");
        env.storage()
            .instance()
            .set(&DataKey::CommitmentCount, &next_index);

        // Create commitment record
        let commitment = AuditCommitment {
            commitment_hash: commitment_hash.clone(),
            timestamp: env.ledger().timestamp(),
            commitment_index,
        };

        // Store commitment
        env.storage()
            .persistent()
            .set(&DataKey::Commitment(commitment_index), &commitment);

        // Emit event
        CommitmentRecorded {
            commitment_index,
            commitment_hash,
        }
        .publish(&env);

        commitment_index
    }

    /// Retrieve a commitment by its index
    ///
    /// # Arguments
    /// * `commitment_index` - The index of the commitment to retrieve
    ///
    /// # Returns
    /// * `Option<AuditCommitment>` - The commitment if it exists
    pub fn get_commitment(env: Env, commitment_index: u64) -> Option<AuditCommitment> {
        env.storage()
            .persistent()
            .get(&DataKey::Commitment(commitment_index))
    }

    /// Get the total number of commitments recorded
    pub fn get_commitment_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::CommitmentCount)
            .unwrap_or(0)
    }

    /// Get multiple commitments by range
    ///
    /// # Arguments
    /// * `start_index` - First commitment index (inclusive)
    /// * `end_index` - Last commitment index (inclusive)
    ///
    /// # Returns
    /// * `Vec<AuditCommitment>` - Vector of commitments in range
    ///
    /// # Limits
    /// Maximum 100 commitments per query to prevent excessive compute
    pub fn get_commitments_range(
        env: Env,
        start_index: u64,
        end_index: u64,
    ) -> Vec<AuditCommitment> {
        // Enforce reasonable limits
        let range_size = end_index.saturating_sub(start_index) + 1;
        if range_size > 100 {
            panic!("Range too large, maximum 100 commitments per query");
        }

        let mut results = vec![&env];
        for idx in start_index..=end_index {
            if let Some(commitment) = Self::get_commitment(env.clone(), idx) {
                results.push_back(commitment);
            }
        }
        results
    }

    // ========================================================================
    // MERKLE TREE BATCHING FUNCTIONS
    // ========================================================================

    /// Anchor a Merkle root representing a batch of commitments
    ///
    /// # Arguments
    /// * `root_hash` - Root hash of Merkle tree
    /// * `start_index` - First commitment index in batch
    /// * `end_index` - Last commitment index in batch (inclusive)
    ///
    /// # Privacy
    /// Batching commitments into Merkle trees hides individual commitment
    /// timing and reduces on-chain storage costs.
    pub fn anchor_merkle_root(env: Env, root_hash: BytesN<32>, start_index: u64, end_index: u64) {
        Self::require_admin(&env);

        // Validate indices
        if end_index < start_index {
            panic!("Invalid range: end_index must be >= start_index");
        }

        let commitment_count = Self::get_commitment_count(env.clone());
        if end_index >= commitment_count {
            panic!("end_index exceeds commitment count");
        }

        // Get and increment Merkle root counter
        let root_count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::MerkleRootCount)
            .unwrap_or(0);

        let next_root_count = root_count
            .checked_add(1)
            .expect("merkle root count overflow");
        env.storage()
            .instance()
            .set(&DataKey::MerkleRootCount, &next_root_count);

        // Create Merkle root record
        let merkle_root = MerkleRoot {
            root_hash: root_hash.clone(),
            start_index,
            end_index,
            timestamp: env.ledger().timestamp(),
        };

        // Store Merkle root
        env.storage()
            .persistent()
            .set(&DataKey::MerkleRootByIndex(root_count), &merkle_root);

        // Emit event
        MerkleRootAnchored {
            root_hash,
            start_index,
            end_index,
        }
        .publish(&env);
    }

    /// Get a Merkle root by its index
    pub fn get_merkle_root(env: Env, root_index: u64) -> Option<MerkleRoot> {
        env.storage()
            .persistent()
            .get(&DataKey::MerkleRootByIndex(root_index))
    }

    /// Get the total number of Merkle roots anchored
    pub fn get_merkle_root_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::MerkleRootCount)
            .unwrap_or(0)
    }

    /// Verify a commitment exists within a Merkle root
    ///
    /// # Arguments
    /// * `commitment_index` - Index of commitment to verify
    /// * `root_index` - Index of Merkle root
    /// * `proof_path` - Sibling hashes in Merkle path
    /// * `proof_directions` - Left (false) or right (true) at each level
    ///
    /// # Returns
    /// * `bool` - True if commitment is in the Merkle tree
    pub fn verify_merkle_membership(
        env: Env,
        commitment_index: u64,
        root_index: u64,
        proof_path: Vec<BytesN<32>>,
        proof_directions: Vec<bool>,
    ) -> bool {
        // Get commitment
        let commitment = match Self::get_commitment(env.clone(), commitment_index) {
            Some(c) => c,
            None => return false,
        };

        // Get Merkle root
        let merkle_root = match Self::get_merkle_root(env.clone(), root_index) {
            Some(r) => r,
            None => return false,
        };

        // Verify commitment is in range
        if commitment_index < merkle_root.start_index || commitment_index > merkle_root.end_index {
            return false;
        }

        // Verify proof path length matches directions length
        if proof_path.len() != proof_directions.len() {
            return false;
        }

        // Compute root from proof
        let computed = Self::compute_merkle_root_from_proof(
            &env,
            commitment.commitment_hash,
            proof_path,
            proof_directions,
        );

        computed == merkle_root.root_hash
    }
}

#[cfg(test)]
mod test;
