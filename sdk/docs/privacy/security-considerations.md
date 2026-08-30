# Security Considerations

## Overview

This document outlines the security threat model, best practices, and common pitfalls when using SYNCRO privacy features.

**Read this before going to production.**

## Threat Model

### Adversaries We Protect Against

#### 1. Server Operator / Database Administrator
**Threat**: Steal subscription details and payment metadata

**Protection**:
- ✅ Metadata Encryption: Server sees only encrypted blob
- ✅ Commitments: Payment amounts hidden
- ✅ Stealth Addresses: Recipient wallet hidden

**Recommendation**: Use encryption for all sensitive data

#### 2. Network Observer (ISP, WiFi Provider, etc.)
**Threat**: Monitor payment patterns, infer subscription services

**Protection**:
- ✅ Stealth Addresses: Payment destinations unlinkable
- ✅ HTTPS: Encrypted transport layer
- ✅ Tor/VPN: Hide IP address

**Recommendation**: Combine with VPN or Tor for maximum privacy

#### 3. Third-Party Service Provider
**Threat**: Harvest subscription data from API responses

**Protection**:
- ✅ Client-side Decryption: Keys never leave your device
- ✅ Encrypted API Responses: Even if intercepted, unreadable
- ✅ Ephemeral Keys: Different payment for each transaction

**Recommendation**: Minimize data sent in API responses

#### 4. Payment Processor / Blockchain Observer
**Threat**: Link payments to your identity by correlating blockchain activity

**Protection**:
- ✅ Stealth Addresses: One-time addresses per payment
- ✅ Payment Channels: Batch multiple payments into one transaction
- ✅ Commitments: Amount hidden on-chain

**Recommendation**: Use stealth addresses + commitments + channels together

### Adversaries Outside Our Scope

#### ❌ Your Device (Malware, Keyloggers, Spyware)
If your device is compromised, **all bets are off**. An attacker with full device access can:
- Extract encryption keys from memory
- Capture plaintext data
- Intercept keystrokes
- Modify application behavior

**Mitigation**:
- Keep device updated with latest security patches
- Use antivirus/anti-malware
- Enable full-disk encryption
- Don't install suspicious applications
- Use password manager (reduces keylogging attack surface)

#### ❌ Stellar Blockchain (It's Public!)
The Stellar blockchain is public. Anyone can see all transactions.

