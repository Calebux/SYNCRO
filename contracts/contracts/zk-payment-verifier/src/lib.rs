#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Bytes, BytesN, Env};

pub mod commitment;
pub mod nullifier;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Nullifiers,
}

#[contract]
pub struct ZkPaymentVerifier;

#[contractimpl]
impl ZkPaymentVerifier {
    /// Verify a payment commitment and record its nullifier.
    /// Returns true if the commitment is valid and the nullifier is fresh.
    pub fn verify_and_record(
        env: Env,
        user_id: Bytes,
        service_id: Bytes,
        amount: u128,
        timestamp: u64,
        blinding_factor: BytesN<32>,
        expected_commitment: BytesN<32>,
    ) -> bool {
        let computed = commitment::compute_commitment(
            &env,
            &user_id,
            &service_id,
            amount,
            timestamp,
            &blinding_factor,
        );

        if computed != expected_commitment {
            return false;
        }

        let computed_nullifier = nullifier::compute_nullifier(&env, &blinding_factor, &service_id);
        nullifier::record(&env, computed_nullifier)
    }

    /// Check if a nullifier has already been used.
    pub fn is_nullifier_used(env: Env, nullifier: BytesN<32>) -> bool {
        nullifier::is_used(&env, &nullifier)
    }
}

#[cfg(test)]
mod test;
