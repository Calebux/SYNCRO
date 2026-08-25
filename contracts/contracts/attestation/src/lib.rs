#![no_std]
//! Attestation contract – issue/revoke/verify hashed KYC/compliance attestations.
//! Privacy model: **no PII on-chain**. The issuer computes
//! `SHA-256(subject || attestation_type || salt)` off-chain and stores only that
//! 32-byte digest. The subject proves the attestation by revealing the pre-image
//! off-chain; the verifier re-hashes and calls `verify`.

use soroban_sdk::{contract, contractevent, contractimpl, contracttype, contracterror,
                  Address, BytesN, Env, Symbol};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum AttestError {
    AlreadyInit   = 1, // contract already initialised
    Unauthorized  = 2, // caller is not the issuer
    NotFound      = 3, // no attestation for (subject, type)
    Revoked       = 4, // attestation already revoked
    InvalidDigest = 5, // zero digest not accepted
}

#[contracttype]
#[derive(Clone)]
enum Key { Issuer, Record(Address, Symbol) }

/// Stored record — digest only, never raw PII.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttestRecord {
    pub digest:    BytesN<32>, // SHA-256(pre-image) computed off-chain
    pub issued_at: u32,        // ledger sequence at issuance
    pub revoked:   bool,
}

#[contractevent]
pub struct Issued  { pub subject: Address, pub attestation_type: Symbol, pub issued_at: u32 }
#[contractevent]
pub struct Revoked { pub subject: Address, pub attestation_type: Symbol }

#[contract]
pub struct AttestationContract;

#[contractimpl]
impl AttestationContract {
    /// Initialise with a single trusted issuer. Call once after deployment.
    pub fn init(env: Env, issuer: Address) -> Result<(), AttestError> {
        if env.storage().instance().has(&Key::Issuer) { return Err(AttestError::AlreadyInit); }
        env.storage().instance().set(&Key::Issuer, &issuer);
        Ok(())
    }

    /// Issue an attestation. Only the registered issuer may call this.
    /// `digest` = SHA-256(subject_bytes ‖ type_bytes ‖ random_salt) — computed off-chain.
    pub fn issue(env: Env, subject: Address, attestation_type: Symbol, digest: BytesN<32>)
        -> Result<(), AttestError>
    {
        Self::require_issuer(&env)?;
        if digest == BytesN::from_array(&env, &[0u8; 32]) { return Err(AttestError::InvalidDigest); }
        let record = AttestRecord { digest, issued_at: env.ledger().sequence(), revoked: false };
        env.storage().persistent().set(&Key::Record(subject.clone(), attestation_type.clone()), &record);
        Issued { subject, attestation_type, issued_at: record.issued_at }.publish(&env);
        Ok(())
    }

    /// Revoke an existing attestation. Only the issuer may call this.
    pub fn revoke(env: Env, subject: Address, attestation_type: Symbol) -> Result<(), AttestError> {
        Self::require_issuer(&env)?;
        let k = Key::Record(subject.clone(), attestation_type.clone());
        let mut r: AttestRecord = env.storage().persistent().get(&k).ok_or(AttestError::NotFound)?;
        if r.revoked { return Err(AttestError::Revoked); }
        r.revoked = true;
        env.storage().persistent().set(&k, &r);
        Revoked { subject, attestation_type }.publish(&env);
        Ok(())
    }

    /// Returns `true` iff an active attestation exists with the given digest.
    /// No PII crosses the contract boundary — only the hash is submitted.
    pub fn verify(env: Env, subject: Address, attestation_type: Symbol, digest: BytesN<32>) -> bool {
        match env.storage().persistent().get::<Key, AttestRecord>(
            &Key::Record(subject, attestation_type)
        ) {
            Some(r) => !r.revoked && r.digest == digest,
            None    => false,
        }
    }

    /// Return the raw record (digest + metadata) for auditing by authorised parties.
    pub fn get_record(env: Env, subject: Address, attestation_type: Symbol)
        -> Option<AttestRecord>
    {
        env.storage().persistent().get(&Key::Record(subject, attestation_type))
    }

    fn require_issuer(env: &Env) -> Result<(), AttestError> {
        let issuer: Address = env.storage().instance()
            .get(&Key::Issuer).ok_or(AttestError::Unauthorized)?;
        issuer.require_auth();
        Ok(())
    }
}

#[cfg(test)]
mod test;
