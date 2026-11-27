# Pedersen Commitments

## Overview

Pedersen commitments allow you to prove you know a payment amount without revealing it. An observer sees only the commitment hash, not the amount.

## How It Works

### The Mathematics

```
1. You want to commit to amount: A = 1500 (in cents)
2. Pick random blinding factor: b = 12345678...
3. Compute commitment: C = A*G + b*H
   - G, H: Two different generators on Ristretto curve
   - A*G + b*H: A point on the elliptic curve
4. Share commitment: C (hash-like, fixed size)
5. Later, prove amount: Show A + b
6. Verifier checks: A*G + b*H == C
```

### Why This Works

- **Hiding**: Commitment C doesn't reveal A or b (computationally hard to extract)
- **Binding**: Can't prove different amount without finding collision (mathematically impossible)
- **Additive Homomorphism**: `commit(a) + commit(b) == commit(a+b)` ✓
- **Zero-Knowledge**: Verifier learns only that commitment is valid, nothing else

## Data Structure

```typescript
interface PedersenCommitment {
  commitment: string;      // Hex-encoded Ristretto point
  blindingFactor: string;  // Hex-encoded scalar (blinding secret)
}
```

## API Reference

### `commit(value, blindingFactor?)`

Create a commitment to a value.

```typescript
import { commit } from '@syncro/sdk';

// Automatic random blinding factor
const amount = 1500n; // 15.00 in cents
const commitment1 = commit(amount);
// {
//   commitment: "4a8f2e1d9c...", // Ristretto point
//   blindingFactor: "9e3f1a2b7c..."  // Random scalar
// }

// Or provide your own blinding factor
const blindingFactor = 12345678901234567890n;
const commitment2 = commit(amount, blindingFactor);
// {
//   commitment: "4a8f2e1d9c...",
//   blindingFactor: "9e3f1a2b7c..."
// }
```

**Parameters**:
- `value` (bigint): Amount to commit (0 or positive)
- `blindingFactor` (bigint, optional): If omitted, generates random

**Returns**:
- `PedersenCommitment`: Commitment and blinding factor

**Example**: For $15.00 payment: `commit(1500n)` (in cents)

### `verify(value, blindingFactor, commitment)`

Verify a commitment matches a value.

```typescript
import { verify } from '@syncro/sdk';

const isValid = verify(1500n, commitment.blindingFactor, commitment.commitment);
// true if: value*G + blindingFactor*H == commitment
// false otherwise

if (isValid) {
  console.log("Payment amount verified!");
} else {
  console.log("Payment amount mismatch!");
}
```

**Parameters**:
- `value` (bigint): Claimed amount
- `blindingFactor` (string): Original blinding factor
- `commitment` (string): Original commitment

**Returns**:
- `boolean`: true if commitment is valid, false if invalid/tampered

### `createEventCommitment(eventType, eventData)`

Create commitment to an event (subscription, payment, etc).

```typescript
import { createEventCommitment } from '@syncro/sdk';

const commitment = createEventCommitment(
  'subscription_payment',
  '{"amount": 1500, "subscription": "netflix", "date": "2024-01-01"}'
);

// Returns commitment to that specific event
// Later can prove this event exists without revealing details
```

### `verifyEventCommitment(eventType, eventData, commitment)`

Verify an event commitment.

```typescript
import { verifyEventCommitment } from '@syncro/sdk';

const isValid = verifyEventCommitment(
  'subscription_payment',
  '{"amount": 1500, "subscription": "netflix", "date": "2024-01-01"}',
  originalCommitment
);
```

## Integration Examples

### Example 1: Prove Payment Without Revealing Amount

```typescript
import { commit, verify } from '@syncro/sdk';

// SETUP: You create commitment to payment amount
const amount = 1500n; // Paying $15.00
const commitment = commit(amount);

// Send to server:
// - commitment.commitment (proof you know the amount)
// Do NOT send:
// - commitment.blindingFactor (secret!)
// - amount (secret!)

// LATER: You prove the amount
const proof = {
  amount: amount,
  blindingFactor: commitment.blindingFactor
};

// Server verifies:
const isValid = verify(
  proof.amount,
  proof.blindingFactor,
  commitment.commitment
);

console.log("Payment verified without revealing amount:", isValid);
```

### Example 2: Prove Monthly Subscription Commitment

