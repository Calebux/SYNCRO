# FX Oracle Contract

## Overview

The FX Oracle contract provides on-chain foreign exchange rate validation for multi-currency subscription renewals. It addresses the security risk of relying on off-chain FX rate calculations by making rates verifiable on-chain with staleness bounds and authorized signer management.

## Problem Statement

Previously, multi-currency subscription totals relied entirely on off-chain FX rate calculations. This created risks:
- No on-chain verification of exchange rates used in renewals
- Potential for stale or manipulated rates
- No audit trail of which rates were used when

## Solution

The FX Oracle provides:
1. **On-chain rate storage** with timestamps
2. **Staleness bounds** - rates older than the bound are rejected
3. **Authorized signer set** - only approved addresses can update rates
4. **Rate validation** - subscription_renewal contract can verify rates are fresh
5. **Event emission** - full audit trail of rate updates and validations

## Architecture

```
┌─────────────────────┐
│  Backend Services   │
│  (Rate Feeders)     │
└──────────┬──────────┘
           │ update_rate()
           ▼
┌─────────────────────┐
│   FX Oracle         │
│   Contract          │
│                     │
│  - Signer Set       │
│  - Staleness Bound  │
│  - Rate Storage     │
└──────────┬──────────┘
           │ validate_rate()
           ▼
┌─────────────────────┐
│  Subscription       │
│  Renewal Contract   │
│                     │
│  - Multi-Currency   │
│  - FX Validation    │
└─────────────────────┘
```

## Key Features

### 1. Signer Management

- **add_signer(signer: Address)** - Admin only
- **remove_signer(signer: Address)** - Admin only
- **is_signer(address: Address)** - Check authorization
- **get_signers()** - List all authorized signers

Multiple signers can be authorized for redundancy and load distribution.

### 2. Staleness Bounds

- **set_staleness_bound(seconds: u64)** - Admin only
- **get_staleness_bound()** - Query current bound
- Default: 3600 seconds (1 hour)

Rates older than the staleness bound are automatically rejected during validation.

### 3. Rate Updates

- **update_rate(base_currency, quote_currency, rate, timestamp)**
  - Caller must be an authorized signer
  - Rate must be positive
  - Timestamp cannot be more than 5 minutes in the future
  - Rate stored with 8 decimal precision (e.g., 0.92 = 92,000,000)
  
### 4. Rate Validation

- **validate_rate(base_currency, quote_currency)** → Result<FxRateData, ErrorCode>
  - Returns fresh rate if available
  - Checks staleness bound
  - Verifies signer is still authorized
  - Error codes:
    - 1: Rate not found
    - 2: Rate is stale
    - 3: Signer no longer authorized

- **convert(amount, base_currency, quote_currency)** → Result<i128, ErrorCode>
  - Validates rate and performs conversion in one call

## Data Structures

### FxRateData

```rust
pub struct FxRateData {
    pub base_currency: String,
    pub quote_currency: String,
    pub rate: i128,          // 8 decimal places
    pub timestamp: u64,      // Unix timestamp when signed
    pub updated_ledger: u32, // Ledger when stored on-chain
    pub signer: Address,
}
```

### Rate Encoding

Rates use 8 decimal places for precision:
- 1.00 USD/EUR = 100,000,000
- 0.92 EUR/USD = 92,000,000
- 145.50 JPY/USD = 14,550,000,000

## Usage Example

### 1. Deploy and Initialize

```rust
// Deploy
let oracle_id = env.register_contract_wasm(None, fx_oracle_wasm);
let oracle = FxOracleContractClient::new(&env, &oracle_id);

// Initialize with admin
oracle.init(&admin);

// Add rate feeders
oracle.add_signer(&feeder1);
oracle.add_signer(&feeder2);

// Set staleness bound (2 hours)
oracle.set_staleness_bound(&7200);
```

### 2. Update Rates (Backend Service)

```rust
let base = String::from_str(&env, "USD");
let quote = String::from_str(&env, "EUR");
let rate = 92_000_000; // 0.92 EUR per USD
let timestamp = current_unix_time();

oracle.update_rate(&base, &quote, &rate, &timestamp);
```

### 3. Validate in Subscription Renewal

```rust
// In subscription_renewal contract
let rate_result = oracle_client.validate_rate(&base_currency, &quote_currency);

match rate_result {
    Ok(rate_data) => {
        // Use rate_data.rate for conversion
        let converted = (amount * rate_data.rate) / 100_000_000;
    },
    Err(reason) => {
        // Handle validation failure
        panic!("FX rate validation failed: {}", reason);
    }
}
```

## Events

### RateUpdated
```rust
pub struct RateUpdated {
    pub base_currency: String,
    pub quote_currency: String,
    pub rate: i128,
    pub timestamp: u64,
    pub signer: Address,
}
```

### RateValidationFailed
```rust
pub struct RateValidationFailed {
    pub base_currency: String,
    pub quote_currency: String,
    pub reason: u32, // 1=not found, 2=stale, 3=signer unauthorized
}
```

### SignerAdded / SignerRemoved
```rust
pub struct SignerAdded { pub signer: Address }
pub struct SignerRemoved { pub signer: Address }
```

### StalenessBoundUpdated
```rust
pub struct StalenessBoundUpdated {
    pub old_bound: u64,
    pub new_bound: u64,
}
```

## Security Considerations

1. **Signer Key Security**: Signer private keys must be secured. Compromise allows rate manipulation.

2. **Staleness Bound**: Set appropriately for your use case:
   - Too short: Frequent update failures
   - Too long: Risk of stale rates being accepted

3. **Rate Source**: Backend services should use reputable FX data providers with fallbacks.

4. **Admin Key**: Admin key can add/remove signers and change staleness bound. Use multi-sig or timelock.

5. **Pausing**: Contract can be paused by admin to halt all rate updates and validations during incidents.

## Testing

Run the comprehensive test suite:

```bash
cargo test --package fx-oracle
```

Key test scenarios:
- Signer authorization and removal
- Staleness bound enforcement
- Rate validation with fresh and stale data
- Multi-currency pair support
- Pause functionality
- Concurrent signer operations

## Integration with Subscription Renewal

The subscription_renewal contract has been extended with:

1. **Currency field** in SubscriptionData
2. **FX oracle contract address** configuration
3. **Automatic FX validation** when subscription currency != payment currency
4. **Events** for FX rate validation success/failure

See `subscription_renewal/MULTI_CURRENCY.md` for details.

## Backend Integration

Backend services need to:

1. Fetch rates from external providers (e.g., ExchangeRate-API, Frankfurter)
2. Sign and submit rate updates to oracle contract
3. Handle rate update failures with retries
4. Monitor rate freshness and alert on staleness

See `backend/docs/FX_ORACLE_INTEGRATION.md` for implementation guide.

## Future Enhancements

- [ ] Multi-signature rate updates (require N of M signers)
- [ ] Rate deviation bounds (reject rates too far from previous)
- [ ] Historical rate queries
- [ ] Automated rate expiry notifications
- [ ] Cross-rate validation (USD/EUR * EUR/GBP ≈ USD/GBP)
