#![no_std]
use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, Address, BytesN, Env, String, Vec,
};

/// Storage key for rate data per currency pair
#[contracttype]
#[derive(Clone)]
struct RatePairKey {
    base: String,
    quote: String,
}

/// Storage keys for contract state
#[contracttype]
#[derive(Clone)]
enum StorageKey {
    Admin,
    Paused,
    SignerSet,
    RateData(RatePairKey),
    StalenessBound,
}

/// FX rate data with timestamp and signature
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FxRateData {
    pub base_currency: String,
    pub quote_currency: String,
    pub rate: i128,          // Rate with 8 decimal places (e.g., 0.92 EUR/USD = 92000000)
    pub timestamp: u64,      // Unix timestamp when rate was signed
    pub updated_ledger: u32, // Ledger sequence when rate was stored on-chain
    pub signer: Address,
}

/// Signed rate update from authorized feed
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignedRateUpdate {
    pub base_currency: String,
    pub quote_currency: String,
    pub rate: i128,
    pub timestamp: u64,
    pub signer: Address,
    pub signature: BytesN<64>,
}

/// Events
#[contractevent]
pub struct RateUpdated {
    pub base_currency: String,
    pub quote_currency: String,
    pub rate: i128,
    pub timestamp: u64,
    pub signer: Address,
}

#[contractevent]
pub struct SignerAdded {
    pub signer: Address,
}

#[contractevent]
pub struct SignerRemoved {
    pub signer: Address,
}

#[contractevent]
pub struct StalenessBoundUpdated {
    pub old_bound: u64,
    pub new_bound: u64,
}

#[contractevent]
pub struct RateValidationFailed {
    pub base_currency: String,
    pub quote_currency: String,
    pub reason: u32, // 1=not found, 2=stale, 3=signer unauthorized
}

#[contract]
pub struct FxOracleContract;

