# Partial Split Payout - Developer Guide

## Quick Reference

### Basis Points System
Partial splits use **basis points** (1 basis point = 0.01%):
- Range: `0` to `10000`
- `0` = 0.00% to payee
- `5000` = 50.00% to payee
- `7500` = 75.00% to payee
- `10000` = 100.00% to payee

### Common Split Scenarios

| Split | Payee % | Payer % | Basis Points |
|-------|---------|---------|--------------|
| Full payee | 100% | 0% | 10000 |
| Mostly payee | 90% | 10% | 9000 |
| Mostly payee | 75% | 25% | 7500 |
| Mostly payee | 60% | 40% | 6000 |
| Even split | 50% | 50% | 5000 |
| Mostly payer | 40% | 60% | 4000 |
| Mostly payer | 25% | 75% | 2500 |
| Mostly payer | 10% | 90% | 1000 |
| Full payer | 0% | 100% | 0 |

## Usage Examples

### Example 1: Even Split (50/50)
```rust
// Scenario: Both parties share blame equally
escrow.resolve_dispute(
    &escrow_id,
    &DisputeResolution::PartialSplit(5000)
);
// Result: 50% to payee, 50% to payer
```

### Example 2: Mostly Payee (75/25)
```rust
// Scenario: Service partially delivered, payee deserves most
escrow.resolve_dispute(
    &escrow_id,
    &DisputeResolution::PartialSplit(7500)
);
// Result: 75% to payee, 25% to payer
```

### Example 3: Mostly Payer (25/75)
```rust
// Scenario: Service significantly deficient, payer deserves refund
escrow.resolve_dispute(
    &escrow_id,
    &DisputeResolution::PartialSplit(2500)
);
// Result: 25% to payee, 75% to payer
```

### Example 4: Full Resolution Options
```rust
// Option A: Release everything to payee
escrow.resolve_dispute(
    &escrow_id,
    &DisputeResolution::ReleaseToPayee
);

// Option B: Refund everything to payer
escrow.resolve_dispute(
    &escrow_id,
    &DisputeResolution::RefundToPayer
);

// Option C: Custom split
escrow.resolve_dispute(
    &escrow_id,
    &DisputeResolution::PartialSplit(6543) // 65.43% to payee
);
```

## Percentage to Basis Points Conversion

### Formula
```
basis_points = percentage * 100
```

### Examples
```rust
// 33.33% to payee
let basis_points = 3333u32;

// 66.67% to payee  
let basis_points = 6667u32;

// 12.5% to payee
let basis_points = 1250u32;

// 87.5% to payee
let basis_points = 8750u32;
```

### Helper Function (Off-chain)
```rust
fn percentage_to_basis_points(percentage: f64) -> u32 {
    (percentage * 100.0).round() as u32
}

// Usage
let bp = percentage_to_basis_points(75.0);  // 7500
let bp = percentage_to_basis_points(33.33); // 3333
```

## How It Works Internally

### Calculation Process
1. **Validate** basis points ≤ 10000
2. **Calculate payee amount**: `(total × basis_points) / 10000`
3. **Calculate payer amount**: `total - payee_amount`
4. **Transfer** funds to both parties (if > 0)

### Integer Division Precision
Due to integer division, some precision may be lost:

```rust
// Example: 999,999 tokens split at 33.33%
total = 999_999
payee_bp = 3333

payee_amount = (999_999 × 3333) / 10000 = 333,299
payer_amount = 999_999 - 333_299 = 666,700

// Note: 333,299 / 999,999 = 33.3293% (close to 33.33%)
```

The payer always receives any remainder from integer division, ensuring total conservation.

## Error Handling

### Invalid Basis Points
```rust
// This will panic with InvalidBasisPoints error
escrow.resolve_dispute(
    &escrow_id,
    &DisputeResolution::PartialSplit(10001) // > 10000
);
```

### Arithmetic Overflow (Theoretical)
For extremely large amounts, overflow protection is built-in:
```rust
// Protected by checked arithmetic
// Will panic with ArithmeticOverflow if calculation overflows i128
```

