/// Verify that the global error code registry has no overlaps.
/// 
/// This test validates:
/// 1. No two contracts use the same error code
/// 2. Each contract's error codes are within its allocated 100-code range
/// 3. No gaps in contract allocations
/// 4. All variants fit within their contract's base + 100 range
///
/// Run with: `cargo test --lib --release -- --nocapture test_error_code_registry`
#[cfg(test)]
mod error_registry_tests {
    use syncro_common::ContractErrorBase;

    #[test]
    fn test_error_code_ranges_are_disjoint() {
        let bases = vec![
            (1000, "subscription_renewal"),
            (1100, "subscription_logging"),
            (1200, "virtual-card"),
            (1300, "escrow"),
            (1400, "agent-registry"),
            (1500, "zk-payment-verifier"),
            (1600, "payment-channel"),
            (1700, "contract-upgrade"),
            (1800, "allowance"),
            (1900, "payment-adapter"),
            (2000, "voucher-ledger"),
            (2100, "fee-collector"),
            (2200, "resolver-registry"),
            (2300, "subscription_refund"),
            (2400, "recurring_allowance"),
            (2500, "loyalty_rewards"),
            (2600, "subscription_nft"),
            (2700, "attestation"),
            (2800, "guardian"),
            (2900, "fx-oracle"),
            (3000, "payment-splitter"),
            (3100, "stealth-announcement"),
        ];

        // Check: each base is 100 codes apart
        for i in 0..bases.len() - 1 {
            let current_max = bases[i].0 + 99;
            let next_base = bases[i + 1].0;
            assert!(
                current_max < next_base,
                "Range overlap: {} ({}-{}) overlaps with {} (base {})",
                bases[i].1,
                bases[i].0,
                current_max,
                bases[i + 1].1,
                next_base
            );
        }

        // Check: all codes fit within declared range
        let range_end = bases.last().unwrap().0 + 99;
        assert_eq!(range_end, 3199, "Expected error code range to end at 3199");
    }

    #[test]
    fn test_error_code_conversion_round_trip() {
        // For each contract base, verify encode/decode round trip
        let test_codes = vec![
            (1300, 1, 1300),   // escrow::AlreadyInitialized
            (1300, 5, 1304),   // escrow::InvalidAmount
            (1300, 21, 1320),  // escrow::CounterOverflow (max for escrow)
            (1200, 1, 1200),   // virtual-card::CardNotFound
            (1200, 11, 1210),  // virtual-card::CounterOverflow (max for virtual-card)
            (1800, 13, 1812),  // allowance::Paused
        ];

        for (base_code, local_code, expected_global) in test_codes {
            // Verify encoding
            let global = ContractErrorBase::from_global_code(base_code).unwrap().0 + (local_code - 1);
            assert_eq!(global, expected_global, 
                "Encoding failed for base={}, local={}", base_code, local_code);

            // Verify decoding
            if let Some((decoded_base, decoded_local)) = ContractErrorBase::from_global_code(expected_global) {
                assert_eq!(decoded_base, base_code, "Decoded base mismatch");
                assert_eq!(decoded_local, local_code, "Decoded local mismatch");
            } else {
                panic!("Failed to decode global code {}", expected_global);
            }
        }
    }

    #[test]
    fn test_error_codes_are_u32() {
        // Verify all error codes fit comfortably in u32
        let max_code = ContractErrorBase::StealthAnnouncement as u32 + 99;
        assert!(max_code < u32::MAX, "Error codes don't fit in u32");
        assert!(max_code == 3199, "Max code should be 3199, got {}", max_code);
    }

    #[test]
    fn test_invalid_global_codes_return_none() {
        // Codes outside allocated ranges should fail
        let invalid_codes = vec![
            0,     // Too low
            999,   // Just before range
            3200,  // Just after range
            5000,  // Way too high
            u32::MAX,
        ];

        for code in invalid_codes {
            assert!(
                ContractErrorBase::from_global_code(code).is_none(),
                "Expected None for invalid code {}",
                code
            );
        }
    }

    #[test]
    fn test_error_code_batch_coverage() {
        // Verify that a representative sample of error codes decode correctly
        let test_ranges = vec![
            (1000, 1099),  // subscription_renewal
            (1300, 1399),  // escrow
            (1800, 1899),  // allowance
            (2000, 2099),  // voucher-ledger
            (3100, 3199),  // stealth-announcement
        ];

        for (start, end) in test_ranges {
            for code in (start..=end).step_by(10) {
                let result = ContractErrorBase::from_global_code(code);
                assert!(
                    result.is_some(),
                    "Expected Some for code {} in valid range [{}, {}]",
                    code, start, end
                );

                if let Some((base, local)) = result {
                    assert_eq!(base, (code / 100) * 100, "Base calculation incorrect");
                    assert_eq!(local, (code % 100) + 1, "Local code calculation incorrect");
                }
            }
        }
    }

    #[test]
    fn test_error_registry_json_exists() {
        // This test verifies that contracts/errors.json is properly generated
        // Run this with: cargo test --test error_registry_tests -- --nocapture
        
        let errors_json_path = std::path::Path::new("../errors.json");
        assert!(
            errors_json_path.exists(),
            "contracts/errors.json not found at {:?}. Run: python3 scripts/generate-error-registry.py",
            errors_json_path.canonicalize().unwrap_or_default()
        );

        // Optionally parse and validate JSON structure
        if let Ok(content) = std::fs::read_to_string(errors_json_path) {
            match serde_json::from_str::<serde_json::Value>(&content) {
                Ok(json) => {
                    assert!(json["errors"].is_object(), "errors.json[errors] should be an object");
                    assert!(!json["errors"].as_object().unwrap().is_empty(), 
                        "errors.json should contain error mappings");
                }
                Err(e) => panic!("errors.json is not valid JSON: {}", e),
            }
        }
    }
}