#[contractimpl]
impl FxOracleContract {
    /// Initialize the oracle with admin and default staleness bound (1 hour = 3600 seconds)
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&StorageKey::Admin) {
            panic!("Already initialized");
        }

        env.storage().instance().set(&StorageKey::Admin, &admin);
        env.storage().instance().set(&StorageKey::Paused, &false);
        
        // Default staleness bound: 1 hour (3600 seconds)
        env.storage()
            .instance()
            .set(&StorageKey::StalenessBound, &3600_u64);

        // Initialize empty signer set
        let signers: Vec<Address> = Vec::new(&env);
        env.storage().instance().set(&StorageKey::SignerSet, &signers);
    }

    /// Get admin address
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&StorageKey::Admin)
            .expect("Not initialized")
    }

    /// Check if contract is paused
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&StorageKey::Paused)
            .unwrap_or(false)
    }

    /// Pause the oracle (admin only)
    pub fn set_paused(env: Env, paused: bool) {
        let admin: Address = Self::get_admin(env.clone());
        admin.require_auth();
        env.storage().instance().set(&StorageKey::Paused, &paused);
    }

    // ── Signer Management ─────────────────────────────────────────

    /// Add an authorized rate signer (admin only)
    pub fn add_signer(env: Env, signer: Address) {
        if Self::is_paused(env.clone()) {
            panic!("Oracle is paused");
        }
        let admin: Address = Self::get_admin(env.clone());
        admin.require_auth();

        let mut signers: Vec<Address> = env
            .storage()
            .instance()
            .get(&StorageKey::SignerSet)
            .unwrap_or(Vec::new(&env));

        // Check if already exists
        for i in 0..signers.len() {
            if signers.get(i).unwrap() == signer {
                panic!("Signer already authorized");
            }
        }

        signers.push_back(signer.clone());
        env.storage()
            .instance()
            .set(&StorageKey::SignerSet, &signers);

        SignerAdded { signer }.publish(&env);
    }

    /// Remove an authorized rate signer (admin only)
    pub fn remove_signer(env: Env, signer: Address) {
        if Self::is_paused(env.clone()) {
            panic!("Oracle is paused");
        }
        let admin: Address = Self::get_admin(env.clone());
        admin.require_auth();

        let signers: Vec<Address> = env
            .storage()
            .instance()
            .get(&StorageKey::SignerSet)
            .expect("No signers configured");

        let mut found_index: Option<u32> = None;
        for i in 0..signers.len() {
            if signers.get(i).unwrap() == signer {
                found_index = Some(i);
                break;
            }
        }

        if found_index.is_none() {
            panic!("Signer not found");
        }

        // Remove by rebuilding vector without the target signer
        let mut new_signers: Vec<Address> = Vec::new(&env);
        for i in 0..signers.len() {
            if i != found_index.unwrap() {
                new_signers.push_back(signers.get(i).unwrap());
            }
        }

        env.storage()
            .instance()
            .set(&StorageKey::SignerSet, &new_signers);

        SignerRemoved { signer }.publish(&env);
    }

    /// Check if address is an authorized signer
    pub fn is_signer(env: Env, address: Address) -> bool {
        let signers: Vec<Address> = env
            .storage()
            .instance()
            .get(&StorageKey::SignerSet)
            .unwrap_or(Vec::new(&env));

        for i in 0..signers.len() {
            if signers.get(i).unwrap() == address {
                return true;
            }
        }
        false
    }

    /// Get all authorized signers
    pub fn get_signers(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&StorageKey::SignerSet)
            .unwrap_or(Vec::new(&env))
    }

    // ── Staleness Bound Management ────────────────────────────────

    /// Set staleness bound in seconds (admin only)
    pub fn set_staleness_bound(env: Env, seconds: u64) {
        if Self::is_paused(env.clone()) {
            panic!("Oracle is paused");
        }
        let admin: Address = Self::get_admin(env.clone());
        admin.require_auth();

        if seconds == 0 {
            panic!("Staleness bound must be > 0");
        }

        let old_bound: u64 = env
            .storage()
            .instance()
            .get(&StorageKey::StalenessBound)
            .unwrap_or(3600);

        env.storage()
            .instance()
            .set(&StorageKey::StalenessBound, &seconds);

        StalenessBoundUpdated {
            old_bound,
            new_bound: seconds,
        }
        .publish(&env);
    }

    /// Get current staleness bound
    pub fn get_staleness_bound(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&StorageKey::StalenessBound)
            .unwrap_or(3600)
    }

    // ── Rate Updates ──────────────────────────────────────────────

    /// Update FX rate (authorized signer only)
    pub fn update_rate(
        env: Env,
        base_currency: String,
        quote_currency: String,
        rate: i128,
        timestamp: u64,
        signer: Address,
    ) {
        if Self::is_paused(env.clone()) {
            panic!("Oracle is paused");
        }

        // Verify caller is authorized signer
        signer.require_auth();
        if !Self::is_signer(env.clone(), signer.clone()) {
            panic!("Unauthorized signer");
        }

        if rate <= 0 {
            panic!("Rate must be positive");
        }

        // Validate timestamp is not in the future (with 5 minute tolerance)
        let current_time = env.ledger().timestamp();
        if timestamp > current_time + 300 {
            panic!("Timestamp too far in future");
        }

        let rate_data = FxRateData {
            base_currency: base_currency.clone(),
            quote_currency: quote_currency.clone(),
            rate,
            timestamp,
            updated_ledger: env.ledger().sequence(),
            signer: signer.clone(),
        };

        let key = RatePairKey {
            base: base_currency.clone(),
            quote: quote_currency.clone(),
        };
        env.storage()
            .persistent()
            .set(&StorageKey::RateData(key), &rate_data);

        RateUpdated {
            base_currency,
            quote_currency,
            rate,
            timestamp,
            signer,
        }
        .publish(&env);
    }

    /// Get current rate for a currency pair
    pub fn get_rate(env: Env, base_currency: String, quote_currency: String) -> FxRateData {
        let key = RatePairKey {
            base: base_currency,
            quote: quote_currency,
        };
        env.storage()
            .persistent()
            .get(&StorageKey::RateData(key))
            .expect("Rate not found")
    }

    /// Validate rate is fresh and return it (used by renewal contract)
    /// Panics with descriptive message if validation fails
    pub fn validate_rate(
        env: Env,
        base_currency: String,
        quote_currency: String,
    ) -> FxRateData {
        if Self::is_paused(env.clone()) {
            panic!("Oracle is paused");
        }

        let key = RatePairKey {
            base: base_currency.clone(),
            quote: quote_currency.clone(),
        };
        let rate_opt: Option<FxRateData> = env
            .storage()
            .persistent()
            .get(&StorageKey::RateData(key));

        if rate_opt.is_none() {
            RateValidationFailed {
                base_currency: base_currency.clone(),
                quote_currency: quote_currency.clone(),
                reason: 1, // Not found
            }
            .publish(&env);
            panic!("Rate not found");
        }

        let rate_data = rate_opt.unwrap();

        // Check staleness
        let current_time = env.ledger().timestamp();
        let staleness_bound = Self::get_staleness_bound(env.clone());

        if current_time > rate_data.timestamp + staleness_bound {
            RateValidationFailed {
                base_currency,
                quote_currency,
                reason: 2, // Stale
            }
            .publish(&env);
            panic!("Rate is stale");
        }

        // Verify signer is still authorized
        if !Self::is_signer(env.clone(), rate_data.signer.clone()) {
            RateValidationFailed {
                base_currency,
                quote_currency,
                reason: 3, // Signer unauthorized
            }
            .publish(&env);
            panic!("Signer no longer authorized");
        }

        rate_data
    }

    /// Convert amount from base to quote currency using latest rate
    pub fn convert(
        env: Env,
        amount: i128,
        base_currency: String,
        quote_currency: String,
    ) -> i128 {
        let rate_data = Self::validate_rate(env, base_currency, quote_currency);
        
        // Rate has 8 decimal places, so divide by 100_000_000
        (amount * rate_data.rate) / 100_000_000
    }
}

#[cfg(test)]
mod test;
#[cfg(test)]
mod negative;