**Privacy Design**:
- We make payments **unlinkable** (can't correlate payments to identity)
- Not **invisible** (blockchain is public)
- Stealth addresses + commitments + channels achieve unlinkability

**Recommendation**: If you need invisibility, use privacy coins or centralized mixer

#### ❌ Quantum Computers
If quantum computers are discovered that break ECDH/secp256k1:
- Stealth address schemes broken
- Encryption keys extractable
- Commitments compromised

**Timeline**: Estimated 10-20 years
**Recommendation**: Post-quantum cryptography research ongoing

#### ❌ Timing Analysis
If you always pay on the 1st of month, adversary infers subscription:
- Observer sees payment every 1st
- Might infer: Netflix (monthly), AWS (monthly), etc.

**Mitigation**: Use payment channels to batch payments

#### ❌ Amount Leakage Without Commitments
Stealth addresses hide recipient, not amount:

```typescript
// ❌ Privacy Problem:
// Payment to stealth address for $15.99
// Observer: "Netflix usually costs $15.99"

// ✅ Fix: Combine with commitments
// Payment to stealth address, amount hidden in commitment
// Observer: Can't infer service from amount
```

---

## Cryptographic Security

### Algorithms Used

| Algorithm | Purpose | Security Level | Status |
|-----------|---------|-----------------|--------|
| **secp256k1** | ECDH, stealth addresses | 256-bit | ✅ Proven |
| **Ristretto** | Pedersen commitments | 256-bit | ✅ Proven |
| **AES-256-GCM** | Metadata encryption | 256-bit | ✅ NIST Approved |
| **SHA-256** | Hashing, KDF | 256-bit | ✅ Proven |
| **PBKDF2** | Key derivation | Configurable | ⚠️ Slow OK |

### Key Sizes

- **Encryption keys**: 256 bits (32 bytes) — AES-256
- **Signing keys**: 256 bits (Ed25519)
- **Viewing keys**: 256 bits (secp256k1)
- **Blinding factors**: 256 bits (Ristretto scalar)

### Security Assumptions

Our security relies on these assumptions holding:

1. **Discrete Logarithm Problem Hard**: Can't extract private key from public key
2. **ECDH Security**: Shared secret from ECDH is secret
3. **Hash Function Preimage Resistance**: Can't find input matching hash
4. **Authenticated Encryption**: AES-GCM detects tampering
5. **Device Security**: Attacker can't access device memory

If any assumption breaks, security degrades.

---

## Key Management

### ✅ DO: Secure Key Storage

```typescript
// Best: In-memory only
class SecureKeyStore {
  private keys = new Map<string, string>();
  
  set(id: string, key: string) {
    this.keys.set(id, key);
  }

  get(id: string): string | null {
    const key = this.keys.get(id);
    return key;
  }

  // Secure clearing
  clear() {
    for (const key of this.keys.values()) {
      // Overwrite with zeros (prevents memory disclosure)
      for (let i = 0; i < key.length; i++) {
        key[i] = '0';
      }
    }
    this.keys.clear();
  }
}

// Clear keys on logout/session end
window.addEventListener('beforeunload', () => {
  keyStore.clear();
});
```

### ✅ DO: Derive Keys from User Password

```typescript
import { deriveSubscriptionEncryptionKey } from '@syncro/sdk';

// Derive key from user's password
// Same password + subscription = same key (deterministic)
const key = await deriveSubscriptionEncryptionKey(
  userPassword,
  subscriptionId
);

// Uses PBKDF2 with 100,000 iterations
// Makes brute-force attacks expensive (~50ms per attempt)
```

### ✅ DO: Rotate Keys Periodically

```typescript
// When user changes password, rotate all keys
async function rotateKeys(userId: string, oldPassword: string, newPassword: string) {
  const subscriptions = await db.subscription.find({ userId });

  for (const sub of subscriptions) {
    // Derive old key
    const oldKey = await deriveSubscriptionEncryptionKey(oldPassword, sub.id);

    // Decrypt with old key
    const metadata = await decryptSubscriptionMetadata(oldKey, sub.encryptedMetadata);

    // Derive new key
    const newKey = await deriveSubscriptionEncryptionKey(newPassword, sub.id);

    // Encrypt with new key
    const newEncrypted = await encryptSubscriptionMetadata(newKey, metadata);

    // Update database
    await db.subscription.update({
      id: sub.id,
      encryptedMetadata: newEncrypted
    });
  }
}
```

### ❌ DON'T: Store Keys in Database

```typescript
// NEVER do this:
await db.store({
  subscriptionId: 'sub-123',
  encryptionKey: 'aabbccdd...'  // ❌ COMPROMISED!
});

// If database is breached, all keys exposed
// Encryption becomes useless
```

### ❌ DON'T: Store Keys in localStorage

```typescript
// NEVER do this:
localStorage.setItem('encryption-key', keyHex);  // ❌ COMPROMISED!

// localStorage persists on disk unencrypted
// Malware can read it
// Browser data clearing won't help (disk still has it)
```

### ❌ DON'T: Send Keys to Server

```typescript
// NEVER do this:
await fetch('/api/save-key', {
  method: 'POST',
  body: JSON.stringify({ key: encryptionKey })  // ❌ COMPROMISED!
});

// Once key reaches server, encryption broken
// Server can decrypt all your data
```

### ❌ DON'T: Hardcode Keys

```typescript
// NEVER do this:
const ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
// ❌ Key visible in source code!

// Anyone with source code has your key
```

---

## Encryption Best Practices

### ✅ DO: Use Unique IVs

```typescript
// AES-GCM generates random IV for each encryption
const encrypted1 = await encryptSubscriptionMetadata(key, metadata1);
// encrypted1.iv = random A

const encrypted2 = await encryptSubscriptionMetadata(key, metadata2);
// encrypted2.iv = random B (different!)

// ✅ Correct: Each IV is unique
// ❌ Wrong: Reusing IV breaks security
```

### ✅ DO: Verify Authentication Tags

```typescript
// Decryption automatically verifies auth tag
try {
  const plaintext = await decryptSubscriptionMetadata(key, encrypted);
  // ✓ Auth tag verified, data authentic
} catch (error) {
  // ✗ Auth tag check failed
  // Either:
  // 1. Wrong key
  // 2. Data corrupted
  // 3. Data tampered
  console.error('Data integrity compromise detected');
}
```

### ✅ DO: Use Authenticated Encryption

```typescript
// ✅ Good: AES-GCM (authenticated encryption)
const encrypted = await encryptSubscriptionMetadata(key, data);

// ❌ Bad: AES-CBC without MAC
// Doesn't detect tampering
```

### ❌ DON'T: Reuse Encryption Keys

```typescript
// ❌ Wrong: Same key for different purposes
const key = 'aabbccdd...';
const encSubscription = await encryptSubscriptionMetadata(key, sub);
const encPayment = await encryptMetadata(paymentInfo, key);  // Same key!

// If one key is compromised, both are exposed

// ✅ Right: Different keys for different purposes
const subKey = deriveSubscriptionEncryptionKey(password, subscriptionId);
const paymentKey = derivePaymentEncryptionKey(password, transactionId);
```

---

## Stealth Address Security

### ✅ DO: Use Unique Entropy Per Payment

```typescript
// ✅ Correct: Different entropy each time
const addr1 = deriveEphemeralStealthAddress(meta, 'sub-123:payment-0');
const addr2 = deriveEphemeralStealthAddress(meta, 'sub-123:payment-1');

// addr1.ephemeralPubkey !== addr2.ephemeralPubkey
// Completely unlinkable
```

### ❌ DON'T: Reuse Ephemeral Keys

```typescript
// ❌ Wrong: Same entropy, same ephemeral key
const addr1 = deriveEphemeralStealthAddress(meta, 'entropy');
const addr2 = deriveEphemeralStealthAddress(meta, 'entropy');

// addr1.ephemeralPubkey === addr2.ephemeralPubkey
// Observer: "These two payments are related"
// Privacy: ❌ Broken!
```

### ✅ DO: Publish Ephemeral Key in Memo

```typescript
// Step 1: Generate address
const result = deriveEphemeralStealthAddress(meta, entropy);

// Step 2: Send payment
await sendPayment({
  destination: result.stealthAddress,
  amount: 1500,
  memo: result.ephemeralPubkey  // ✅ Publish this in memo
});

// Recipient uses ephemeralPubkey to detect payment
```

### ❌ DON'T: Hide Ephemeral Key

```typescript
// ❌ Wrong: Not including ephemeral key
await sendPayment({
  destination: result.stealthAddress,
  amount: 1500
  // No memo! Recipient can't find payment
});
```

### ✅ DO: Keep Viewing Key Private

```typescript
// ✅ Correct: Viewing key never leaves device
const viewingKey = meta.viewPublicKey;  // This is PUBLIC
const viewingPrivateKey = meta.viewingPrivateKey;  // THIS IS SECRET

// Only you need viewingPrivateKey to scan blockchain
// Never share, never send to server
```

---

## Commitment Security

### ✅ DO: Use Random Blinding Factors

```typescript
// ✅ Correct: Let SDK generate random blinding factor
const commitment = commit(amount);  // Random blinding

// ✅ Also OK: You provide random blinding factor
const blindingFactor = randomScalar();
const commitment = commit(amount, blindingFactor);
```

### ❌ DON'T: Reuse Blinding Factors

```typescript
// ❌ Wrong: Same blinding factor for two amounts
const blinding = 12345678n;
const com1 = commit(1000n, blinding);
const com2 = commit(2000n, blinding);

// Observer: com2 - com1 = 1000*G
// Adversary: "Second payment is $10 more than first"
// Privacy: ❌ Broken!
```

### ❌ DON'T: Reveal Blinding Factors Unnecessarily

```typescript
// ❌ Wrong: Revealing blinding factors to observers
const proof = {
  amount: 1500n,
  blindingFactor: commitment.blindingFactor,  // ❌ EXPOSED!
  commitment: commitment.commitment
};

// Once revealed, observer can:
// 1. Verify amount
// 2. Correlate with commitment in future transactions
```

---

## Network & Transport Security

### ✅ DO: Use HTTPS Only

```typescript
// ✅ Correct: Encrypted transport
const response = await fetch('https://api.syncro.app/subscriptions', {
  // ...
});

// ✅ Enforce HTTPS
app.use((req, res, next) => {
  if (req.protocol !== 'https') {
    return res.redirect(`https://${req.hostname}${req.url}`);
  }
  next();
});
```

### ✅ DO: Use Tor for Maximum Privacy

```typescript
// If using Node.js, route through Tor
import * as Socks5Client from 'socks5-client';

