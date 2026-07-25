#![no_std]

use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, vec, Address, Bytes, BytesN, Env, String,
    Vec,
};

mod commitment;

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

#[contracttype]
#[derive(Clone)]
enum DataKey {
    // Legacy keys
    Admin,
    Logs(u64),

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

    // ========================================================================
    // LEGACY PLAINTEXT LOGGING (Deprecated, kept for backward compatibility)
    // ========================================================================

    pub fn record_log(env: Env, sub_id: u64, event: LogEvent, data: String) {
        Self::require_admin(&env);

        let key = DataKey::Logs(sub_id);

        let mut logs: Vec<LogEntry> = env.storage().persistent().get(&key).unwrap_or(vec![&env]);

        let entry = LogEntry {
            sub_id,
            event: event.clone(),
            timestamp: env.ledger().timestamp(),
            data,
        };

        logs.push_back(entry);

        env.storage().persistent().set(&key, &logs);

        LogAppended { sub_id, event }.publish(&env);
    }

    pub fn get_logs(env: Env, sub_id: u64) -> Vec<LogEntry> {
        let key = DataKey::Logs(sub_id);

        env.storage().persistent().get(&key).unwrap_or(vec![&env])
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

        let next_index = commitment_index + 1;
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

        env.storage()
            .instance()
            .set(&DataKey::MerkleRootCount, &(root_count + 1));

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
        let mut current_hash = commitment.commitment_hash;

        for i in 0..proof_path.len() {
            let sibling = proof_path.get_unchecked(i);
            let is_right = proof_directions.get_unchecked(i);

            // Concatenate hashes based on direction
            let combined = if is_right {
                // Current is left, sibling is right
                let mut bytes = Bytes::new(&env);
                bytes.extend_from_slice(&current_hash.to_array());
                bytes.extend_from_slice(&sibling.to_array());
                bytes
            } else {
                // Sibling is left, current is right
                let mut bytes = Bytes::new(&env);
                bytes.extend_from_slice(&sibling.to_array());
                bytes.extend_from_slice(&current_hash.to_array());
                bytes
            };

            // Hash combined value and convert to BytesN<32>
            current_hash = env.crypto().sha256(&combined).into();
        }

        // Compare computed root with stored root
        current_hash == merkle_root.root_hash
    }
}

#[cfg(test)]
mod test;
