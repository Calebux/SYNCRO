//! # ZK Payment Verifier
//!
//! On-chain payment proof verification for SYNCRO subscription renewals.
//!
//! ## What this contract actually guarantees
//!
//! This contract verifies a **Fiat-Shamir hash proof** (`verifier::verify_proof`) that
//! binds a public `commitment` and `nullifier` to a secret `proof_key` without revealing
//! that key on-chain. It is **not** a general-purpose zero-knowledge proof system and
//! does **not** hide `user_id`, `amount`, or `blinding_factor` unless callers keep those
//! values off-chain.
//!
//! | Field | Hidden on-chain? | Hidden from observers? |
//! |---|---|---|
//! | `proof_key` (inside proof bytes) | Yes — only hash relations checked | Yes — prover never submits it |
//! | `commitment`, `nullifier` | No — public inputs | No |
//! | `amount_threshold`, time window | No — public inputs | No |
//! | Original payment metadata (`user_id`, exact amount) | Not accepted by entrypoint | Only if kept off-chain |
//!
//! ## Entrypoint
//!
//! `verify_and_record(proof, commitment, nullifier, amount_threshold, time_window_start,
//! time_window_end)` verifies the proof, then records the nullifier to prevent double-spend.

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Bytes, BytesN, Env};

pub mod commitment;
pub mod nullifier;
mod verifier;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Nullifiers,
}

#[contract]
pub struct ZkPaymentVerifier;

#[contractimpl]
impl ZkPaymentVerifier {
    /// Verify a payment proof against public inputs and record its nullifier.
    ///
    /// Private fields (`user_id`, exact `amount`, `blinding_factor`) must **not** be
    /// supplied here — they belong in the off-chain prover. Only the proof bytes and
    /// hash-derived public inputs are checked on-chain.
    ///
    /// Returns `true` when verification succeeds and the nullifier is fresh.
    pub fn verify_and_record(
        env: Env,
        proof: Bytes,
        commitment: BytesN<32>,
        nullifier: BytesN<32>,
        amount_threshold: i128,
        time_window_start: u64,
        time_window_end: u64,
    ) -> bool {
        if !verifier::verify_proof(
            &env,
            &proof,
            &commitment,
            &nullifier,
            amount_threshold,
            time_window_start,
            time_window_end,
        ) {
            return false;
        }

        nullifier::record(&env, nullifier)
    }

    /// Check if a nullifier has already been used.
    pub fn is_nullifier_used(env: Env, nullifier: BytesN<32>) -> bool {
        nullifier::is_used(&env, &nullifier)
    }
}

#[cfg(test)]
mod test;
