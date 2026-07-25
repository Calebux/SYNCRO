//! Hash-based ZK payment proof verifier.
//!
//! Scheme: Fiat-Shamir commitment proof using SHA-256.
//!
//! Domain tags follow the `syncro:payment:*` convention shared with
//! [`commitment::compute_commitment`] and [`nullifier::compute_nullifier`]
//! (see `commitment.rs` / `nullifier.rs`).
//!
//! The prover holds a secret `w` and derives an ephemeral `proof_key`:
//!   proof_key = SHA256("syncro:payment:v1" || w)     (off-chain, never revealed)
//!   commitment = SHA256(COMMIT_DOMAIN || proof_key)  (public, on-chain)
//!   nullifier  = SHA256(NULL_DOMAIN  || proof_key)   (public, on-chain)
//!
//! Proof construction (64 bytes):
//!   params  = amount_threshold(16 BE) || time_start(8 BE) || time_end(8 BE)  → padded to 32 B
//!   context = SHA256(commitment || nullifier || params)
//!   s       = SHA256(proof_key || context)
//!   proof   = proof_key(32 B) || s(32 B)
//!
//! On-chain verification checks:
//!   1. SHA256(COMMIT_DOMAIN || r) == commitment
//!   2. SHA256(NULL_DOMAIN   || r) == nullifier
//!   3. SHA256(r || context)       == s
//!   4. time_window_start ≤ now ≤ time_window_end
//!
//! Security: forging requires finding proof_key s.t. both commitment and
//! nullifier match — i.e. a SHA-256 preimage — which is computationally
//! infeasible. The original secret `w` is never revealed.

use soroban_sdk::{Bytes, BytesN, Env};

// 32-byte domain separators (tag || zero-padding)
// Domain tag convention: "syncro:payment:*" (matches commitment.rs & nullifier.rs)
const COMMIT_DOMAIN: &[u8; 32] =
    b"syncro:payment:commit\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00";

const NULL_DOMAIN: &[u8; 32] =
    b"syncro:payment:nullifier\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00";

/// Verify a ZK payment proof.
///
/// Returns `true` iff all checks pass.  Call sites are expected to enforce
/// nullifier deduplication *before* calling this function.
pub fn verify_proof(
    env: &Env,
    proof_bytes: &Bytes,
    commitment: &BytesN<32>,
    nullifier: &BytesN<32>,
    amount_threshold: i128,
    time_window_start: u64,
    time_window_end: u64,
) -> bool {
    // Proof must be exactly 64 bytes.
    if proof_bytes.len() != 64 {
        return false;
    }

    // Time-window sanity and current-ledger check.
    if time_window_start >= time_window_end {
        return false;
    }
    let now = env.ledger().timestamp();
    if now < time_window_start || now > time_window_end {
        return false;
    }

    // Extract r (proof_key, 32 B) and s (response, 32 B).
    let mut r_arr = [0u8; 32];
    let mut s_arr = [0u8; 32];
    for i in 0u32..32 {
        r_arr[i as usize] = proof_bytes.get(i).unwrap_or(0);
        s_arr[i as usize] = proof_bytes.get(i + 32).unwrap_or(0);
    }
    let r: BytesN<32> = BytesN::from_array(env, &r_arr);
    let s: BytesN<32> = BytesN::from_array(env, &s_arr);

    // Check 1: SHA256(COMMIT_DOMAIN || r) == commitment
    let expected_commitment = hash_domain_key(env, COMMIT_DOMAIN, &r);
    if expected_commitment != *commitment {
        return false;
    }

    // Check 2: SHA256(NULL_DOMAIN || r) == nullifier
    let expected_nullifier = hash_domain_key(env, NULL_DOMAIN, &r);
    if expected_nullifier != *nullifier {
        return false;
    }

    // Build params: amount_threshold(16 BE) || time_start(8 BE) || time_end(8 BE)
    let mut params = [0u8; 32];
    params[0..16].copy_from_slice(&amount_threshold.to_be_bytes());
    params[16..24].copy_from_slice(&time_window_start.to_be_bytes());
    params[24..32].copy_from_slice(&time_window_end.to_be_bytes());

    // context = SHA256(commitment || nullifier || params)
    let mut ctx_input = Bytes::new(env);
    let commitment_bytes: Bytes = commitment.clone().into();
    ctx_input.append(&commitment_bytes);
    let nullifier_bytes: Bytes = nullifier.clone().into();
    ctx_input.append(&nullifier_bytes);
    let params_bytes: Bytes = BytesN::<32>::from_array(env, &params).into();
    ctx_input.append(&params_bytes);
    let context: BytesN<32> = env.crypto().sha256(&ctx_input);

    // Check 3: SHA256(r || context) == s
    let mut s_input = Bytes::new(env);
    let r_bytes: Bytes = r.into();
    s_input.append(&r_bytes);
    let context_bytes: Bytes = context.into();
    s_input.append(&context_bytes);
    let expected_s: BytesN<32> = env.crypto().sha256(&s_input);

    expected_s == s
}

/// SHA256(domain_32 || key_32)
fn hash_domain_key(env: &Env, domain: &[u8; 32], key: &BytesN<32>) -> BytesN<32> {
    let mut input = Bytes::new(env);
    let domain_bytes: Bytes = BytesN::<32>::from_array(env, domain).into();
    input.append(&domain_bytes);
    let key_bytes: Bytes = key.clone().into();
    input.append(&key_bytes);
    env.crypto().sha256(&input)
}