const client = new Socks5Client({
  host: '127.0.0.1',
  port: 9050
});

const response = await fetch('https://api.syncro.app', {
  // Routes through Tor
});
```

### ✅ DO: Set Security Headers

```typescript
// CSP prevents data exfiltration
app.use((req, res, next) => {
  res.header('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; " +
    "connect-src 'self' https://api.syncro.app"
  );
  next();
});

// HSTS forces HTTPS
app.use((req, res, next) => {
  res.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
```

### ❌ DON'T: Use Unencrypted HTTP

```typescript
// ❌ Wrong: Plaintext transport
const response = await fetch('http://api.syncro.app/subscriptions');

// Keys, metadata, everything exposed to network observer
```

---

## Common Mistakes

### Mistake 1: Forgetting to Encrypt Metadata

```typescript
// ❌ Wrong: Storing plaintext metadata
await db.subscription.create({
  userId,
  name: 'Netflix',  // ❌ Plaintext!
  price: 15.99,     // ❌ Plaintext!
  provider: 'netflix.com'  // ❌ Plaintext!
});

// ✅ Right: Encrypt before storing
const encrypted = await encryptSubscriptionMetadata(key, {
  name: 'Netflix',
  price: 15.99,
  provider: 'netflix.com'
});

await db.subscription.create({
  userId,
  encryptedMetadata: encrypted
});
```

### Mistake 2: Logging Sensitive Data

```typescript
// ❌ Wrong: Keys in logs
console.log('Encryption key:', encryptionKey);  // Visible in logs!
logger.info('Created subscription', { metadata: subscription }); // Plaintext!

// ✅ Right: Never log keys or plaintext
logger.info('Subscription created', {
  subscriptionId: subscription.id,
  // Don't log: key, plaintext metadata, amounts
});

// Sanitize logs
function sanitizeForLogging(obj: any) {
  const sanitized = { ...obj };
  delete sanitized.encryptionKey;
  delete sanitized.plaintext;
  delete sanitized.privateKey;
  return sanitized;
}
```

### Mistake 3: Assuming Server Can Access Metadata

```typescript
// ❌ Wrong: Server assuming it has plaintext
app.get('/api/subscriptions/:id', async (req, res) => {
  const sub = await db.subscription.findById(req.params.id);
  
  // Assuming plaintext exists
  res.json({
    name: sub.name,  // ❌ Might not exist if encrypted!
    price: sub.price
  });
});

// ✅ Right: Handle both plaintext and encrypted
app.get('/api/subscriptions/:id', async (req, res) => {
  const sub = await db.subscription.findById(req.params.id);

  if (sub.encryptedMetadata) {
    // Don't expose encrypted data in API
    return res.status(400).json({ error: 'Use client decryption' });
  }

  res.json({
    name: sub.name,
    price: sub.price
  });
});
```

### Mistake 4: Not Handling Decryption Errors

```typescript
// ❌ Wrong: Silently failing
try {
  const metadata = await decryptSubscriptionMetadata(key, encrypted);
} catch (error) {
  // Silently ignore?
}

// ✅ Right: Handle gracefully
try {
  const metadata = await decryptSubscriptionMetadata(key, encrypted);
} catch (error) {
  if (error instanceof Error) {
    if (error.message.includes('Decrypted data is not valid JSON')) {
      console.error('Corrupted encryption or wrong key');
      // Show user-friendly message
      return res.status(400).json({
        error: 'Could not decrypt subscription. Wrong password?'
      });
    } else if (error.message.includes('auth tag')) {
      console.error('Data tampering detected');
      return res.status(400).json({
        error: 'Data integrity check failed. Possible tampering.'
      });
    }
  }
  throw error;
}
```

---

## Security Checklist

Before deployment:

- [ ] All encryption keys generated randomly
- [ ] No hardcoded keys in source code
- [ ] Keys never stored in database
- [ ] Keys never sent to server
- [ ] All transport over HTTPS
- [ ] Security headers configured (CSP, HSTS, etc.)
- [ ] Sensitive data not logged
- [ ] Logs sanitized of keys/plaintext
- [ ] Decryption errors handled gracefully
- [ ] Unique IV for each encryption
- [ ] Auth tags verified automatically
- [ ] Stealth addresses have unique ephemeral keys
- [ ] Blinding factors random and unique
- [ ] No metadata leakage in API responses
- [ ] Device security guidance documented for users
- [ ] Threat model understood and accepted
- [ ] Assumptions documented (ECDH security, etc.)
- [ ] Disaster recovery tested
- [ ] Key rotation tested
- [ ] Encryption reversible and tested
- [ ] No plaintext backups exposed

---

## Audit & Monitoring

```typescript
// Track potential security issues
class SecurityAudit {
  async checkForPlaintextData() {
    const subscriptions = await db.subscription.find({
      name: { $exists: true },
      price: { $exists: true }
    });

    if (subscriptions.length > 0) {
      console.error(`⚠️ Found ${subscriptions.length} plaintext subscriptions`);
      // Alert team
    }
  }

  async checkForKeysInLogs() {
    const logs = await db.logs.find({
      message: /key|secret|private/i
    });

    if (logs.length > 0) {
      console.error(`⚠️ Found ${logs.length} logs mentioning keys`);
      // Investigate
    }
  }

  async checkForDecryptionFailures() {
    const errors = await db.errors.find({
      event: 'decryption_failed',
      timestamp: { $gte: new Date(Date.now() - 3600000) }
    });

    if (errors.length > 10) {
      // Alert: too many decryption failures
      // Possible: wrong keys, corrupted data, etc.
    }
  }
}
```

---

## Incident Response

### Data Breach (Keys Exposed)

1. **Immediate**: Invalidate exposed keys
2. **Short-term**: Re-encrypt all data with new keys
3. **Medium-term**: Notify affected users
4. **Long-term**: Improve key protection

### Tampering Detected (Auth Tag Fails)

1. **Immediate**: Log security event
2. **Short-term**: Restore from backup
3. **Investigation**: Determine cause
4. **Prevention**: Add monitoring

### Decryption Service Failure

1. **Immediate**: Fail gracefully
2. **Notify**: Alert operations team
3. **Investigate**: Check key store, database
4. **Recover**: Restore from backup

---

## Additional Resources

- [OWASP Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
- [NIST SP 800-38D: AES-GCM](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38d.pdf)
- [secp256k1 Security Analysis](https://en.bitcoin.it/wiki/Secp256k1)
- [Ristretto Group Documentation](https://ristretto.group/)
- [OWASP Top 10](https://owasp.org/Top10/)

---

## Questions?

- **Security Concerns**: security@syncro.app
- **Implementation Help**: github.com/Calebux/SYNCRO/discussions
- **Bug Reports**: github.com/Calebux/SYNCRO/issues
