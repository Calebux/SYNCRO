# Stealth Addresses

## Overview

Stealth addresses enable one-time, unlinkable payment addresses. Each payment goes to a unique address, preventing observers from linking payments together or to your wallet.

## How It Works

### The Protocol

```
1. You create a Stealth Meta-Address:
   - Spending Public Key (S): Only you can spend payments
   - Viewing Public Key (V): Only you can see payments

2. Payer generates one-time address:
   - Picks random ephemeral key (r)
   - Computes Ephemeral Pubkey (R) = r*G (publish in transaction)
   - Computes shared secret = r*V (using ECDH)
   - Derives one-time address = S + hash(shared secret)*G
   - Sends payment to one-time address

3. You discover payments:
   - Read R from transaction memo
   - Compute shared secret = private(V) * R
   - Derive one-time address = S + hash(shared secret)*G
   - Verify payment received at that address
```

### Why This Works

- **Payer learns**: Only the one-time address (unique per payment)
- **Observer sees**: R (ephemeral pubkey) but can't compute shared secret
- **You learn**: All payments via your private viewing key
- **Result**: Payments are completely unlinkable on-chain

## API Reference

### `generateStealthMetaAddress()`

Generate a new stealth identity (meta-address).

```typescript
import { generateStealthMetaAddress } from '@syncro/sdk';

const meta = generateStealthMetaAddress();
// Returns:
// {
//   viewPublicKey: "02a1b2c3...", // Compressed secp256k1 point (hex)
//   spendPublicKey: "03d4e5f6...", // Compressed secp256k1 point (hex)
//   encoded: "syncro:stealth:v1:02a1b2c3...:03d4e5f6..."
// }

// Share the encoded meta-address with payers
console.log("Your stealth address:", meta.encoded);
```

**Returns**:
- `viewPublicKey` (string): Your viewing key (hex)
- `spendPublicKey` (string): Your spending key (hex)
- `encoded` (string): Versioned meta-address for sharing

### `deriveEphemeralStealthAddress(metaAddress, entropy)`

Generate one-time payment address from a meta-address.

```typescript
import { deriveEphemeralStealthAddress } from '@syncro/sdk';

const entropy = `${subscriptionId}:${paymentIndex}`;
const result = deriveEphemeralStealthAddress(
  {
    viewPublicKey: meta.viewPublicKey,
    spendPublicKey: meta.spendPublicKey
  },
  entropy
);

// Returns:
// {
//   ephemeralPubkey: "02r1r2r3...",  // Publish in transaction
//   stealthAddress: "02s1s2s3..."   // Recipient for payment
// }
```

**Parameters**:
- `metaAddress`: Object with `viewPublicKey` and `spendPublicKey`
- `entropy`: Unique string per payment (e.g., subscriptionId:index)

**Returns**:
- `ephemeralPubkey` (string): Publish in transaction memo
- `stealthAddress` (string): Send payment to this address

### `deriveStealthAddress(metaAddress, subscriptionId, index)`

Deterministic stealth address for a subscription cycle.

```typescript
import { deriveStealthAddress } from '@syncro/sdk';

const address = deriveStealthAddress(
  {
    viewPublicKey: meta.viewPublicKey,
    spendPublicKey: meta.spendPublicKey
  },
  'sub-123-abc',  // subscriptionId
  0                // payment index
);

console.log("Stealth address for payment #0:", address);
```

**Parameters**:
- `metaAddress`: Object with viewing and spending keys
- `subscriptionId`: Unique subscription identifier
- `index`: Payment number (0 for first, 1 for second, etc.)

**Returns**:
- `address` (string): Deterministic one-time address

## Integration Examples

### Example 1: Share Your Stealth Address

```typescript
// Step 1: Generate stealth identity
const meta = generateStealthMetaAddress();

// Step 2: Save privately (only you need this)
localStorage.setItem('stealth_meta', JSON.stringify(meta));

// Step 3: Share with payers
const stealthAddressToShare = meta.encoded;
// "syncro:stealth:v1:02a1b2c3...:03d4e5f6..."

// Send this to your Netflix subscription payments, etc.
```

### Example 2: Receive Payments

```typescript
// When Netflix sends your monthly payment:
const stealthAddress = deriveEphemeralStealthAddress(
  meta,
  'netflix-sub:month-0' // First payment
);

// Netflix sends payment to: stealthAddress
// And includes ephemeralPubkey in transaction memo

// You later discover it via the ephemeralPubkey in the ledger
console.log("Received payment at:", stealthAddress);
```

### Example 3: Full Payment Cycle

```typescript
import { generateStealthMetaAddress, deriveEphemeralStealthAddress } from '@syncro/sdk';

// SETUP: Generate once, share publicly
const meta = generateStealthMetaAddress();
console.log("Your payment address:", meta.encoded);

// PAYMENT 1: Generate one-time address
const payment1 = deriveEphemeralStealthAddress(meta, 'netflix:payment-0');
// Send payment to: payment1.stealthAddress
// Memo includes: payment1.ephemeralPubkey

// PAYMENT 2: Generate different one-time address
const payment2 = deriveEphemeralStealthAddress(meta, 'netflix:payment-1');
// Send payment to: payment2.stealthAddress
// Memo includes: payment2.ephemeralPubkey

// Observer sees: 3 unrelated transactions
// You see: 2 payments to the same subscription
```