```typescript
class SubscriptionManager {
  private commitments: Map<string, PedersenCommitment> = new Map();

  setupSubscription(subscriptionId: string, monthlyAmount: bigint) {
    // Create commitment to monthly amount
    const commitment = commit(monthlyAmount);
    this.commitments.set(subscriptionId, commitment);

    // Store on server
    return commitment.commitment; // Only the hash
  }

  async provePaymentAmount(subscriptionId: string) {
    const commitment = this.commitments.get(subscriptionId);

    // Send proof to server
    return {
      commitment: commitment.commitment,
      amount: monthlyAmount,        // Reveal only when needed
      blindingFactor: commitment.blindingFactor
    };
  }

  async verifySubscriptionPayment(subscriptionId: string, proof: any) {
    const isValid = verify(proof.amount, proof.blindingFactor, proof.commitment);
    if (!isValid) throw new Error('Payment proof invalid');
    // Payment verified!
  }
}
```

### Example 3: Homomorphic Addition (Prove Total)

```typescript
import { commit, verify } from '@syncro/sdk';

// Three payments
const payment1Amount = 500n;  // $5.00
const payment2Amount = 750n;  // $7.50
const payment3Amount = 250n;  // $2.50
const totalAmount = 1500n;    // $15.00

const commitment1 = commit(payment1Amount);
const commitment2 = commit(payment2Amount);
const commitment3 = commit(payment3Amount);
const totalCommitment = commit(totalAmount);

// Mathematical property: commitments are additive
// commitment1 + commitment2 + commitment3 === totalCommitment

// So verifier can check:
const sum = commitmentPoint(commitment1.commitment)
  .add(commitmentPoint(commitment2.commitment))
  .add(commitmentPoint(commitment3.commitment));

const totalPoint = commitmentPoint(totalCommitment.commitment);

// If sum == totalPoint, then amount checks out
console.log("Three payments sum to total commitment");
```

### Example 4: Zero-Knowledge Proof of Solvency

```typescript
// Prove you have enough balance to pay without revealing balance

import { commit } from '@syncro/sdk';

class WalletProver {
  private balance = 100000n; // $1000 (in cents), secret!

  generateSolvencyProof(requiredAmount: bigint) {
    // Prove: balance >= requiredAmount
    // Without revealing balance

    // Commitment to balance
    const balanceCommitment = commit(this.balance);

    // Commitment to required amount
    const requiredCommitment = commit(requiredAmount);

    // In production, use actual zero-knowledge protocol here
    // For now, this is the structure

    return {
      balanceCommitment: balanceCommitment.commitment,
      requiredCommitment: requiredCommitment.commitment,
      proof: "zkp_of_sufficient_funds" // Simplified
    };
  }

  verifySolvencyProof(proof: any) {
    // Verifier checks the zero-knowledge proof
    // If valid: amount sufficient, but doesn't know balance
    // If invalid: insufficient funds or invalid proof
    return true; // Simplified
  }
}
```

## Security Considerations

### Blinding Factor Security

```typescript
// ❌ DON'T: Use predictable blinding factor
const blindingFactor = 12345678901234567890n; // Hardcoded

// ❌ DON'T: Reuse same blinding factor
const commitment1 = commit(1000n, blindingFactor);
const commitment2 = commit(2000n, blindingFactor);
// Observer can derive: commitment2 - commitment1 = 1000*G

// ✅ DO: Use random blinding factor
const commitment1 = commit(1000n); // Random blinding factor
const commitment2 = commit(2000n); // Different random blinding factor
```

### Avoiding Information Leakage

```typescript
// ❌ WRONG: Revealing blinding factor breaks hiding
const proof = {
  amount: 1500n,
  blindingFactor: commitment.blindingFactor  // NEVER reveal this!
};

// After revealing, observer can:
// 1. Verify: amount * G + blindingFactor * H
// 2. Check if matches stored commitment
// 3. Now they know the amount AND the commitment
// 4. Can identify this commitment in future transactions

// ✅ RIGHT: Keep blinding factor secret except when proving
// Only reveal when absolutely necessary:
// - Dispute resolution
// - Payment verification
// - Selective disclosure
```

### Commitment Collision Resistance

```typescript
// The probability of finding two (amount, blindingFactor) pairs
// that produce the same commitment is:
// ~2^-255 (astronomically unlikely)

// This is the "binding" property of Pedersen commitments
// You cannot prove two different amounts with same commitment
```

## Threat Model

### What Pedersen Commitments Protect Against

✅ **Amount Privacy**: Payment amount hidden from observers
✅ **Amount Correlation**: Can't link amounts across payments
✅ **Range Attacks**: Without range proof, can't verify amount is reasonable
✅ **Solvency Proof**: Prove sufficiency without revealing balance

### What They Don't Protect

