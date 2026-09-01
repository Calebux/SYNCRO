#![no_std]

//! # Syncro Common Contract Utilities
//!
//! Shared utilities for all Syncro contracts, including:
//! - Version metadata management
//! - Error code registry offsets
//! - Interface version tracking

use soroban_sdk::{Env, Symbol};

// ============================================================================
// Version Management
// ============================================================================

/// Derives the contract version from build-time environment variables.
/// 
/// The version encodes:
/// - Major version (bits 24-31): Incremented on breaking ABI changes
/// - Minor version (bits 16-23): Incremented on new features (backward compatible)
/// - Patch version (bits 0-15): Incremented on bug fixes
///
/// Example: version 0x00010205 represents v1.2.5
///
/// At build time, this should be set from Cargo.toml version:
/// export SYNCRO_CONTRACT_VERSION=$(grep '^version' Cargo.toml | cut -d'"' -f2 | tr '.' '\0' | sed 's/\x00/,/g')
pub const fn contract_version() -> u32 {
    // Format: 0xMMmmPPPP (Major.minor.patch)
    // This is set at build time by the CI/CD pipeline
    // For development: use 0x00010000 (v1.0.0)
    env!("SYNCRO_CONTRACT_VERSION", "0x00010000")
        .parse::<u32>()
        .unwrap_or(0x00010000)
}

/// Interface version for cross-contract calls.
/// 
/// Incremented when public contract method signatures or error handling change.
/// Allows the backend to detect API mismatches at runtime.
pub const fn interface_version() -> u32 {
    // This tracks the contract's public interface version independently from
    // the implementation version. Increment when:
    // - Adding/removing public functions
    // - Changing function parameter types
    // - Changing error enums
    env!("SYNCRO_INTERFACE_VERSION", "1")
        .parse::<u32>()
        .unwrap_or(1)
}

/// Helper to expose version metadata on-chain.
/// 
/// # Example
/// ```rust,ignore
/// #[contractimpl]
/// impl MyContract {
///     pub fn version(env: Env) -> u32 {
///         syncro_common::version(&env)
///     }
///     
///     pub fn interface_version(env: Env) -> u32 {
///         syncro_common::interface_version(&env)
///     }
/// }
/// ```
pub fn version(_env: &Env) -> u32 {
    contract_version()
}

pub fn interface_version_call(_env: &Env) -> u32 {
    interface_version()
}

// ============================================================================
// Error Code Registry
// ============================================================================

/// Base error code for each contract.
/// 
/// Each contract uses a 100-code block to avoid discriminant collisions.
/// The registry is defined in contracts/ERROR_CODE_REGISTRY.md
///
/// Example: subscription_renewal uses base 1000, so errors range from 1000-1099
#[repr(u32)]
pub enum ContractErrorBase {
    SubscriptionRenewal = 1000,
    SubscriptionLogging = 1100,
    VirtualCard = 1200,
    Escrow = 1300,
    AgentRegistry = 1400,
    ZkPaymentVerifier = 1500,
    PaymentChannel = 1600,
    ContractUpgrade = 1700,
    Allowance = 1800,
    PaymentAdapter = 1900,
    VoucherLedger = 2000,
    FeeCollector = 2100,
    ResolverRegistry = 2200,
    SubscriptionRefund = 2300,
    RecurringAllowance = 2400,
    LoyaltyRewards = 2500,
    SubscriptionNft = 2600,
    Attestation = 2700,
    Guardian = 2800,
    FxOracle = 2900,
    PaymentSplitter = 3000,
    StealthAnnouncement = 3100,
}

impl ContractErrorBase {
    /// Convert a local error discriminant (1-based) to a global error code.
    ///
    /// # Arguments
    /// * `local_discriminant` - The error's discriminant within its contract (starts at 1)
    ///
    /// # Returns
    /// The global error code unique across all contracts
    ///
    /// # Example
    /// ```ignore
    /// // For escrow contract error discriminant 3
    /// let global_code = ContractErrorBase::Escrow.to_global_code(3);
    /// // Result: 1300 + (3 - 1) = 1302
    /// ```
    pub const fn to_global_code(self, local_discriminant: u32) -> u32 {
        (self as u32) + (local_discriminant.saturating_sub(1))
    }

    /// Decode a global error code back to (contract_base, local_discriminant).
    ///
    /// # Arguments
    /// * `global_code` - The combined error code
    ///
    /// # Returns
    /// * `Some((contract_base, local_discriminant))` if the code is in a valid range
    /// * `None` if the code doesn't map to a known contract
    pub fn from_global_code(global_code: u32) -> Option<(u32, u32)> {
        let base = (global_code / 100) * 100;
        let offset = global_code % 100;
        let discriminant = offset + 1;

        // Validate that this base corresponds to a known contract
        match base {
            1000 | 1100 | 1200 | 1300 | 1400 | 1500 | 1600 | 1700 | 1800 | 1900
            | 2000 | 2100 | 2200 | 2300 | 2400 | 2500 | 2600 | 2700 | 2800 | 2900
            | 3000 | 3100 => Some((base, discriminant)),
            _ => None,
        }
    }
}

// ============================================================================
// Emit Contract Event Helpers
// ============================================================================

/// Standard contract metadata event emitted on deployment/upgrade.
pub fn emit_contract_info(env: &Env, contract_name: &Symbol, version: u32, interface: u32) {
    env.events().publish(
        (Symbol::short("contract"), Symbol::short("info")),
        (contract_name, version, interface),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_code_conversion() {
        // Escrow base 1300 + discriminant 1 = 1300
        assert_eq!(ContractErrorBase::Escrow.to_global_code(1), 1300);

        // Escrow base 1300 + discriminant 5 = 1304
        assert_eq!(ContractErrorBase::Escrow.to_global_code(5), 1304);

        // Virtual-card base 1200 + discriminant 11 = 1210
        assert_eq!(ContractErrorBase::VirtualCard.to_global_code(11), 1210);
    }

    #[test]
    fn test_error_code_decoding() {
        let (base, disc) = ContractErrorBase::from_global_code(1304).unwrap();
        assert_eq!(base, 1300);
        assert_eq!(disc, 5);

        let (base, disc) = ContractErrorBase::from_global_code(1210).unwrap();
        assert_eq!(base, 1200);
        assert_eq!(disc, 11);

        // Invalid base should return None
        assert!(ContractErrorBase::from_global_code(999).is_none());
        assert!(ContractErrorBase::from_global_code(5000).is_none());
    }

    #[test]
    fn test_error_ranges() {
        // Verify each contract gets 100 codes
        assert_eq!(
            ContractErrorBase::SubscriptionRenewal as u32,
            1000
        );
        assert_eq!(ContractErrorBase::StealthAnnouncement as u32, 3100);

        // Spot check middle contract
        assert_eq!(ContractErrorBase::Allowance as u32, 1800);
    }
}
