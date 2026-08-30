# Privacy Features Guide

Welcome to SYNCRO's comprehensive privacy features guide. This documentation covers all privacy-preserving capabilities available in the `@syncro/sdk` package.

## Overview

SYNCRO provides end-to-end encryption and privacy-preserving payment mechanisms built on proven cryptographic primitives:

- **Stealth Addresses** — One-time payment addresses that prevent transaction linking
- **Metadata Encryption** — Client-side encryption for sensitive subscription data
- **Pedersen Commitments** — Hide payment amounts while maintaining verifiability
- **Payment Channels** — Off-chain payments with on-chain settlement
- **Zero-Knowledge Proofs** — Prove facts about data without revealing the data
- **Key Derivation** — Deterministic key generation for wallet management

## Quick Navigation

- [Stealth Addresses](./stealth-addresses.md) — One-time payment addresses
- [Metadata Encryption](./metadata-encryption.md) — Encrypt subscription details
- [Pedersen Commitments](./pedersen-commitments.md) — Hide payment amounts
- [Payment Channels](./payment-channels.md) — Off-chain payments
- [Zero-Knowledge Proofs](./zk-proofs.md) — Prove without revealing
- [Key Derivation](./key-derivation.md) — Deterministic key generation
- [Integration Guide](./integration-guide.md) — Build privacy into your app
- [Migration Guide](./migration-guide.md) — Add privacy to existing apps
- [Security Considerations](./security-considerations.md) — Threat models and best practices

## What Problem Does Privacy Solve?

**Privacy Problem**: When you subscribe to services, every payment reveals:
- Your identity (linked to your wallet)
- What service you're paying for
- How much you're spending
- When you renew
- Your payment patterns

**SYNCRO Solution**: Using cryptographic privacy features, you can:
- Hide your identity (stealth addresses)
- Hide payment amounts (commitments)
- Hide payment timing (channels)
- Encrypt service details (metadata encryption)
- Prove payment without revealing it (zero-knowledge)

## Feature Matrix

| Feature | Use Case | Privacy Gain | Performance |
|---------|----------|-------------|-------------|
| **Stealth Addresses** | One-time payments | Hides recipient identity | Fast |
| **Metadata Encryption** | Hide subscription details | Server can't see what you pay for | Fast |
| **Pedersen Commitments** | Hide amounts | Observer can't see payment value | Fast |
| **Payment Channels** | Multiple payments | Batches on-chain | Very Fast |
| **Zero-Knowledge** | Prove facts | No data leakage | Depends |
| **Key Derivation** | Wallet keys | Deterministic generation | Fast |

## Getting Started

### 1. Stealth Payment (Simplest)

```typescript
import { generateStealthMetaAddress, deriveEphemeralStealthAddress } from '@syncro/sdk';

// Step 1: Generate stealth meta-address (once)
const meta = generateStealthMetaAddress();
console.log('Share this with payers:', meta.encoded);

// Step 2: Generate one-time address for each payment
const result = deriveEphemeralStealthAddress(
  { viewPublicKey: meta.viewingPubkey, spendPublicKey: meta.spendingPubkey },
  'unique-entropy-per-payment'
);
console.log('Send payment to:', result.stealthAddress);
```

### 2. Encrypt Subscription Details

```typescript
import { encryptSubscriptionMetadata, decryptSubscriptionMetadata } from '@syncro/sdk';

// Encrypt
const encrypted = await encryptSubscriptionMetadata('your-aes-key', {
  name: 'Netflix',
  price: 15.99,
  cycle: 'monthly',
  provider: 'netflix.com'
});

// Decrypt (only you have the key)
const decrypted = await decryptSubscriptionMetadata('your-aes-key', encrypted);
console.log(decrypted.name); // "Netflix"
```

### 3. Hide Payment Amount with Commitment

```typescript
import { commit, verify } from '@syncro/sdk';

// Create commitment to amount
const amount = 1000n; // in cents
const { commitment, blindingFactor } = commit(amount);

// Later, prove the amount without revealing
const isValid = verify(amount, blindingFactor, commitment);
console.log('Verified:', isValid);
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│         Your Privacy-Preserving App                │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌───────────────┐  ┌────────────────┐            │
│  │ Stealth       │  │ Metadata       │            │
│  │ Addresses     │  │ Encryption     │            │
│  └───────────────┘  └────────────────┘            │
│                                                     │
│  ┌───────────────┐  ┌────────────────┐            │
│  │ Commitments   │  │ Payment        │            │
│  │               │  │ Channels       │            │
│  └───────────────┘  └────────────────┘            │
│                                                     │
├─────────────────────────────────────────────────────┤
│           @syncro/sdk Crypto Module                │
│                                                     │
│  • secp256k1 • Ristretto • AES-GCM                │
│  • HKDF-SHA256 • Pedersen • ECDH                  │
├─────────────────────────────────────────────────────┤
│                                                     │
│     Your Data (Encrypted On-Device)               │
│     Stellar Ledger (Can't correlate payments)     │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Security Guarantees

✅ **Confidentiality**: Data encrypted before leaving device
✅ **Authenticity**: Cryptographic signatures verify data
✅ **Integrity**: Any tampering detected
✅ **Non-repudiation**: Signer cannot deny signing
✅ **Forward Secrecy**: Compromising one key doesn't compromise others

## Threat Model

**Adversaries We Protect Against**:
- ✅ Server operator (can't see unencrypted data)
- ✅ Network observer (can't link payments to identity)
- ✅ Third-party service provider (doesn't receive data)
- ✅ ISP (can't see what services you pay for)

**Adversaries Outside Scope**:
- ❌ Your device (if compromised, all bets off)
- ❌ Stellar blockchain (it's public, but payments are unlinkable)
- ❌ Timing attacks (use payment channels to hide timing)

## Next Steps

1. **Choose Your Privacy Feature**: Review the feature matrix above
2. **Read the Specific Guide**: See feature-specific documentation
3. **Review Security**: Check [Security Considerations](./security-considerations.md)
4. **Follow Integration Guide**: See [Integration Guide](./integration-guide.md)
5. **Migrate Existing App**: See [Migration Guide](./migration-guide.md)

## API Reference Summary

| Module | Function | Purpose |
|--------|----------|---------|
| stealth-derive | `generateStealthMetaAddress()` | Create stealth identity |
| stealth-derive | `deriveEphemeralStealthAddress()` | One-time address per payment |
| metadata-encryption | `encryptSubscriptionMetadata()` | Encrypt subscription details |
| metadata-encryption | `decryptSubscriptionMetadata()` | Decrypt subscription details |
| pedersen | `commit()` | Hide amount in commitment |
| pedersen | `verify()` | Verify commitment matches amount |
| key-derivation | `deriveSubscriptionEncryptionKey()` | Derive encryption key |
| payment-commitment | `createPaymentCommitment()` | Create payment proof |
| payment-commitment | `verifyPaymentCommitment()` | Verify payment proof |

## Support & Resources

- **Documentation**: See guides in this directory
- **API Reference**: See JSDoc comments in `@syncro/sdk` source
- **Examples**: See integration-guide.md for copy-pasteable code
- **Issues**: Report bugs at github.com/Calebux/SYNCRO/issues
- **Security**: Report vulnerabilities to security@syncro.app

## Version

- SYNCRO SDK: v1.0+
- Crypto Primitives: secp256k1, Ristretto, AES-GCM
- Last Updated: 2026-06-26