### Example 4: Derive Multiple Payments for One Subscription

```typescript
// For a subscription with 12 monthly payments, pre-generate addresses
const subscriptionId = 'netflix-2024';
const addresses = [];

for (let i = 0; i < 12; i++) {
  const result = deriveEphemeralStealthAddress(meta, `${subscriptionId}:${i}`);
  addresses.push({
    payment: i,
    ephemeralPubkey: result.ephemeralPubkey,
    stealthAddress: result.stealthAddress,
  });
}

console.log("Generated 12 unique payment addresses");
```

## Security Considerations

### Key Storage

```typescript
// ❌ DON'T: Store private viewing key on server
localStorage.setItem('viewing_key', privateViewingKey);

// ✅ DO: Keep private keys in-memory only
class WalletManager {
  private viewingKey: string; // Never persisted

  async unlockWallet(password: string) {
    this.viewingKey = await deriveKey(password);
  }
}
```

### Entropy Quality

```typescript
// ❌ DON'T: Use predictable entropy
const entropy = `sub-123:${Date.now()}`; // Time can be guessed

// ✅ DO: Use subscription ID + index
const entropy = `sub-123-abc-def:0`; // First payment
const entropy = `sub-123-abc-def:1`; // Second payment
```

### Transaction Privacy

```typescript
// ❌ DON'T: Reuse ephemeral keys
const ephemeral1 = deriveEphemeralStealthAddress(meta, 'sub:0');
const ephemeral2 = deriveEphemeralStealthAddress(meta, 'sub:0');
// Both will have the same ephemeralPubkey — observer links them!

// ✅ DO: Use unique entropy each time
const ephemeral1 = deriveEphemeralStealthAddress(meta, 'sub:0');
const ephemeral2 = deriveEphemeralStealthAddress(meta, 'sub:1');
// Different ephemeralPubkeys — completely unlinkable
```

## Threat Model

### What Stealth Addresses Protect Against

✅ **Linking Payments**: Observer can't correlate payment transactions
✅ **Wallet Identification**: Payments don't link to your primary wallet
✅ **Service Identification**: Observer can't see what you're paying for
✅ **Amount Correlation**: (Combine with commitments for better privacy)

### What They Don't Protect

❌ **Timing Analysis**: If you always pay on the 1st, adversary might infer subscription
❌ **Transaction Amount**: Stealth doesn't hide amount (use commitments)
❌ **Your Device**: If compromised, adversary sees all keys
❌ **Blockchain**: Ledger is public, but payments are unlinkable

### Recommendations

- Combine with **Payment Channels** to hide timing
- Combine with **Pedersen Commitments** to hide amounts
- Combine with **Metadata Encryption** to hide service details
- Use **VPN/Tor** to hide IP address during payment

## Advanced Topics

### Key Recovery from Mnemonic

```typescript
import { ed25519ToCurve25519PubKey } from '@syncro/sdk';

// If you have a Stellar seed phrase, derive stealth keys
const stellarSeed = 'SCZQ...'; // Your Stellar secret key
const keypair = Keypair.fromSecret(stellarSeed);
const stellarPublicKey = keypair.publicKey();

// Convert Stellar (Ed25519) key to Curve25519 for stealth
const stealthViewKey = ed25519ToCurve25519PubKey(stellarPublicKey);

// Can use for recovery/derived accounts
console.log("Stealth key from Stellar wallet:", stealthViewKey);
```

### Scanning Historical Ledger

```typescript
// To recover payments to stealth addresses:
// 1. Get all transactions in your history
// 2. For each ephemeral pubkey in memo:
const ephemeralFromLedger = "02r1r2r3...";

// 3. Compute if you can derive it
const sharedSecret = privateViewingKey * ephemeralFromLedger;
const derivedAddress = spendPublicKey + hash(sharedSecret) * G;

// 4. Check if payment received there
if (ledger.hasPaymentTo(derivedAddress)) {
  console.log("Found hidden payment!");
}
```

## Comparison with Other Privacy Methods

| Method | Privacy | Speed | Cost | Complexity |
|--------|---------|-------|------|------------|
| **Stealth Address** | ⭐⭐⭐⭐ | Fast | Low | Medium |
| **Mixing Service** | ⭐⭐⭐ | Medium | High | Low |
| **Payment Channel** | ⭐⭐ | Very Fast | Low | High |
| **Commitment** | ⭐⭐⭐ | Fast | Low | Medium |
| **Combination** | ⭐⭐⭐⭐⭐ | Medium | Medium | High |

## References

- ECDH Key Agreement: https://en.wikipedia.org/wiki/Elliptic_Curve_Diffie%E2%80%93Hellman
- Stealth Address Protocol: https://monero.study/
- secp256k1 Curve: https://en.bitcoin.it/wiki/Secp256k1

## Troubleshooting

### "Invalid entropy: scalar is zero"

This is extremely rare (probability: 1 in 2^252). If it occurs:
```typescript
// Solution: Add salt to entropy
const entropy = `${subscriptionId}:${index}:${randomBytes(8).toString('hex')}`;
const result = deriveEphemeralStealthAddress(meta, entropy);
```

### Can't Find Payment on Ledger

Possible causes:
1. Using wrong viewing key
2. Ephemeral pubkey not in memo
3. Payment sent to wrong address
4. Observer is censoring your transactions

## Examples Repository

See `sdk/examples/stealth-addresses/` for complete working examples.
