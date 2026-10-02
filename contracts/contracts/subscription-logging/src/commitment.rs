use soroban_sdk::{Bytes, BytesN, Env};

/// Domain separator for audit log commitments.
/// Prevents cross-protocol replay attacks by binding the hash
/// to this specific application context.
const DOMAIN_SEPARATOR: &[u8] = b"syncro:audit:v1";

/// Byte used to represent event type in the commitment hash.
/// Chosen to be a single byte for gas efficiency on Soroban.
pub enum EventTypeByte {
    Reminder = 0x00,
    Approval = 0x01,
    Renewal = 0x02,
    Failure = 0x03,
    Retry = 0x04,
    Cancellation = 0x05,
    GiftCardAttached = 0x06,
    SubscriptionCreate = 0x10,
    SubscriptionUpdate = 0x11,
    SubscriptionDelete = 0x12,
    SubscriptionCancel = 0x13,
    SubscriptionPause = 0x14,
    SubscriptionUnpause = 0x15,
}

/// Compute the on-chain commitment hash:
///   SHA-256(DOMAIN_SEPARATOR || event_type_byte || event_data_hash || blinding_factor)
///
/// This hash is what gets stored on-chain as `AuditCommitment.commitment_hash`.
/// The binding is hiding (no preimage without blinding_factor) and
/// binding (cannot find two openings for the same hash).
///
/// # Arguments
/// * `event_type` — Single-byte event type discriminator (see `EventTypeByte`)
/// * `event_data_hash` — 32-byte SHA-256 of the serialized event data
/// * `blinding_factor` — 32-byte random blinding factor
///
/// # Returns
/// * 32-byte commitment hash
pub fn compute_commitment_hash(
    env: &Env,
    event_type: u32,
    event_data_hash: &BytesN<32>,
    blinding_factor: &BytesN<32>,
) -> BytesN<32> {
    let mut payload = Bytes::from_slice(env, DOMAIN_SEPARATOR);
    payload.append(&Bytes::from_slice(env, &event_type.to_be_bytes()));
    payload.extend_from_slice(&event_data_hash.to_array());
    payload.extend_from_slice(&blinding_factor.to_array());

    env.crypto().sha256(&payload).into()
}

/// Verify that a given commitment hash was correctly computed from
/// the provided event data and blinding factor.
///
/// This is used during selective disclosure: a user reveals
/// (event_data, blinding_factor) and the verifier checks that
/// recomputing the commitment hash matches the on-chain value.
///
/// # Arguments
/// * `stored_hash` — The commitment hash previously stored on-chain
/// * `event_type` — Single-byte event type discriminator
/// * `event_data_hash` — 32-byte SHA-256 of the serialized event data
/// * `blinding_factor` — 32-byte random blinding factor
///
/// # Returns
/// * `true` if the recomputed hash matches the stored hash
pub fn verify_commitment(
    env: &Env,
    stored_hash: &BytesN<32>,
    event_type: u32,
    event_data_hash: &BytesN<32>,
    blinding_factor: &BytesN<32>,
) -> bool {
    let computed = compute_commitment_hash(env, event_type, event_data_hash, blinding_factor);
    computed == *stored_hash
}