## Best Practices

### 1. Document Your Rationale
```rust
// Good: Clear reasoning
// Payee delivered 80% of the project requirements
escrow.resolve_dispute(&id, &DisputeResolution::PartialSplit(8000));

// Bad: No context
escrow.resolve_dispute(&id, &DisputeResolution::PartialSplit(8000));
```

### 2. Consider Standard Splits
For consistency, use common percentages:
- 25% increments: 2500, 5000, 7500, 10000
- 10% increments: 1000, 2000, 3000, etc.
- 33/66 splits: 3333, 6667

### 3. Round Appropriately
When converting percentages:
```rust
// Round to nearest basis point
let bp = (percentage * 100.0).round() as u32;

// NOT truncate
let bp = (percentage * 100.0) as u32; // May lose 0.5%+
```

### 4. Validate Before Calling
```rust
fn validate_basis_points(bp: u32) -> Result<(), Error> {
    if bp > 10000 {
        return Err(Error::InvalidBasisPoints);
    }
    Ok(())
}
```

## Testing Your Integration

### Unit Test Template
```rust
#[test]
fn test_my_custom_split() {
    // Setup
    let (env, payer, payee, arbiter, token, token_client) = setup();
    let escrow = register_escrow(&env);
    
    // Create and fund escrow
    let amount = 1_000_000i128;
    let id = create_and_fund_escrow(/* ... */);
    
    // Raise dispute
    escrow.raise_dispute(&id, &payer);
    
    // Record balances before
    let payer_before = token_client.balance(&payer);
    let payee_before = token_client.balance(&payee);
    
    // Resolve with your split
    escrow.resolve_dispute(&id, &DisputeResolution::PartialSplit(7500));
    
    // Verify
    let payer_after = token_client.balance(&payer);
    let payee_after = token_client.balance(&payee);
    
    assert_eq!(payee_after - payee_before, 750_000i128);
    assert_eq!(payer_after - payer_before, 250_000i128);
    
    // Verify conservation
    assert_eq!(
        (payee_after - payee_before) + (payer_after - payer_before),
        amount
    );
}
```

## Real-World Use Cases

### Use Case 1: Freelance Work Dispute
**Scenario:** Developer delivered 3 out of 4 milestones  
**Resolution:** 75% to developer (payee), 25% back to client (payer)  
**Code:** `DisputeResolution::PartialSplit(7500)`

### Use Case 2: Product Quality Issue
**Scenario:** Product shipped but had defects, partial refund warranted  
**Resolution:** 40% to seller (payee), 60% back to buyer (payer)  
**Code:** `DisputeResolution::PartialSplit(4000)`

### Use Case 3: Service Cancellation
**Scenario:** Service provider did initial work before cancellation  
**Resolution:** 30% to provider for work done, 70% back to client  
**Code:** `DisputeResolution::PartialSplit(3000)`

### Use Case 4: Subscription Dispute  
**Scenario:** Service used for 2 out of 12 months before dispute  
**Resolution:** 16.67% to provider (2/12), 83.33% back to subscriber  
**Code:** `DisputeResolution::PartialSplit(1667)`

## Monitoring and Analytics

### Track Split Distribution
```rust
// Event emitted on resolution
EscrowResolved {
    escrow_id: 123,
    resolution: DisputeResolution::PartialSplit(7500),
    payee_amount: 750_000,
    payer_amount: 250_000,
}
```

### Query Historical Resolutions
Use the event log to analyze:
- Most common split percentages
- Average payout ratios
- Dispute resolution patterns
- Arbiter decision trends

## Additional Resources

- Main Contract: `contracts/escrow/src/lib.rs`
- Implementation Details: `DISPUTE_RESOLUTION_IMPLEMENTATION.md`
- Test Examples: `contracts/escrow/src/lib.rs` (test module)
- Fuzz Tests: `contracts/escrow/src/fuzz.rs`
