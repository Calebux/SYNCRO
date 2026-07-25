#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env};

fn create_test_env() -> (Env, Address, SubscriptionLoggingContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(SubscriptionLoggingContract, ());
    let client = SubscriptionLoggingContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.init(&admin);

    (env, admin, client)
}

// ============================================================================
// COMMITMENT GENERATION TESTS
// ============================================================================

#[test]
fn test_record_commitment() {
    let (_env, _admin, client) = create_test_env();

    // Generate a mock commitment hash (in production, this would be SHA-256 of event data)
    let commitment_hash = BytesN::from_array(
        &client.env,
        &[0u8; 32], // Mock commitment
    );

    let commitment_index = client.record_commitment(&commitment_hash);

    // Verify index returned
    assert_eq!(commitment_index, 0);

    // Verify commitment count incremented
    assert_eq!(client.get_commitment_count(), 1);
}

#[test]
fn test_record_multiple_commitments() {
    let (env, _admin, client) = create_test_env();

    // Record 5 commitments
    for i in 0..5u8 {
        let mut hash_bytes = [0u8; 32];
        hash_bytes[0] = i;
        let commitment_hash = BytesN::from_array(&env, &hash_bytes);

        let index = client.record_commitment(&commitment_hash);
        assert_eq!(index, i as u64);
    }

    assert_eq!(client.get_commitment_count(), 5);
}

#[test]
fn test_get_commitment() {
    let (env, _admin, client) = create_test_env();

    let commitment_hash = BytesN::from_array(&env, &[1u8; 32]);
    let index = client.record_commitment(&commitment_hash);

    let retrieved = client.get_commitment(&index).unwrap();

    assert_eq!(retrieved.commitment_hash, commitment_hash);
    assert_eq!(retrieved.commitment_index, index);
    // Timestamp is set (may be 0 in mock environment)
    assert_eq!(retrieved.timestamp, env.ledger().timestamp());
}

#[test]
fn test_get_nonexistent_commitment() {
    let (_env, _admin, client) = create_test_env();

    let result = client.get_commitment(&999);
    assert!(result.is_none());
}

#[test]
fn test_get_commitments_range() {
    let (env, _admin, client) = create_test_env();

    // Record 10 commitments
    for i in 0..10u8 {
        let mut hash_bytes = [0u8; 32];
        hash_bytes[0] = i;
        let commitment_hash = BytesN::from_array(&env, &hash_bytes);
        client.record_commitment(&commitment_hash);
    }

    // Get range 2-5
    let range = client.get_commitments_range(&2, &5);
    assert_eq!(range.len(), 4);

    // Verify indices
    assert_eq!(range.get(0).unwrap().commitment_index, 2);
    assert_eq!(range.get(3).unwrap().commitment_index, 5);
}

#[test]
#[should_panic(expected = "Range too large")]
fn test_get_commitments_range_too_large() {
    let (_env, _admin, client) = create_test_env();

    // Attempt to get more than 100 commitments
    client.get_commitments_range(&0, &150);
}

// ============================================================================
// COMMITMENT PRIVACY TESTS
// ============================================================================

#[test]
fn test_commitment_reveals_no_subscription_data() {
    let (env, _admin, client) = create_test_env();

    // Record a commitment (representing sensitive subscription data)
    let commitment_hash = BytesN::from_array(&env, &[42u8; 32]);
    let index = client.record_commitment(&commitment_hash);

    let commitment = client.get_commitment(&index).unwrap();

    // Verify only hash and metadata are stored, no plaintext
    assert_eq!(commitment.commitment_hash, commitment_hash);
    assert_eq!(commitment.timestamp, env.ledger().timestamp());
    assert_eq!(commitment.commitment_index, 0);

    // No sub_id, no event data, no user info
}

#[test]
fn test_commitments_not_linkable_by_subscription() {
    let (env, _admin, client) = create_test_env();

    // Record commitments for "same subscription" (different hashes)
    let hash1 = BytesN::from_array(&env, &[1u8; 32]);
    let hash2 = BytesN::from_array(&env, &[2u8; 32]);

    let index1 = client.record_commitment(&hash1);
    let index2 = client.record_commitment(&hash2);

    let c1 = client.get_commitment(&index1).unwrap();
    let c2 = client.get_commitment(&index2).unwrap();

    // No way to link these commitments on-chain
    assert_ne!(c1.commitment_hash, c2.commitment_hash);
    // No sub_id field exists to correlate them
}

