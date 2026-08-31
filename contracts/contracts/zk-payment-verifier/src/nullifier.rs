//! On-chain nullifier registry, preventing the same ZK proof secret
//! (a `blinding_factor` + `service_id` pair) from being used to prove the
//! same payment twice.
//!
//! All submitted nullifiers live in a single persistent `Map`, so every
//! lookup/insert reads and rewrites the whole set -- storage and per-call
//! cost grow linearly with the number of nullifiers ever submitted. That's
//! an accepted MVP tradeoff (see the issue this module was built for);
//! revisit if proof volume grows large enough to make it a bottleneck.

use soroban_sdk::{Bytes, BytesN, Env, Map};

use crate::DataKey;

/// Compute a nullifier: `SHA-256("syncro:payment:v1" || blinding_factor || service_id)`.
///
/// Deterministic per `(blinding_factor, service_id)` pair, so the same
/// secret can never produce two different nullifiers. It reveals nothing
/// about the underlying payment (amount, user, timestamp) -- it's a
/// one-way hash of values only the prover knows, so an observer learns
/// only "some proof already used this nullifier," never which payment.
pub fn compute_nullifier(
    env: &Env,
    blinding_factor: &BytesN<32>,
    service_id: &Bytes,
) -> BytesN<32> {
    let mut payload = Bytes::from_slice(env, b"syncro:payment:v1");
    payload.append(&Bytes::from_slice(env, &blinding_factor.to_array()));
    payload.append(&service_id.clone());

    env.crypto().sha256(&payload).into()
}

fn load(env: &Env) -> Map<BytesN<32>, bool> {
    env.storage()
        .persistent()
        .get(&DataKey::Nullifiers)
        .unwrap_or(Map::new(env))
}

/// Whether `nullifier` has already been recorded.
pub fn is_used(env: &Env, nullifier: &BytesN<32>) -> bool {
    load(env).contains_key(nullifier.clone())
}

/// Record `nullifier` as used.
///
/// Returns `true` if it was freshly recorded, `false` if it was already
/// present (a duplicate -- the existing entry is left untouched).
pub fn record(env: &Env, nullifier: BytesN<32>) -> bool {
    let mut nullifiers = load(env);
    if nullifiers.contains_key(nullifier.clone()) {
        return false;
    }
    nullifiers.set(nullifier, true);
    env.storage()
        .persistent()
        .set(&DataKey::Nullifiers, &nullifiers);
    true
}