/// Compute a SHA-256 hash of serialized event data.
/// This is the `v` value in the Pedersen commitment `C = g^v * h^r`,
/// computed off-chain where v = Hash(event_data).
///
/// On-chain, this is used as part of the commitment hash computation
/// rather than as a standalone Pedersen commitment (which requires
/// Ristretto255 curve operations not available in Soroban).
///
/// # Arguments
/// * `event_data` — Serialized event data bytes
///
/// # Returns
/// * 32-byte SHA-256 hash
pub fn hash_event_data(env: &Env, event_data: &Bytes) -> BytesN<32> {
    env.crypto().sha256(event_data).into()
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{Bytes, BytesN, Env};

    #[test]
    fn test_compute_commitment_hash_deterministic() {
        let env = Env::default();

        let event_type = EventTypeByte::Renewal as u32;
        let event_data_hash = BytesN::from_array(&env, &[1u8; 32]);
        let blinding_factor = BytesN::from_array(&env, &[2u8; 32]);

        let hash1 = compute_commitment_hash(&env, event_type, &event_data_hash, &blinding_factor);
        let hash2 = compute_commitment_hash(&env, event_type, &event_data_hash, &blinding_factor);

        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_compute_commitment_hash_different_blinding() {
        let env = Env::default();

        let event_type = EventTypeByte::Renewal as u32;
        let event_data_hash = BytesN::from_array(&env, &[1u8; 32]);
        let bf1 = BytesN::from_array(&env, &[2u8; 32]);
        let bf2 = BytesN::from_array(&env, &[3u8; 32]);

        let hash1 = compute_commitment_hash(&env, event_type, &event_data_hash, &bf1);
        let hash2 = compute_commitment_hash(&env, event_type, &event_data_hash, &bf2);

        assert_ne!(hash1, hash2);
    }

    #[test]
    fn test_compute_commitment_hash_different_event_type() {
        let env = Env::default();

        let event_data_hash = BytesN::from_array(&env, &[1u8; 32]);
        let blinding_factor = BytesN::from_array(&env, &[2u8; 32]);

        let hash1 = compute_commitment_hash(
            &env,
            EventTypeByte::Renewal as u32,
            &event_data_hash,
            &blinding_factor,
        );
        let hash2 = compute_commitment_hash(
            &env,
            EventTypeByte::Cancellation as u32,
            &event_data_hash,
            &blinding_factor,
        );

        assert_ne!(hash1, hash2);
    }

    #[test]
    fn test_verify_commitment_valid() {
        let env = Env::default();

        let event_type = EventTypeByte::Approval as u32;
        let event_data_hash = BytesN::from_array(&env, &[42u8; 32]);
        let blinding_factor = BytesN::from_array(&env, &[99u8; 32]);

        let hash = compute_commitment_hash(&env, event_type, &event_data_hash, &blinding_factor);
        let is_valid =
            verify_commitment(&env, &hash, event_type, &event_data_hash, &blinding_factor);

        assert!(is_valid);
    }

    #[test]
    fn test_verify_commitment_invalid_blinding() {
        let env = Env::default();

        let event_type = EventTypeByte::Approval as u32;
        let event_data_hash = BytesN::from_array(&env, &[42u8; 32]);
        let blinding_factor = BytesN::from_array(&env, &[99u8; 32]);
        let wrong_bf = BytesN::from_array(&env, &[100u8; 32]);

        let hash = compute_commitment_hash(&env, event_type, &event_data_hash, &blinding_factor);
        let is_valid = verify_commitment(&env, &hash, event_type, &event_data_hash, &wrong_bf);

        assert!(!is_valid);
    }

    #[test]
    fn test_verify_commitment_invalid_data_hash() {
        let env = Env::default();

        let event_type = EventTypeByte::Approval as u32;
        let event_data_hash = BytesN::from_array(&env, &[42u8; 32]);
        let wrong_data_hash = BytesN::from_array(&env, &[43u8; 32]);
        let blinding_factor = BytesN::from_array(&env, &[99u8; 32]);

        let hash = compute_commitment_hash(&env, event_type, &event_data_hash, &blinding_factor);
        let is_valid =
            verify_commitment(&env, &hash, event_type, &wrong_data_hash, &blinding_factor);

        assert!(!is_valid);
    }

    #[test]
    fn test_hash_event_data_deterministic() {
        let env = Env::default();

        let data = Bytes::from_slice(&env, b"test event data");
        let hash1 = hash_event_data(&env, &data);
        let hash2 = hash_event_data(&env, &data);

        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_hash_event_data_different_inputs_different_hashes() {
        let env = Env::default();

        let data1 = Bytes::from_slice(&env, b"event A");
        let data2 = Bytes::from_slice(&env, b"event B");

        let hash1 = hash_event_data(&env, &data1);
        let hash2 = hash_event_data(&env, &data2);

        assert_ne!(hash1, hash2);
    }

    #[test]
    fn test_commitment_hash_32_bytes() {
        let env = Env::default();

        let event_type = EventTypeByte::Reminder as u32;
        let event_data_hash = BytesN::from_array(&env, &[0u8; 32]);
        let blinding_factor = BytesN::from_array(&env, &[0u8; 32]);

        let hash = compute_commitment_hash(&env, event_type, &event_data_hash, &blinding_factor);

        assert_eq!(hash.len(), 32);
    }
}