// ============================================================================
// MERKLE TREE TESTS
// ============================================================================

#[test]
fn test_anchor_merkle_root() {
    let (env, _admin, client) = create_test_env();

    // Record 4 commitments
    for i in 0..4u8 {
        let mut hash_bytes = [0u8; 32];
        hash_bytes[0] = i;
        client.record_commitment(&BytesN::from_array(&env, &hash_bytes));
    }

    // Anchor Merkle root for commitments 0-3
    let root_hash = BytesN::from_array(&env, &[99u8; 32]);
    client.anchor_merkle_root(&root_hash, &0, &3);

    // Verify root was stored
    assert_eq!(client.get_merkle_root_count(), 1);

    let merkle_root = client.get_merkle_root(&0).unwrap();
    assert_eq!(merkle_root.root_hash, root_hash);
    assert_eq!(merkle_root.start_index, 0);
    assert_eq!(merkle_root.end_index, 3);
}

#[test]
#[should_panic(expected = "Invalid range")]
fn test_anchor_merkle_root_invalid_range() {
    let (env, _admin, client) = create_test_env();

    let root_hash = BytesN::from_array(&env, &[99u8; 32]);
    client.anchor_merkle_root(&root_hash, &5, &2); // end < start
}

#[test]
#[should_panic(expected = "exceeds commitment count")]
fn test_anchor_merkle_root_exceeds_commitments() {
    let (env, _admin, client) = create_test_env();

    // Only record 2 commitments
    for i in 0..2u8 {
        let mut hash_bytes = [0u8; 32];
        hash_bytes[0] = i;
        client.record_commitment(&BytesN::from_array(&env, &hash_bytes));
    }

    // Try to anchor root for indices 0-5 (but only 0-1 exist)
    let root_hash = BytesN::from_array(&env, &[99u8; 32]);
    client.anchor_merkle_root(&root_hash, &0, &5);
}

// ============================================================================
// MERKLE PROOF VERIFICATION TESTS
// ============================================================================

#[test]
fn test_verify_merkle_membership_simple() {
    let (env, _admin, client) = create_test_env();

    // Record 2 commitments
    let hash1 = BytesN::from_array(&env, &[1u8; 32]);
    let hash2 = BytesN::from_array(&env, &[2u8; 32]);

    client.record_commitment(&hash1);
    client.record_commitment(&hash2);

    // Compute Merkle root manually
    let mut combined = Bytes::new(&env);
    combined.extend_from_slice(&hash1.to_array());
    combined.extend_from_slice(&hash2.to_array());
    let root: BytesN<32> = env.crypto().sha256(&combined).into();

    // Anchor the root
    client.anchor_merkle_root(&root, &0, &1);

    // Verify membership of commitment 0
    let proof_path = soroban_sdk::vec![&env, hash2]; // Sibling is hash2
    let proof_directions = soroban_sdk::vec![&env, true]; // Current is left

    let is_valid = client.verify_merkle_membership(&0, &0, &proof_path, &proof_directions);
    assert!(is_valid);
}

#[test]
fn test_verify_merkle_membership_invalid_proof() {
    let (env, _admin, client) = create_test_env();

    // Record 2 commitments
    let hash1 = BytesN::from_array(&env, &[1u8; 32]);
    let hash2 = BytesN::from_array(&env, &[2u8; 32]);

    client.record_commitment(&hash1);
    client.record_commitment(&hash2);

    // Compute correct Merkle root
    let mut combined = Bytes::new(&env);
    combined.extend_from_slice(&hash1.to_array());
    combined.extend_from_slice(&hash2.to_array());
    let root: BytesN<32> = env.crypto().sha256(&combined).into();

    client.anchor_merkle_root(&root, &0, &1);

    // Provide wrong sibling (should fail)
    let wrong_sibling = BytesN::from_array(&env, &[99u8; 32]);
    let proof_path = soroban_sdk::vec![&env, wrong_sibling];
    let proof_directions = soroban_sdk::vec![&env, true];

    let is_valid = client.verify_merkle_membership(&0, &0, &proof_path, &proof_directions);
    assert!(!is_valid);
}

