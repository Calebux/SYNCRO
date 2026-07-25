# Integration Guide: Adding Privacy to Your SYNCRO Integration

## Overview

This guide shows you how to add privacy features to your SYNCRO integration step by step. You'll learn which features to use when, and how to implement them correctly.

## Quick Decision Tree

```
Do you want to hide:

├─ WHO receives payment?
│  └─ Use: Stealth Addresses
│     See: stealth-addresses.md
│
├─ WHAT service you're paying for?
│  └─ Use: Metadata Encryption
│     See: metadata-encryption.md
│
├─ HOW MUCH you're paying?
│  └─ Use: Pedersen Commitments
│     See: pedersen-commitments.md
│
├─ WHEN you're paying (timing)?
│  └─ Use: Payment Channels
│     See: payment-channels.md
│
├─ ALL OF THE ABOVE?
│  └─ Use: Combined Privacy Stack (see below)
│     Recommended for maximum privacy
│
└─ Want to prove facts about data?
   └─ Use: Zero-Knowledge Proofs
      See: zk-proofs.md
```

## Level 1: Basic Privacy (Stealth Addresses)

**What it does**: Hides which wallet is receiving payment

**Use case**: You want someone to send you money without linking it to your main wallet

**Implementation time**: 10 minutes

```typescript
import { generateStealthMetaAddress, deriveEphemeralStealthAddress } from '@syncro/sdk';

// 1. Generate your stealth identity (once)
const meta = generateStealthMetaAddress();
console.log("Share this address:", meta.encoded);
// "syncro:stealth:v1:02a1b2c3...:03d4e5f6..."

// 2. Create database entry
await db.user.update({
  id: userId,
  stealthMetaAddress: meta.encoded
});

// 3. For each payment, generate one-time address
const paymentAddress = deriveEphemeralStealthAddress(
  {
    viewPublicKey: meta.viewPublicKey,
    spendPublicKey: meta.spendPublicKey
  },
  `subscription-${subscriptionId}:${paymentIndex}`
);

// 4. Use this address for payment
console.log("Send payment to:", paymentAddress.stealthAddress);

// 5. You can discover payments using ephemeralPubkey from ledger
```

**Checklist**:
- [x] Generate stealth meta-address
- [x] Store meta-address securely (in-memory)
- [x] Generate unique address per payment
- [x] Publish ephemeralPubkey in transaction memo
- [x] Verify received payments

**What's hidden**: Recipient wallet
**What's visible**: Amount, timing, transaction structure
**Privacy level**: ⭐⭐⭐

---

## Level 2: Hide Service Details (Metadata Encryption)

**What it does**: Server can't see what service you're paying for

**Use case**: Your subscription list is sensitive; server should store only encrypted data

**Implementation time**: 15 minutes

```typescript
import { encryptSubscriptionMetadata, decryptSubscriptionMetadata } from '@syncro/sdk';

// 1. Generate encryption key for this subscription
const encryptionKey = crypto.getRandomValues(new Uint8Array(32));
const keyHex = bytesToHex(encryptionKey);

// 2. Encrypt subscription metadata
const encrypted = await encryptSubscriptionMetadata(keyHex, {
  name: 'Netflix',
  price: 15.99,
  cycle: 'monthly',
  provider: 'netflix.com'
});

// 3. Store encrypted data on server
await db.subscription.create({
  userId,
  encrypted,  // Server stores encrypted blob
  keyHash: sha256(keyHex)  // Optional: for verification
});

// 4. Store key locally (never send to server!)
localStorage.setItem(`key-${subscriptionId}`, keyHex);

// 5. When you need to access subscription details
const key = localStorage.getItem(`key-${subscriptionId}`);
const metadata = await decryptSubscriptionMetadata(key, encrypted);
console.log("Your subscription to:", metadata.name);
```

**Checklist**:
- [x] Generate unique key per subscription
- [x] Encrypt metadata before sending to server
- [x] Store key locally only
- [x] Never send key to server
- [x] Clear keys on logout

**What's hidden**: Subscription name, price, provider
**What's visible**: Subscription ID, payment amount, timing
**Privacy level**: ⭐⭐⭐

---

## Level 3: Hide Payment Amounts (Pedersen Commitments)

**What it does**: Prove you know payment amount without revealing it

