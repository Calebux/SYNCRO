# Global Contract Error Code Registry

## Overview
This document defines the global, non-overlapping error code ranges for all SYNCRO contracts. Each contract is allocated a 100-code block to prevent discriminant collisions when errors are surfaced across contract boundaries.

## Error Code Allocation

| Contract                  | Range      | Base | Max | Description |
|---------------------------|-----------|------|-----|-------------|
| subscription_renewal      | 1000-1099 | 1000 | 99  | Subscription renewal logic |
| subscription_logging      | 1100-1199 | 1100 | 99  | Event logging |
| virtual-card              | 1200-1299 | 1200 | 99  | Virtual card management |
| escrow                    | 1300-1399 | 1300 | 99  | Escrow agreement handling |
| agent-registry            | 1400-1499 | 1400 | 99  | Agent registry & permissions |
| zk-payment-verifier       | 1500-1599 | 1500 | 99  | Zero-knowledge proof verification |
| payment-channel           | 1600-1699 | 1600 | 99  | Payment channel operations |
| contract-upgrade          | 1700-1799 | 1700 | 99  | Contract upgrade governance |
| allowance                 | 1800-1899 | 1800 | 99  | Recurring allowance management |
| payment-adapter           | 1900-1999 | 1900 | 99  | Payment adapter |
| voucher-ledger            | 2000-2099 | 2000 | 99  | Voucher ledger |
| fee-collector             | 2100-2199 | 2100 | 99  | Fee collection |
| resolver-registry         | 2200-2299 | 2200 | 99  | Resolver registry |
| subscription_refund       | 2300-2399 | 2300 | 99  | Subscription refund logic |
| recurring_allowance       | 2400-2499 | 2400 | 99  | Recurring allowance (legacy) |
| loyalty_rewards           | 2500-2599 | 2500 | 99  | Loyalty rewards |
| subscription_nft          | 2600-2699 | 2600 | 99  | Subscription NFT |
| attestation               | 2700-2799 | 2700 | 99  | Attestation service |
| guardian                  | 2800-2899 | 2800 | 99  | Guardian authority |
| fx-oracle                 | 2900-2999 | 2900 | 99  | FX oracle |
| payment-splitter          | 3000-3099 | 3000 | 99  | Payment splitter |
| stealth-announcement      | 3100-3199 | 3100 | 99  | Stealth payment announcements |

**Total Capacity**: 22 contracts × 100 codes = 2200 codes available (1000-3199)

## Conversion Formula

For a contract at base code B with original error discriminant D:
```
new_discriminant = B + (D - 1)
```

Example:
- `subscription_renewal::SubscriptionError::InvalidSubscription = 5` (original)
- Base = 1000
- New code = 1000 + (5 - 1) = 1004

## Benefits

1. **Unambiguous Error Identification**: An error code uniquely identifies both the contract AND the variant
2. **Scalability**: Each contract has room for ~99 errors (realistic for most contracts)
3. **Backwards Compatible Externally**: Off-chain callers see unique codes; on-chain code remains readable
4. **Version Traceability**: Combined with version metadata, enables rollback decision-making

## Error Serialization

When a contract error is returned via cross-contract calls:
```
ErrorCode = ContractBase + (VariantIndex - 1)
```

When decoding:
```
ContractBase = (ErrorCode / 100) * 100
VariantIndex = (ErrorCode % 100) + 1
```

## Validation

All contracts MUST:
1. Use error codes within their allocated range
2. Be verified by integration tests that check for overlaps
3. Include a `contracts/errors.json` that maps codes to variant names
