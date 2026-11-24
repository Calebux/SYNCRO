# ADR-008: Self-Custodial Encryption Key Derivation (HKDF-SHA256)

**Status:** Accepted (Retrospective)  
**Date:** 2026-06-10  
**Deciders:** Security & Client Architecture Teams  
**Issue/PR:** Key Rotation Flow Implementation  

---

## Context

User subscription data (such as merchant names, account notes, custom tags, and billing amounts) contains sensitive personal financial information.
- Plaintext storage in PostgreSQL creates severe privacy and compliance vulnerabilities.
- Server-side key management (holding customer decryption keys on the API server) violates non-custodial design principles and exposes the platform to server breach risks.
- Web3 users expect zero-knowledge privacy where only their authenticated wallet can decrypt personal subscription details.

---

## Decision

We adopted **Client-Side Self-Custodial Encryption** using **HKDF-SHA256 Key Derivation** from the user's connected Stellar wallet.

- **Key Derivation Algorithm**:
  ```
  Stellar Wallet Public Key / Signature
      ↓ HKDF-SHA256 (salt: 'syncro-encryption', info: 'subscription-metadata-encryption-v1')
  256-bit AES-GCM Encryption Key
  ```
- **Execution Location**: All encryption and decryption operations occur strictly in the browser/client library (`client/lib/stellar-wallet.ts`).
- **Server Knowledge**: The database and backend receive only AES-GCM ciphertext, initialization vectors (IVs), and auth tags. No encryption keys are sent to or stored by the backend.
- **Key Rotation Architecture**: When a user updates their Stellar wallet, an automatic client-side re-encryption process re-encrypts all records with the new wallet-derived key.

---

## Consequences

### Positive
- **Zero-Knowledge Privacy**: Server breaches or leaked database backups reveal only unreadable ciphertext.
- **Self-Custodial Trust**: Users retain total control over their data decryption keys via their Web3 wallet.
- **No Master Secret Liability**: Eliminates the risk of a single compromised master encryption key exposing all user data.

### Negative
- **Wallet Loss Consequence**: If a user loses access to their private key/wallet and cannot complete key rotation, encrypted data is permanently unrecoverable.
- **Key Rotation Overhead**: Changing connected wallets requires batch re-encrypting all user records in the client interface.

---

## Compliance & Verification

- Client-side encryption functions in `client/lib/stellar-wallet.ts` and `client/lib/key-rotation-client.ts` are unit tested via Vitest.
- Backend API tests verify that sensitive subscription metadata columns store valid base64 AES-GCM ciphertext formats.