**Use case**: You want to prove you paid the correct amount without revealing the amount

**Implementation time**: 10 minutes

```typescript
import { commit, verify } from '@syncro/sdk';

// 1. Create commitment to payment amount
const monthlyAmount = 1500n; // $15 in cents
const commitment = commit(monthlyAmount);

// 2. Store commitment on server
await db.subscription.update({
  id: subscriptionId,
  amountCommitment: commitment.commitment
});

// 3. Keep blinding factor secret
localStorage.setItem(
  `blinding-${subscriptionId}`,
  commitment.blindingFactor
);

// 4. When you need to prove the amount (e.g., dispute)
const storedCommitment = await db.subscription.get(subscriptionId);
const blindingFactor = localStorage.getItem(`blinding-${subscriptionId}`);

const isValid = verify(monthlyAmount, blindingFactor, storedCommitment);
console.log("Amount verified:", isValid);
```

**Checklist**:
- [x] Create commitment to each payment amount
- [x] Store only commitment on server
- [x] Keep blinding factor secret
- [x] Use random blinding factor (don't reuse)
- [x] Prove amount only when needed

**What's hidden**: Payment amount (from server)
**What's visible**: Commitment hash, payment timing
**Privacy level**: ⭐⭐⭐

---

## Level 4: Complete Privacy Stack

**What it does**: Hide recipient, amount, and service details from everyone

**Use case**: Maximum privacy: no one can see what you're paying for or to whom

**Implementation time**: 45 minutes

```typescript
import {
  generateStealthMetaAddress,
  deriveEphemeralStealthAddress,
  encryptSubscriptionMetadata,
  commit
} from '@syncro/sdk';

// SETUP: Create your stealth identity
const stealthMeta = generateStealthMetaAddress();

// For each subscription:
const subscriptionId = 'netflix-2024-unique-id';

// 1. Generate stealth payment address
const paymentAddress = deriveEphemeralStealthAddress(
  {
    viewPublicKey: stealthMeta.viewPublicKey,
    spendPublicKey: stealthMeta.spendPublicKey
  },
  `${subscriptionId}:0`  // First payment
);

// 2. Encrypt subscription metadata
const encryptionKey = crypto.getRandomValues(new Uint8Array(32));
const encrypted = await encryptSubscriptionMetadata(encryptionKey, {
  name: 'Netflix',
  price: 15.99,
  cycle: 'monthly',
  provider: 'netflix.com'
});

// 3. Commit to payment amount
const monthlyAmount = 1500n;
const commitment = commit(monthlyAmount);

// 4. Store on server:
await db.subscription.create({
  id: subscriptionId,
  // Encrypted so server doesn't see what you're paying for
  encryptedMetadata: encrypted,
  // Amount is hidden in commitment
  amountCommitment: commitment.commitment,
  // Everything else is unlinkable
  stealthMetaAddress: stealthMeta.encoded
});

// 5. Store keys locally (never on server!)
localStorage.setItem(`encryption-key-${subscriptionId}`, bytesToHex(encryptionKey));
localStorage.setItem(`blinding-factor-${subscriptionId}`, commitment.blindingFactor);

// 6. When paying:
console.log("Send payment to:", paymentAddress.stealthAddress);
console.log("Include in memo:", paymentAddress.ephemeralPubkey);

// 7. Later, when you need to recover or verify:
const metadata = await decryptSubscriptionMetadata(
  localStorage.getItem(`encryption-key-${subscriptionId}`),
  encrypted
);
console.log("Paying for:", metadata.name);
```

**Checklist**:
- [x] Generate stealth meta-address
- [x] Use unique address per payment
- [x] Encrypt all subscription metadata
- [x] Commit to payment amounts
- [x] Store keys locally only
- [x] Test recovery from ephemeralPubkey

**What's hidden**: Everything (recipient, amount, service)
**What's visible**: Transaction structure only
**Privacy level**: ⭐⭐⭐⭐⭐

---

## API Quick Reference

```typescript
// Stealth Addresses
import { generateStealthMetaAddress, deriveEphemeralStealthAddress } from '@syncro/sdk';

// Metadata Encryption
import { encryptSubscriptionMetadata, decryptSubscriptionMetadata } from '@syncro/sdk';

// Pedersen Commitments
import { commit, verify } from '@syncro/sdk';

// Key Derivation
import { deriveSubscriptionEncryptionKey } from '@syncro/sdk';

// Payment Commitments
import { createPaymentCommitment, verifyPaymentCommitment } from '@syncro/sdk';
```

## Common Integration Patterns

### Pattern 1: One-Time Stealth Addresses

```typescript
// Generate a unique stealth address for each billing cycle
async function generatePaymentAddress(userId: string, cycleNumber: number) {
  const user = await db.user.findById(userId);
  const stealthMeta = JSON.parse(user.stealthMetaAddress);

  return deriveEphemeralStealthAddress(
    {
      viewPublicKey: stealthMeta.viewPublicKey,
      spendPublicKey: stealthMeta.spendPublicKey
    },
    `user-${userId}:cycle-${cycleNumber}`
  );
}
```

### Pattern 2: Encrypted Subscription Storage

```typescript
// Store subscriptions encrypted, with commitment-based amounts
async function addSubscription(userId: string, metadata: SubscriptionMetadata) {
  const encryptionKey = crypto.getRandomValues(new Uint8Array(32));
  const commitment = commit(BigInt(Math.floor(metadata.price * 100)));

  const encrypted = await encryptSubscriptionMetadata(
    bytesToHex(encryptionKey),
    metadata
  );

  const subscription = await db.subscription.create({
    userId,
    encrypted,
    amountCommitment: commitment.commitment
  });

  // Store key locally
  localStorage.setItem(`key-${subscription.id}`, bytesToHex(encryptionKey));

  return subscription;
}
```

### Pattern 3: Derive Deterministic Keys from Master Password

```typescript
// User sets password once, all keys derived from it
async function setupPrivacy(userId: string, masterPassword: string) {
  const user = await db.user.findById(userId);

  // Each subscription gets deterministic key
  for (const subscription of user.subscriptions) {
    const key = await deriveSubscriptionEncryptionKey(
      masterPassword,
      subscription.id
    );
    // Save encrypted metadata using this key
  }
}

// Later: User provides password, recreate all keys
async function unlockAllSubscriptions(masterPassword: string) {
  const subscriptions = await db.subscription.findByUser(userId);

  for (const sub of subscriptions) {
    const key = await deriveSubscriptionEncryptionKey(
      masterPassword,
      sub.id
    );
    const metadata = await decryptSubscriptionMetadata(key, sub.encrypted);
    // Use metadata
  }
}
```

## Step-by-Step Integration Walkthrough

### 1. Setup Phase

```typescript
async function setupPrivacyForNewUser(userId: string) {
  // Generate stealth identity
  const stealthMeta = generateStealthMetaAddress();

  // Save to database
  await db.user.update({
    id: userId,
    stealthMetaAddress: JSON.stringify(stealthMeta)
  });

  console.log("Privacy setup complete");
  return stealthMeta;
}
```

### 2. Subscription Creation Phase

```typescript
async function createPrivateSubscription(
  userId: string,
  metadata: SubscriptionMetadata
) {
  // Get user's stealth address
  const user = await db.user.findById(userId);
  const stealthMeta = JSON.parse(user.stealthMetaAddress);

  // Generate payment address
  const paymentAddress = deriveEphemeralStealthAddress(
    {
      viewPublicKey: stealthMeta.viewPublicKey,
      spendPublicKey: stealthMeta.spendPublicKey
    },
    `sub-${Date.now()}`
  );

  // Encrypt metadata
  const encryptionKey = crypto.getRandomValues(new Uint8Array(32));
  const encrypted = await encryptSubscriptionMetadata(
    bytesToHex(encryptionKey),
    metadata
  );

  // Create commitment to amount
  const commitment = commit(BigInt(Math.floor(metadata.price * 100)));

  // Save to database
  const subscription = await db.subscription.create({
    userId,
    encrypted,
    amountCommitment: commitment.commitment,
    paymentAddress: paymentAddress.stealthAddress,
    ephemeralPubkey: paymentAddress.ephemeralPubkey
  });

  // Store keys locally
  localStorage.setItem(`key-${subscription.id}`, bytesToHex(encryptionKey));
  localStorage.setItem(`blinding-${subscription.id}`, commitment.blindingFactor);

  return subscription;
}
```

### 3. Payment Phase

```typescript
async function processPayment(subscriptionId: string) {
  // Fetch subscription
  const subscription = await db.subscription.findById(subscriptionId);

  // Use the stealth payment address
  const paymentAddress = subscription.paymentAddress;

  // Initiate payment
  const transaction = {
    destination: paymentAddress,
    amount: subscription.amount,
    memo: subscription.ephemeralPubkey  // Include for recipient discovery
  };

  // Process payment (send to blockchain, etc.)
  return transaction;
}
```

### 4. Recovery Phase

```typescript
async function recoverSubscriptionDetails(
  subscriptionId: string,
  masterPassword: string
) {
  // Fetch encrypted data
  const subscription = await db.subscription.findById(subscriptionId);

  // Derive encryption key from password
  const encryptionKey = await deriveSubscriptionEncryptionKey(
    masterPassword,
    subscriptionId
  );

  // Decrypt metadata
  const metadata = await decryptSubscriptionMetadata(
    encryptionKey,
    subscription.encrypted
  );

  return metadata;
}
```

## Error Handling

```typescript
async function safeDecryptSubscription(subscriptionId: string, key: string) {
  try {
    const subscription = await db.subscription.findById(subscriptionId);
    const metadata = await decryptSubscriptionMetadata(key, subscription.encrypted);
    return metadata;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Decrypted data is not valid JSON')) {
        console.error('Wrong encryption key');
      } else if (error.message.includes('does not match schema')) {
        console.error('Corrupted or tampered data');
      } else if (error.message.includes('auth tag')) {
        console.error('Data integrity compromised');
      }
    }
    throw error;
  }
}
```

## Testing Your Privacy Integration

### Test 1: Verify Stealth Address Generation

```typescript
test('stealth addresses are unique per payment', () => {
  const meta = generateStealthMetaAddress();

  const addr1 = deriveEphemeralStealthAddress(meta, 'subscription:0');
  const addr2 = deriveEphemeralStealthAddress(meta, 'subscription:1');

  expect(addr1.stealthAddress).not.toEqual(addr2.stealthAddress);
  expect(addr1.ephemeralPubkey).not.toEqual(addr2.ephemeralPubkey);
});
```

### Test 2: Verify Encryption/Decryption

```typescript
test('encrypted metadata roundtrips', async () => {
  const key = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const original = {
    name: 'Netflix',
    price: 15.99,
    cycle: 'monthly' as const,
    provider: 'netflix.com'
  };

  const encrypted = await encryptSubscriptionMetadata(key, original);
  const decrypted = await decryptSubscriptionMetadata(key, encrypted);

  expect(decrypted).toEqual(original);
});
```

### Test 3: Verify Commitment

```typescript
test('commitment verification works', () => {
  const amount = 1500n;
  const commitment = commit(amount);

  const isValid = verify(amount, commitment.blindingFactor, commitment.commitment);
  expect(isValid).toBe(true);
});
```

## Deployment Checklist

- [ ] Generate stealth addresses for all users
- [ ] Encrypt all existing subscription metadata
- [ ] Create commitments for all amounts
- [ ] Store keys securely (in-memory, not in DB)
- [ ] Test recovery procedures
- [ ] Document key rotation process
- [ ] Set up backup/recovery system
- [ ] Monitor for decryption errors
- [ ] Test failover scenarios
- [ ] Implement audit logging

## Performance Considerations

| Operation | Time | Bottleneck |
|-----------|------|-----------|
| Generate stealth address | <1ms | None |
| Encrypt metadata | <1ms | Network (to save) |
| Verify commitment | <1ms | None |
| Derive key from password | ~50ms | PBKDF2 |
| Complete privacy stack | ~55ms | Key derivation |

For 1000s of subscriptions, use pagination or batching.

## Next Steps

1. Review [Security Considerations](./security-considerations.md) before going live
2. Read [Migration Guide](./migration-guide.md) if integrating into existing app
3. Test with [Test Vectors](./test-vectors.md)
4. Deploy following [Deployment Guide](./deployment-guide.md)

## Support

- **Examples**: See `sdk/examples/` directory
- **Issues**: github.com/Calebux/SYNCRO/issues
- **Security**: security@syncro.app
