# Metadata Encryption

## Overview

Encrypt subscription metadata (name, price, billing cycle, provider) so the server and any observer cannot see what services you're paying for. Only your device can decrypt with the encryption key.

## How It Works

### AES-GCM Encryption

SYNCRO uses AES-256-GCM (Authenticated Encryption with Associated Data):

```
1. You have encryption key (256-bit random or derived)
2. Plaintext: {"name": "Netflix", "price": 15.99, "cycle": "monthly", ...}
3. Encrypt with AES-256-GCM:
   - Generate random IV (12 bytes)
   - Encrypt plaintext
   - Generate authentication tag (16 bytes)
4. Ciphertext = IV + encrypted_data + tag
5. Only you have the key → only you can decrypt
```

### Why AES-GCM?

- **Authenticated**: Any tampering detected (AEAD property)
- **Fast**: Hardware accelerated on modern CPUs
- **Standardized**: NIST approved, widely implemented
- **Proven**: Used by TLS, Signal, and other privacy systems

## Data Structure

```typescript
interface SubscriptionMetadata {
  name: string;           // e.g., "Netflix"
  price: number;          // e.g., 15.99
  cycle: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  provider: string;       // e.g., "netflix.com"
}

interface EncryptedData {
  iv: string;             // Hex-encoded IV (12 bytes)
  authTag: string;        // Hex-encoded auth tag (16 bytes)
  ciphertext: string;     // Hex-encoded encrypted data
}
```

## API Reference

### `encryptSubscriptionMetadata(key, metadata)`

Encrypt subscription details.

```typescript
import { encryptSubscriptionMetadata } from '@syncro/sdk';

const encrypted = await encryptSubscriptionMetadata(
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', // 64-char hex key
  {
    name: 'Netflix',
    price: 15.99,
    cycle: 'monthly',
    provider: 'netflix.com'
  }
);

// Returns:
// {
//   iv: "a1b2c3d4e5f6a1b2c3d4e5f6",
//   authTag: "f1e2d3c4b5a6f1e2d3c4b5a6",
//   ciphertext: "7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f"
// }

// Store encrypted data on server
await saveToDatabase({ subscriptionId, encrypted });
```

**Parameters**:
- `key` (string): 64-character hex string (32 bytes)
- `metadata` (SubscriptionMetadata): Data to encrypt

**Returns**:
- `Promise<EncryptedData>`: IV, auth tag, and ciphertext

**Throws**:
- `Error`: If metadata doesn't match schema or key is invalid

### `decryptSubscriptionMetadata(key, encrypted)`

Decrypt subscription details.

```typescript
import { decryptSubscriptionMetadata } from '@syncro/sdk';

const decrypted = await decryptSubscriptionMetadata(
  'your-encryption-key-hex',
  encrypted // EncryptedData from database
);

// Returns original metadata:
// {
//   name: "Netflix",
//   price: 15.99,
//   cycle: "monthly",
//   provider: "netflix.com"
// }

console.log(`Paying ${decrypted.price} for ${decrypted.name}`);
```

**Parameters**:
- `key` (string): Same 64-char hex key used for encryption
- `encrypted` (EncryptedData): Data to decrypt

**Returns**:
- `Promise<SubscriptionMetadata>`: Decrypted data

**Throws**:
- `Error`: If key is wrong, data corrupted, or tampering detected

### `encryptMetadata(plaintext, keyHex)` / `decryptMetadata(encrypted, keyHex)`

Low-level encrypt/decrypt for any string data (not just subscriptions).

```typescript
import { encryptMetadata, decryptMetadata } from '@syncro/sdk';

// Encrypt any string
const encrypted = await encryptMetadata(
  'My secret note about this subscription',
  'your-key-hex'
);

// Decrypt
const plaintext = await decryptMetadata(encrypted, 'your-key-hex');
console.log(plaintext); // "My secret note about this subscription"
```

## Key Derivation

### Derive Encryption Key from Password

```typescript
import { deriveSubscriptionEncryptionKey } from '@syncro/sdk';

const password = "my-secure-password-12345";
const subscriptionId = "sub-netflix-2024";

const key = await deriveSubscriptionEncryptionKey(password, subscriptionId);
// Returns 32-byte encryption key

// Use for encryption
const encrypted = await encryptSubscriptionMetadata(key, metadata);
```

**Advantages**:
- Deterministic: Same password + subscription = same key
- Brute-force resistant: Uses PBKDF2 with 100k iterations
- Unique per subscription: Different key for each subscription

### Derive from Viewing Key

```typescript
import { deriveKeyFromViewingKey } from '@syncro/sdk';

// If you use stealth addresses
const viewingKey = "02a1b2c3..."; // Your private viewing key
const subscriptionId = "sub-123";

const encryptionKey = await deriveKeyFromViewingKey(viewingKey, subscriptionId);
// Returns deterministic key tied to your wallet

const encrypted = await encryptSubscriptionMetadata(encryptionKey, metadata);
```