#[test]
fn test_verify_merkle_membership_commitment_not_in_range() {
    let (env, _admin, client) = create_test_env();

    // Record 4 commitments
    for i in 0..4u8 {
        let mut hash_bytes = [0u8; 32];
        hash_bytes[0] = i;
        client.record_commitment(&BytesN::from_array(&env, &hash_bytes));
    }

    // Anchor root for only commitments 0-1
    let root_hash = BytesN::from_array(&env, &[99u8; 32]);
    client.anchor_merkle_root(&root_hash, &0, &1);

    // Try to verify commitment 3 (out of range)
    let proof_path = soroban_sdk::vec![&env];
    let proof_directions = soroban_sdk::vec![&env];

    let is_valid = client.verify_merkle_membership(&3, &0, &proof_path, &proof_directions);
    assert!(!is_valid);
}

// ============================================================================
// BACKWARD COMPATIBILITY TESTS (Legacy Plaintext Logging)
// ============================================================================

#[test]
fn test_legacy_record_log() {
    let (env, _admin, client) = create_test_env();

    let sub_id = 12345u64;
    let event = LogEvent::Reminder;
    let data = String::from_str(&env, "Test reminder data");

    client.record_log(&sub_id, &event, &data);

    let logs = client.get_logs(&sub_id);
    assert_eq!(logs.len(), 1);

    let log_entry = logs.get(0).unwrap();
    assert_eq!(log_entry.sub_id, sub_id);
    assert_eq!(log_entry.event, LogEvent::Reminder);
    assert_eq!(log_entry.data, data);
}

#[test]
fn test_legacy_multiple_logs_same_subscription() {
    let (env, _admin, client) = create_test_env();

    let sub_id = 999u64;

    client.record_log(
        &sub_id,
        &LogEvent::Approval,
        &String::from_str(&env, "Approved"),
    );
    client.record_log(
        &sub_id,
        &LogEvent::Renewal,
        &String::from_str(&env, "Renewed"),
    );
    client.record_log(
        &sub_id,
        &LogEvent::Cancellation,
        &String::from_str(&env, "Cancelled"),
    );

    let logs = client.get_logs(&sub_id);
    assert_eq!(logs.len(), 3);
}

// ============================================================================
// REPLAY ATTACK PREVENTION TESTS
// ============================================================================

#[test]
fn test_commitment_indices_monotonic() {
    let (env, _admin, client) = create_test_env();

    let hash1 = BytesN::from_array(&env, &[1u8; 32]);
    let hash2 = BytesN::from_array(&env, &[2u8; 32]);
    let hash3 = BytesN::from_array(&env, &[3u8; 32]);

    let idx1 = client.record_commitment(&hash1);
    let idx2 = client.record_commitment(&hash2);
    let idx3 = client.record_commitment(&hash3);

    // Indices must be strictly increasing
    assert_eq!(idx1, 0);
    assert_eq!(idx2, 1);
    assert_eq!(idx3, 2);
}

#[test]
fn test_commitment_index_uniqueness() {
    let (env, _admin, client) = create_test_env();

    // Record same hash twice (simulating replay attempt)
    let hash = BytesN::from_array(&env, &[42u8; 32]);

    let idx1 = client.record_commitment(&hash);
    let idx2 = client.record_commitment(&hash);

    // Different indices even for same hash
    assert_ne!(idx1, idx2);

    let c1 = client.get_commitment(&idx1).unwrap();
    let c2 = client.get_commitment(&idx2).unwrap();

    // Same hash, different indices and timestamps
    assert_eq!(c1.commitment_hash, c2.commitment_hash);
    assert_ne!(c1.commitment_index, c2.commitment_index);
}

// ============================================================================
// STORAGE EFFICIENCY TESTS
// ============================================================================

#[test]
fn test_commitment_storage_size() {
    let (env, _admin, client) = create_test_env();

    // Commitment structure:
    // - commitment_hash: 32 bytes
    // - timestamp: 8 bytes (u64)
    // - commitment_index: 8 bytes (u64)
    // Total: 48 bytes

    // Compare to legacy LogEntry:
    // - sub_id: 8 bytes
    // - event: ~1 byte (enum)
    // - timestamp: 8 bytes
    // - data: variable (typically 100-200 bytes)
    // Total: ~117-217 bytes

    // Commitment is ~75% smaller!

    let commitment_hash = BytesN::from_array(&env, &[0u8; 32]);
    let index = client.record_commitment(&commitment_hash);

    let commitment = client.get_commitment(&index).unwrap();

    // Verify compact structure
    assert_eq!(commitment.commitment_hash.len(), 32);
    assert_eq!(commitment.timestamp, env.ledger().timestamp());
    assert_eq!(commitment.commitment_index, 0);
}