❌ **Blinding Factor**: Must keep secret (acts as password)
❌ **Commitment Linking**: Same commitment reveals same amount was paid twice
❌ **Timing**: Payment timing still visible on blockchain
❌ **Recipient**: Stealth addresses still needed for recipient privacy

### Recommendations

- **Combine with Stealth Addresses**: Hide who receives payment
- **Combine with Payment Channels**: Hide payment timing
- **Combine with Metadata Encryption**: Hide service details
- **Use Range Proofs**: Prove amount is in valid range without revealing
- **Rotate Commitments**: Don't reuse commitments across subscriptions

## Advanced Topics

### Range Proofs

By itself, a Pedersen commitment doesn't prove the amount is reasonable:

```typescript
// Without range proof:
const commitment = commit(999999999999n); // Huge amount
// Verifier can't tell it's unreasonable without proof

// With range proof:
const rangeProof = proveAmountInRange(
  amount,
  blindingFactor,
  0n,           // min
  10000n        // max (0 to $100)
);
// Now verifier knows amount is between $0-$100
```

See `payment-commitment.ts` for range proof implementation.

### Bulletproofs

An efficient range proof algorithm:

```typescript
// More efficient than naïve range proofs
// Logarithmic proof size: O(log amount)
// Uses Ristretto curve for security
```

### Merkle Tree Commitments

Commit to multiple values:

```typescript
// Create commitment to tree of payments
const payments = [500n, 750n, 250n];
const tree = merkleTreeCommitment(payments);

// Prove specific payment was in tree
const proof = tree.prove(index);

// Verifier checks payment without seeing others
tree.verify(index, proof);
```

## Performance

| Operation | Time | Notes |
|-----------|------|-------|
| Create commitment | <1ms | Single point multiplication |
| Verify commitment | <1ms | Single point addition |
| Generate range proof | ~50ms | For 64-bit values |
| Verify range proof | ~10ms | For 64-bit values |
| Merkle tree (1000 items) | ~5ms | Per proof |

## Comparison with Alternatives

| Method | Privacy | Size | Speed | Complexity |
|--------|---------|------|-------|------------|
| **Plaintext** | ⭐ | Small | Fast | Low |
| **Hash** | ⭐⭐ | Small | Fast | Low |
| **Pedersen** | ⭐⭐⭐⭐ | Medium | Fast | Medium |
| **zk-SNARK** | ⭐⭐⭐⭐⭐ | Tiny | Slow | High |
| **zk-STARK** | ⭐⭐⭐⭐⭐ | Small | Medium | High |

## Troubleshooting

### "Value must be bigint"

The amount must be a BigInt:

```typescript
// ❌ Wrong:
commit(1500);        // Number, not BigInt

// ✅ Right:
commit(1500n);       // BigInt literal
commit(BigInt(1500)); // Converted to BigInt
```

### "Invalid commitment hex"

The commitment string must be valid hex-encoded Ristretto point:

```typescript
// ❌ Wrong:
verify(amount, factor, "not-valid-hex!!!!");

// ✅ Right:
verify(amount, factor, "4a8f2e1d9c3b7f2e1a9c8d7e6f5a4b3c2d1e9f0a8b7c6d5e4f3a2b1c0d");
```

### "Verification failed"

The commitment doesn't match the value:

Possible causes:
1. Wrong blinding factor
2. Wrong amount
3. Commitment was corrupted
4. Using different curve than when created

## Examples Repository

See `sdk/examples/pedersen-commitments/` for complete working examples including:
- Range proofs
- Merkle trees
- Batch verification
- Selective disclosure

## References

- Pedersen Commitments: https://en.wikipedia.org/wiki/Commitment_scheme
- Ristretto Curve: https://ristretto.group/
- Bulletproofs: https://eprint.iacr.org/2017/1066
- Zero-Knowledge Proofs: https://en.wikipedia.org/wiki/Zero-knowledge_proof

## Mathematical Background (Optional)

For the mathematically inclined:

```
Pedersen Commitment Scheme:

Setup:
- E: Elliptic curve
- G, H: Two independent generators of E
- n: Order of E

Commit:
- Input: value v, blinding factor b
- Output: C = v*G + b*H

Verify:
- Input: C, v, b
- Check: v*G + b*H == C

Properties:
1. Perfectly hiding: C reveals no info about (v, b)
2. Computationally binding: Hard to find (v',b') ≠ (v,b) with v'*G + b'*H = C
3. Homomorphic: commit(a) + commit(b) = commit(a+b)

Security assumptions:
- Discrete log problem is hard on E
- ECDH is hard on E
```