## Integration Examples

### Example 1: Store Encrypted Metadata on Server

```typescript
import { encryptSubscriptionMetadata } from '@syncro/sdk';

async function addSubscription(details: SubscriptionMetadata) {
  // Step 1: Generate encryption key (keep in memory)
  const key = crypto.getRandomValues(new Uint8Array(32));
  const keyHex = Array.from(key).map(b => b.toString(16).padStart(2, '0')).join('');

  // Step 2: Encrypt metadata
  const encrypted = await encryptSubscriptionMetadata(keyHex, details);

  // Step 3: Store encrypted on server
  await fetch('/api/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      id: generateId(),
      encryptedMetadata: encrypted,
      keyHash: sha256(keyHex), // To verify key later
    })
  });

  // Step 4: Store key locally (never send to server!)
  localStorage.setItem('sub-key', keyHex);
}
```

### Example 2: Retrieve and Decrypt

```typescript
async function getSubscriptionDetails(subscriptionId: string) {
  // Step 1: Fetch encrypted data from server
  const response = await fetch(`/api/subscriptions/${subscriptionId}`);
  const { encryptedMetadata } = await response.json();

  // Step 2: Get key from local storage
  const key = localStorage.getItem('sub-key');

  // Step 3: Decrypt on device
  const metadata = await decryptSubscriptionMetadata(key, encryptedMetadata);

  // Step 4: Use decrypted data
  console.log(`Your subscription to ${metadata.name}`);
  return metadata;
}
```

### Example 3: Full Workflow with Multiple Subscriptions

```typescript
import { encryptSubscriptionMetadata, decryptSubscriptionMetadata } from '@syncro/sdk';

class SubscriptionManager {
  private encryptionKeys: Map<string, string> = new Map();

  async addSubscription(details: SubscriptionMetadata): Promise<string> {
    const subscriptionId = generateId();

    // Generate unique key for this subscription
    const key = crypto.getRandomValues(new Uint8Array(32));
    const keyHex = bytesToHex(key);
    this.encryptionKeys.set(subscriptionId, keyHex);

    // Encrypt
    const encrypted = await encryptSubscriptionMetadata(keyHex, details);

    // Save encrypted to server
    await fetch('/api/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        id: subscriptionId,
        encrypted,
      })
    });

    return subscriptionId;
  }

  async getSubscription(subscriptionId: string): Promise<SubscriptionMetadata> {
    // Fetch encrypted data
    const response = await fetch(`/api/subscriptions/${subscriptionId}`);
    const { encrypted } = await response.json();

    // Get key from memory
    const key = this.encryptionKeys.get(subscriptionId);
    if (!key) throw new Error('Key not found');

    // Decrypt
    return decryptSubscriptionMetadata(key, encrypted);
  }

  async listSubscriptions(): Promise<SubscriptionMetadata[]> {
    // Fetch all encrypted subscriptions
    const response = await fetch('/api/subscriptions');
    const subscriptions = await response.json();

    // Decrypt each one
    const results = [];
    for (const { id, encrypted } of subscriptions) {
      const key = this.encryptionKeys.get(id);
      if (key) {
        const metadata = await decryptSubscriptionMetadata(key, encrypted);
        results.push(metadata);
      }
    }
    return results;
  }
}
```

## Security Considerations

### Key Management

```typescript
// ❌ DON'T: Store key in localStorage unencrypted
localStorage.setItem('encryption_key', key);

// ❌ DON'T: Send key to server
fetch('/api/save-key', { body: JSON.stringify({ key }) });

// ❌ DON'T: Embed key in code
const key = 'aabbccdd...'; // Visible in source

// ✅ DO: Keep key in memory only
let encryptionKey: string | null = null;
function setKey(key: string) {
  encryptionKey = key; // In memory only
}

// ✅ DO: Derive from user password
const key = await deriveSubscriptionEncryptionKey(password, subscriptionId);

// ✅ DO: Use for one session, clear when done
onLogout(() => {
  encryptionKey = null; // Secure clearing
});
```

### IV (Initialization Vector)

```typescript
// ✅ CORRECT: Each encryption generates new random IV
const encrypted1 = await encryptSubscriptionMetadata(key, metadata1);
// encrypted1.iv = random, unique

const encrypted2 = await encryptSubscriptionMetadata(key, metadata2);
// encrypted2.iv = different random, unique

// ❌ WRONG: Reusing IV breaks security
// Never use same IV with same key twice!
```

### Authentication Tag Verification

```typescript
// The authentication tag is verified automatically
const decrypted = await decryptSubscriptionMetadata(key, encrypted);

// If:
// 1. Key is wrong → decryption fails
// 2. Ciphertext was modified → auth tag check fails
// 3. Data is corrupted → auth tag check fails

// If any check fails, Error is thrown
// ✅ Your data is tamper-proof
```

