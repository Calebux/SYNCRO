# API Reference: Privacy Crypto Modules

Complete API reference for all privacy-related functions in `@syncro/sdk`.

## Table of Contents

1. [Stealth Addresses](#stealth-addresses)
2. [Metadata Encryption](#metadata-encryption)
3. [Pedersen Commitments](#pedersen-commitments)
4. [Key Derivation](#key-derivation)
5. [Payment Commitments](#payment-commitments)
6. [Types & Interfaces](#types--interfaces)

---

## Stealth Addresses

### `generateStealthMetaAddress()`

Generate a new stealth meta-address (viewing and spending keys).

```typescript
import { generateStealthMetaAddress } from '@syncro/sdk';

const meta = generateStealthMetaAddress();
// {
//   viewPublicKey: "02a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5",
//   spendPublicKey: "03f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1",
//   encoded: "syncro:stealth:v1:02a1b2c3...:03f6e5d4..."
// }
```

**Returns**:
```typescript
interface StealthMetaAddress {
  viewPublicKey: string;     // Compressed secp256k1 point (hex, 66 chars)
  spendPublicKey: string;    // Compressed secp256k1 point (hex, 66 chars)
  encoded: string;           // Versioned encoding for sharing
}
```

**Use case**: Generate once per user identity, share `encoded` format publicly

**Security**:
- Private keys generated using `crypto.getRandomValues()`
- Each key pair is unique
- Suitable for long-term stealth address

---

### `deriveEphemeralStealthAddress(metaAddress, entropy)`

Generate one-time stealth address from a meta-address using ECDH.

```typescript
import { deriveEphemeralStealthAddress } from '@syncro/sdk';

const result = deriveEphemeralStealthAddress(
  {
    viewPublicKey: meta.viewPublicKey,
    spendPublicKey: meta.spendPublicKey
  },
  `subscription-${subscriptionId}:payment-${index}`
);

// {
//   ephemeralPubkey: "02r1r2r3r4...", // Publish in transaction memo
//   stealthAddress: "02s1s2s3s4..."   // Send payment here
// }
```

**Parameters**:
- `metaAddress` (object): Must have `viewPublicKey` and `spendPublicKey`
- `entropy` (string): Unique per payment (e.g., `${subscriptionId}:${index}`)

**Returns**:
```typescript
interface EphemeralStealthResult {
  ephemeralPubkey: string;   // Compressed secp256k1 point (hex, 66 chars)
  stealthAddress: string;    // Compressed secp256k1 point (hex, 66 chars)
}
```

**Use case**: Generate unique address per payment without revealing payment history

**Security**:
- Deterministic given same entropy (reproducible)
- Different entropy produces completely different addresses
- ephemeralPubkey must be published in transaction memo for recipient discovery

**Throws**:
- `Error` if entropy produces scalar zero (probability: ~2^-256, negligible)

---

### `deriveStealthAddress(metaAddress, subscriptionId, index)`

Derive deterministic stealth address for a specific subscription cycle.

```typescript
import { deriveStealthAddress } from '@syncro/sdk';

const address = deriveStealthAddress(
  meta,
  'netflix-sub-2024-unique-id',
  0  // First payment
);

// Returns: "02d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9"
```

**Parameters**:
- `metaAddress` (StealthMetaAddress): Viewing and spending keys
- `subscriptionId` (string): Unique subscription identifier
- `index` (number): Payment number (0 = first, 1 = second, etc.)

**Returns**:
- `string`: One-time stealth address (hex-encoded Ristretto point)

**Use case**: Derive deterministic addresses for recurring payments

**Security**:
- Same subscriptionId + index = same address (reproducible)
- Different index = different address (unlinkable)

---

## Metadata Encryption

### `encryptSubscriptionMetadata(key, metadata)`

Encrypt subscription metadata (name, price, cycle, provider).

```typescript
import { encryptSubscriptionMetadata } from '@syncro/sdk';

const encrypted = await encryptSubscriptionMetadata(
  'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899', // 64-char hex key
  {
    name: 'Netflix',
    price: 15.99,
    cycle: 'monthly',
    provider: 'netflix.com'
  }
);

// {
//   iv: "a1b2c3d4e5f6a1b2c3d4e5f6",
//   authTag: "f1e2d3c4b5a6f1e2d3c4b5a6",
//   ciphertext: "7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d..."
// }
```

**Parameters**:
- `key` (string): 64-character hex string (32 bytes). Must be exactly 64 chars.
- `metadata` (SubscriptionMetadata): Must contain `name`, `price`, `cycle`, `provider`

**Returns**:
```typescript
interface EncryptedData {
  iv: string;              // Hex-encoded initialization vector (24 hex chars = 12 bytes)
  authTag: string;         // Hex-encoded authentication tag (32 hex chars = 16 bytes)
  ciphertext: string;      // Hex-encoded encrypted data
}
```

**Use case**: Store subscription details encrypted on server

**Security**:
- Generates random 12-byte IV each time
- AES-256-GCM authenticated encryption
- Different IV each call (same key safe to reuse)
- Authentication tag detects tampering

**Throws**:
- `Error` if metadata doesn't match schema
- `Error` if key is not 64 hex characters

---

### `decryptSubscriptionMetadata(key, encrypted)`

Decrypt subscription metadata.

```typescript
import { decryptSubscriptionMetadata } from '@syncro/sdk';

const metadata = await decryptSubscriptionMetadata(
  'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899',
  encrypted
);

// {
//   name: "Netflix",
//   price: 15.99,
//   cycle: "monthly",
//   provider: "netflix.com"
// }
```

**Parameters**:
- `key` (string): Same key used for encryption
- `encrypted` (EncryptedData): From `encryptSubscriptionMetadata()`

**Returns**:
- `Promise<SubscriptionMetadata>`: Decrypted metadata

**Use case**: Retrieve encrypted subscription details

**Security**:
- Verifies authentication tag (detects tampering)
- Fails if key is wrong
- Fails if data corrupted

**Throws**:
- `Error` if key is wrong
- `Error` if authentication tag verification fails
- `Error` if decrypted data is not valid JSON
- `Error` if JSON doesn't match SubscriptionMetadata schema

---

### `encryptMetadata(plaintext, keyHex)` / `decryptMetadata(encrypted, keyHex)`

Low-level encrypt/decrypt for any string data.

```typescript
import { encryptMetadata, decryptMetadata } from '@syncro/sdk';

// Encrypt any string
const encrypted = await encryptMetadata(
  'my secret note about this subscription',
  keyHex
);

// Decrypt
const plaintext = await decryptMetadata(encrypted, keyHex);
```

**Use case**: Encrypt arbitrary string data (not just subscriptions)

---

## Pedersen Commitments

### `commit(value, blindingFactor?)`

Create a commitment to a value (amount).

```typescript
import { commit } from '@syncro/sdk';

// With auto-generated random blinding factor
const commitment1 = commit(1500n);  // $15.00
// {
//   commitment: "4a8f2e1d9c...",     // Ristretto point (hex)
//   blindingFactor: "9e3f1a2b7c..."  // Scalar (hex)
// }

// With specified blinding factor
const blindingFactor = 12345678901234567890n;
const commitment2 = commit(1500n, blindingFactor);
```

**Parameters**:
- `value` (bigint): Amount to commit (must be >= 0)
- `blindingFactor` (bigint, optional): If omitted, generates random

**Returns**:
```typescript
interface PedersenCommitment {
  commitment: string;      // Hex-encoded Ristretto point
  blindingFactor: string;  // Hex-encoded blinding factor scalar
}
```

**Use case**: Hide payment amount while proving you know it

**Security**:
- Mathematically binding: Can't prove different amount
- Computationally hiding: Commitment reveals nothing about amount
- Homomorphic: Commitments are additive

**Note**: For payment amounts in cents, use `commit(BigInt(price * 100))`

---

### `verify(value, blindingFactor, commitment)`

Verify a commitment matches a value.

```typescript
import { verify } from '@syncro/sdk';

const isValid = verify(1500n, blindingFactor, commitment);

if (isValid) {
  console.log('Payment amount verified!');
} else {
  console.log('Amount does not match commitment');
}
```

**Parameters**:
- `value` (bigint): Claimed amount
- `blindingFactor` (string): Original blinding factor (hex)
- `commitment` (string): Original commitment (hex)

**Returns**:
- `boolean`: true if valid, false otherwise

**Use case**: Verify commitment without revealing blinding factor

**Security**:
- Detects if amount or blinding factor was changed
- Blinding factor should not be revealed except when verifying

---

### `createEventCommitment(eventType, eventData)`

Create commitment to an event (subscription, payment, etc).

```typescript
import { createEventCommitment } from '@syncro/sdk';

const commitment = createEventCommitment(
  'subscription_payment',
  '{"amount": 1500, "subscription": "netflix", "date": "2024-01-01"}'
);

// {
//   commitment: "4a8f2e1d9c...",
//   blindingFactor: "9e3f1a2b7c..."
// }
```

**Use case**: Create commitment to specific event for later proof

---

### `verifyEventCommitment(eventType, eventData, commitment)`

Verify an event commitment.

```typescript
import { verifyEventCommitment } from '@syncro/sdk';

const isValid = verifyEventCommitment(
  'subscription_payment',
  '{"amount": 1500, "subscription": "netflix", "date": "2024-01-01"}',
  commitment
);
```

---

## Key Derivation

### `deriveSubscriptionEncryptionKey(password, subscriptionId)`

Derive deterministic encryption key from password and subscription ID.

```typescript
import { deriveSubscriptionEncryptionKey } from '@syncro/sdk';

const key = await deriveSubscriptionEncryptionKey(
  'my-secure-password',
  'netflix-subscription-id'
);

// Returns: 32-byte encryption key (hex string)
// Same password + subscription = same key (deterministic)
```

**Parameters**:
- `password` (string): User password (any length)
- `subscriptionId` (string): Subscription identifier

**Returns**:
- `Promise<string>`: 64-character hex string (32 bytes)

**Use case**: Derive keys from user password without storing them

**Security**:
- Uses PBKDF2 with 100,000 iterations
- Brute-force resistant: ~50ms per attempt
- Deterministic: Same inputs = same key
- Unique per subscription: Different subscription = different key

**Throws**:
- `Error` if password or subscriptionId is empty

---

## Payment Commitments

### `createPaymentCommitment(amount, currency)`

Create commitment to a payment with range proof.

```typescript
import { createPaymentCommitment } from '@syncro/sdk';

const commitment = await createPaymentCommitment(
  1500,     // Amount in cents
  'USD'     // Currency
);

// {
//   commitment: "...",      // Pedersen commitment
//   rangeProof: "...",      // Proof amount is in valid range
//   blindingFactor: "...",
//   metadata: {
//     amount: 1500,
//     currency: 'USD',
//     createdAt: '2024-01-01T...'
//   }
// }
```

**Returns**:
```typescript
interface PaymentCommitment {
  commitment: string;       // Pedersen commitment
  rangeProof: string;       // Bulletproof (amount in range)
  blindingFactor: string;   // Scalar
  metadata: {
    amount: number;
    currency: string;
    createdAt: string;
  }
}
```

**Use case**: Prove payment amount without revealing it, with range verification

---

### `verifyPaymentCommitment(commitment, amount, blindingFactor)`

Verify payment commitment.

```typescript
import { verifyPaymentCommitment } from '@syncro/sdk';

const isValid = await verifyPaymentCommitment(
  paymentCommitment.commitment,
  1500,
  paymentCommitment.blindingFactor
);
```

---

## Types & Interfaces

### SubscriptionMetadata

```typescript
interface SubscriptionMetadata {
  name: string;     // Service name (non-empty)
  price: number;    // Price in dollars (>= 0, finite)
  cycle: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  provider: string; // Service provider domain (non-empty)
}
```

### StealthMetaAddress

```typescript
interface StealthMetaAddress {
  viewPublicKey: string;   // Compressed secp256k1 point (66 hex chars)
  spendPublicKey: string;  // Compressed secp256k1 point (66 hex chars)
  encoded: string;         // Versioned format: "syncro:stealth:v1:..."
}
```

### EphemeralStealthResult

```typescript
interface EphemeralStealthResult {
  ephemeralPubkey: string;  // Publish in transaction memo
  stealthAddress: string;   // Recipient address for payment
}
```

### EncryptedData

```typescript
interface EncryptedData {
  iv: string;       // Initialization vector (24 hex chars)
  authTag: string;  // Authentication tag (32 hex chars)
  ciphertext: string; // Encrypted data (hex)
}
```

### PedersenCommitment

```typescript
interface PedersenCommitment {
  commitment: string;      // Commitment point (hex)
  blindingFactor: string;  // Secret blinding factor (hex)
}
```

---

## Error Handling

All functions throw descriptive errors:

```typescript
try {
  const result = await decryptSubscriptionMetadata(key, encrypted);
} catch (error) {
  if (error instanceof Error) {
    if (error.message.includes('Invalid subscription metadata schema')) {
      // Corrupted or tampered data
    } else if (error.message.includes('Decrypted data is not valid JSON')) {
      // Decryption succeeded but result is not JSON
    } else if (error.message.includes('auth tag')) {
      // Tampering detected or wrong key
    }
  }
  throw error;
}
```

---

## Import Statements

```typescript
// Stealth Addresses
import {
  generateStealthMetaAddress,
  deriveEphemeralStealthAddress,
  deriveStealthAddress,
  StealthMetaAddress,
  EphemeralStealthResult
} from '@syncro/sdk';

// Metadata Encryption
import {
  encryptSubscriptionMetadata,
  decryptSubscriptionMetadata,
  encryptMetadata,
  decryptMetadata,
  SubscriptionMetadata,
  EncryptedData
} from '@syncro/sdk';

// Pedersen Commitments
import {
  commit,
  verify,
  createEventCommitment,
  verifyEventCommitment,
  PedersenCommitment
} from '@syncro/sdk';

// Key Derivation
import {
  deriveSubscriptionEncryptionKey
} from '@syncro/sdk';

// Payment Commitments
import {
  createPaymentCommitment,
  verifyPaymentCommitment
} from '@syncro/sdk';
```

---

## Performance Characteristics

| Operation | Time | Notes |
|-----------|------|-------|
| Generate stealth meta-address | <1ms | secp256k1 key generation |
| Derive ephemeral address | <1ms | ECDH computation |
| Encrypt metadata | <1ms | AES-256-GCM |
| Decrypt metadata | <1ms | AES-256-GCM |
| Create commitment | <1ms | Ristretto point multiplication |
| Verify commitment | <1ms | Point addition |
| Derive key from password | ~50ms | PBKDF2 100k iterations |

---

## Examples

See `sdk/examples/` for complete working examples:

- `stealth-addresses/` — One-time payment addresses
- `metadata-encryption/` — Encrypt subscription details
- `pedersen-commitments/` — Hide payment amounts
- `key-derivation/` — Derive keys from passwords
- `complete-privacy-stack/` — Combine all features

---

## Changelog

### Version 1.0.0 (Current)

- ✅ Stealth Addresses (ECDH)
- ✅ Metadata Encryption (AES-256-GCM)
- ✅ Pedersen Commitments (Ristretto)
- ✅ Key Derivation (PBKDF2-SHA256)
- ✅ Payment Commitments (with range proofs)

### Future (Planned)

- ⏳ Zero-Knowledge Proofs (General circuit support)
- ⏳ Payment Channels (Layer 2 off-chain)
- ⏳ Multi-signature Support (Threshold encryption)
- ⏳ Key Recovery Procedures

---

## Support

- **Documentation**: See guides in `sdk/docs/privacy/`
- **Issues**: github.com/Calebux/SYNCRO/issues
- **Security**: security@syncro.app