### Key Rotation

```typescript
// When changing password or rotating keys:
async function rotateKey(oldKey: string, newKey: string) {
  // Fetch all encrypted subscriptions
  const subscriptions = await fetch('/api/subscriptions').then(r => r.json());

  for (const sub of subscriptions) {
    // Decrypt with old key
    const metadata = await decryptSubscriptionMetadata(oldKey, sub.encrypted);

    // Encrypt with new key
    const newEncrypted = await encryptSubscriptionMetadata(newKey, metadata);

    // Update on server
    await fetch(`/api/subscriptions/${sub.id}`, {
      method: 'PUT',
      body: JSON.stringify({ encrypted: newEncrypted })
    });
  }

  // Update local key storage
  for (const [id] of encryptionKeys) {
    encryptionKeys.set(id, newKey);
  }
}
```

## Threat Model

### What Metadata Encryption Protects Against

✅ **Server Operator**: Can't see what you're paying for
✅ **Network Observer**: Can't see subscription details
✅ **Third-party Service**: Only sees encrypted blob
✅ **Data Breach**: Server hack doesn't expose subscription names/prices
✅ **Database Query**: Even if SQL injected, encrypted

### What It Doesn't Protect

❌ **Your Device**: If compromised, adversary sees plaintext in memory
❌ **Metadata Leakage**: Subscription ID, payment timing still visible
❌ **Payment Amount**: Use commitments to hide amounts
❌ **Frequency Analysis**: If you always pay on 1st, pattern visible

### Recommendations

- Combine with **Stealth Addresses** to hide payment recipient
- Combine with **Pedersen Commitments** to hide amounts
- Combine with **Payment Channels** to hide timing
- Use **VPN/Tor** to hide IP address

## Common Patterns

### Pattern 1: Per-Subscription Keys

Each subscription gets its own encryption key (recommended):

```typescript
// When adding subscription:
const key = crypto.getRandomValues(new Uint8Array(32));
const encrypted = await encryptSubscriptionMetadata(key, metadata);
// Store: { subscriptionId, encrypted, keyHash }

// Later:
const metadata = await decryptSubscriptionMetadata(keyFromMemory, encrypted);
```

**Advantages**:
- Compromising one key doesn't compromise others
- Easy to rotate individual subscriptions
- Different subscriptions different keys

### Pattern 2: Master Key Derived Keys

Derive encryption keys from master password:

```typescript
// Setup: User sets password once
const masterPassword = "my-secure-password";

// For each subscription:
const subscriptionId = "sub-netflix-2024";
const key = await deriveSubscriptionEncryptionKey(masterPassword, subscriptionId);
const encrypted = await encryptSubscriptionMetadata(key, metadata);
// Store just: { subscriptionId, encrypted }
// No key storage needed!

// Later: User enters password
const key = await deriveSubscriptionEncryptionKey(masterPassword, subscriptionId);
const metadata = await decryptSubscriptionMetadata(key, encrypted);
```

**Advantages**:
- No key storage required
- Single password to remember
- Can change single password to rotate all keys
- Survives browser data deletion

## Performance

| Operation | Time | Notes |
|-----------|------|-------|
| Generate 32-byte key | <1ms | Uses crypto.getRandomValues |
| Derive key from password | ~50ms | PBKDF2 with 100k iterations |
| Encrypt metadata | <1ms | AES-GCM, hardware accelerated |
| Decrypt metadata | <1ms | AES-GCM, hardware accelerated |

## Troubleshooting

### "Invalid subscription metadata schema"

The data doesn't match the schema:

```typescript
// Must match this exactly:
{
  name: string (non-empty),
  price: number (0 or positive, finite),
  cycle: 'weekly' | 'monthly' | 'quarterly' | 'yearly',
  provider: string (non-empty)
}

// ❌ Invalid:
{ name: 'Netflix', price: "15.99", ... } // price is string

// ✅ Valid:
{ name: 'Netflix', price: 15.99, ... } // price is number
```

### "Decrypted data is not valid JSON"

The ciphertext doesn't contain valid JSON:

Possible causes:
1. Wrong key used for decryption
2. Ciphertext was corrupted
3. Tampering detected

### "Key must be 32 bytes"

The encryption key must be exactly 32 bytes (64 hex characters):

```typescript
// ❌ Wrong:
const key = "short-key";

// ✅ Right:
const key = "0123456789abcdef".repeat(4); // 64 hex chars = 32 bytes
```

## Examples Repository

See `sdk/examples/metadata-encryption/` for complete working examples.

## References

- AES-GCM: https://en.wikipedia.org/wiki/Galois/Counter_Mode
- PBKDF2: https://tools.ietf.org/html/rfc2898
- Web Crypto API: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto
