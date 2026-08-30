# Privacy-Preserving Audit Commitments - Architecture Review

**Date:** 2026-06-24  
**Reviewer:** Senior Cryptography Engineer  
**Status:** Pre-Implementation Analysis

## Executive Summary

This document provides a comprehensive architecture review of the current audit logging system and proposes a privacy-preserving commitment-based approach that maintains operational functionality while enabling selective disclosure.

---

## 1. Current System Analysis

### 1.1 Audit Log Structure

**Location:** `contracts/contracts/subscription_logging/src/lib.rs`

#### Current Data Model

```rust
pub struct LogEntry {
    pub sub_id: u64,           // Subscription identifier
    pub event: LogEvent,        // Event type enum
    pub timestamp: u64,         // Unix timestamp
    pub data: String,           // Arbitrary plaintext data
}

pub enum LogEvent {
    Reminder,
    Approval,
    Renewal,
    Failure,
    Retry,
    Cancellation,
}
```

#### Storage Mechanism
- **Storage Type:** Persistent storage keyed by `sub_id`
- **Structure:** Vector of `LogEntry` per subscription
- **Access Pattern:** Admin-gated writes, unrestricted reads via `get_logs(sub_id)`

#### Privacy Issues Identified
1. **Plaintext metadata exposure:** `sub_id`, `data`, `timestamp` are fully visible on-chain
2. **Correlation attacks:** All events for a `sub_id` are grouped, enabling full subscription timeline reconstruction
3. **Metadata leakage:** Event types, frequency, and timing patterns are public
4. **No selective disclosure:** Users must expose all logs or none

---

### 1.2 Backend Integration Architecture

**Location:** `backend/src/services/blockchain-service.ts`

#### Event Flow

```
User Action → Backend Service → Database Log → Blockchain Write → Database Update
```

#### Current Data Exposure Points

**Reminder Events:**
```typescript
{
  subscriptionId: string,
  subscriptionName: string,    // SENSITIVE
  reminderType: string,
  renewalDate: string,          // SENSITIVE
  daysBefore: number,
  price: string | number,       // SENSITIVE
  billingCycle: string,         // SENSITIVE
  deliveryChannels: string[],   // SENSITIVE
  timestamp: string
}
```

**Subscription Operations:**
```typescript
{
  subscriptionId: string,
  operation: string,
  subscriptionName: string,     // SENSITIVE
  price: string | number,       // SENSITIVE
  billingCycle: string,         // SENSITIVE
  status: string,               // SENSITIVE
  timestamp: string
}
```

**Gift Card Events:**
```typescript
{
  subscriptionId: string,
  giftCardHash: string,
  provider: string,             // POTENTIALLY SENSITIVE
  eventType: string,
  timestamp: string
}
```

#### Database Schema

**Table:** `blockchain_logs`
```sql
CREATE TABLE blockchain_logs (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,        -- Links to auth.users
  event_type TEXT NOT NULL,
  event_data JSONB NOT NULL,     -- Contains all sensitive data
  transaction_hash TEXT,
  block_number TEXT,
  status TEXT,                   -- 'pending', 'confirmed', 'failed'
  error_message TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

**Key Observations:**
- Database stores plaintext `event_data` for operational queries
- Off-chain database serves as source of truth
- Blockchain writes are best-effort with retry logic
- Transaction hashes link database records to on-chain commitments

---

### 1.3 Compliance & GDPR Export Flow

**Location:** `backend/src/services/compliance-service.ts`

#### Current Export Data Structure

```typescript
interface UserExportData {
  profile: any;
  subscriptions: any[];
  notifications: any[];
  auditLogs: any[];
  preferences: any;
  emailAccounts: any[];
  teams: any[];
  blockchainLogs: {
    contractEvents: any[];
    renewalApprovals: any[];
  };
  blindingFactors: any[];  // ← Already anticipated!
}
```

**Key Finding:** The compliance service already anticipates `blindingFactors` in the export schema, indicating prior planning for cryptographic commitments.

#### Data Gathering Process

```typescript
await supabase.from('commitment_blinding_factors').select('*').eq('user_id', userId)
```

**Table Does Not Yet Exist** - needs to be created in migration.

---

### 1.4 Existing Anomaly Detection & Admin Queries

**Observation Points:**

1. **Admin Dashboard Queries:**
   - Status-based filtering (`idx_blockchain_logs_status_created`)
   - Subscription-based queries (`idx_blockchain_logs_subscription`)
   - Time-based range queries

2. **Operational Requirements:**
   - Real-time monitoring of failed transactions
   - Subscription activity tracking
   - User behavior analytics
   - Compliance reporting

**Critical Constraint:** These operations MUST continue functioning after implementing privacy commitments. This requires maintaining off-chain plaintext database alongside on-chain commitments.

---

## 2. Soroban Cryptographic Capabilities Assessment

### 2.1 Soroban SDK Version & Environment

**Version:** Soroban SDK 26 (latest stable)  
**Language:** Rust `no_std` environment  
**Compute Budget:** Limited transaction execution units  
**Storage Cost:** Optimized for minimal on-chain data

### 2.2 Available Cryptographic Primitives

#### Built-in Hash Functions
- ✅ **SHA-256**: Available via `soroban_sdk::crypto`
- ✅ **Keccak-256**: Available for Ethereum compatibility
- ✅ **BLAKE2b**: Not natively available in SDK 26

#### Elliptic Curve Operations
- ❌ **Pedersen Commitments**: Not natively supported
- ❌ **Curve25519/Ed25519**: Limited to signature verification
- ❌ **BLS12-381 pairing**: Not available
- ❌ **Arbitrary scalar multiplication**: Not exposed in SDK

#### Available Approaches
1. **Hash-based commitments** using SHA-256 ✅
2. **Merkle trees** using repeated hashing ✅
3. **Custom cryptographic implementations** (requires audit) ⚠️

### 2.3 Pedersen Commitments Feasibility Analysis

**Pedersen Commitment Formula:**
```
C = g^v · h^r
```

**Requirements:**
- Elliptic curve point multiplication
- Group operations
- Generator points (g, h)

**Verdict:** ❌ **Not Practical in Soroban SDK 26**

**Reasons:**
1. No native elliptic curve arithmetic beyond signature verification
2. Custom implementation would require:
   - ~2000+ lines of audited curve arithmetic
   - Significant compute budget consumption
   - Complex security analysis
3. Storage overhead for curve points
4. Poor maintainability and auditability

---

## 3. Proposed Cryptographic Design

### 3.1 Hash-Based Commitment Scheme

Given Soroban's constraints, we propose a **hash-based commitment scheme** using SHA-256:

```
commitment = SHA256(event_data || blinding_factor || salt)
```

#### Scheme Properties

**Commitment Generation:**
```rust
commitment = SHA256(
    sub_id || 
    event_type || 
    timestamp || 
    data || 
    blinding_factor ||
    domain_separator
)
```

**Opening/Verification:**
```
verify(commitment, event_data, blinding_factor):
    return commitment == SHA256(event_data || blinding_factor || salt)
```

#### Security Properties

✅ **Hiding:** Computationally infeasible to derive `event_data` from `commitment` (preimage resistance)  
✅ **Binding:** Cannot find different `(event_data', blinding_factor')` producing same commitment (collision resistance)  
✅ **Selective Disclosure:** User reveals `(event_data, blinding_factor)` for specific events only  
✅ **Non-malleable:** Domain separator prevents cross-protocol attacks

#### Comparison to Pedersen

| Property | Pedersen | Hash-Based |
|----------|----------|------------|
| Hiding | Perfect (information-theoretic) | Computational (SHA-256 preimage resistance) |
| Binding | Computational (discrete log) | Computational (collision resistance) |
| Homomorphic | ✅ Yes | ❌ No |
| Soroban Efficient | ❌ No | ✅ Yes |
| Well-Studied | ✅ Yes | ✅ Yes |
| Audit Complexity | High | Low |

**Trade-off Justification:** We sacrifice perfect hiding and homomorphic properties for practical implementation, efficient verification, and maintainability. SHA-256's 128-bit security margin provides strong computational hiding suitable for audit log privacy.

---

### 3.2 Commitment Format Specification

#### On-Chain Commitment Structure

```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuditCommitment {
    pub commitment_hash: BytesN<32>,  // SHA-256 output
    pub timestamp: u64,                 // Ledger timestamp
    pub commitment_index: u64,          // Monotonic counter
}
```

#### Serialization Rules

**Event Data Canonicalization:**
```
canonical_bytes = encode_u64(sub_id) ||
                  encode_u8(event_type_discriminant) ||
                  encode_u64(timestamp) ||
                  encode_string_length_prefixed(data) ||
                  encode_bytes32(blinding_factor) ||
                  encode_string("SYNCRO_AUDIT_V1")  // Domain separator
```

**Encoding Functions:**
- `encode_u64`: Little-endian 8-byte representation
- `encode_u8`: Single byte
- `encode_string_length_prefixed`: `len(utf8) || utf8_bytes`
- `encode_bytes32`: Raw 32 bytes
- Domain separator prevents cross-context attacks

---

### 3.3 Merkle Tree Design

#### Structure

```
                    Merkle Root (on-chain)
                   /                      \
            Hash(C1,C2)                Hash(C3,C4)
           /          \                /          \
    Commit(E1)   Commit(E2)    Commit(E3)   Commit(E4)
```

#### Batching Strategy

**Approach:** Periodic batch commitment (e.g., daily or per-block)

**Benefits:**
1. Reduces on-chain storage costs (single root vs. N commitments)
2. Hides event count within batch window
3. Enables efficient membership proofs

**Tree Construction:**
```rust
// Leaf nodes
leaves = [SHA256(commitment_1), SHA256(commitment_2), ...]

// Tree construction
while leaves.len() > 1:
    next_level = []
    for i in (0..leaves.len()).step_by(2):
        left = leaves[i]
        right = leaves.get(i+1).unwrap_or(left)  // Duplicate if odd
        next_level.push(SHA256(left || right))
    leaves = next_level

merkle_root = leaves[0]
```

#### Proof Format

**Membership Proof:**
```rust
pub struct MerkleProof {
    pub commitment: BytesN<32>,
    pub index: u64,
    pub path: Vec<BytesN<32>>,      // Sibling hashes
    pub directions: Vec<bool>,       // Left/right indicators
    pub root: BytesN<32>,
}
```

**Verification:**
```rust
fn verify_merkle_proof(proof: MerkleProof) -> bool {
    let mut current = proof.commitment;
    for (sibling, is_left) in proof.path.iter().zip(proof.directions.iter()) {
        current = if *is_left {
            SHA256(current || sibling)
        } else {
            SHA256(sibling || current)
        };
    }
    current == proof.root
}
```

---

### 3.4 Threat Model

#### Adversary Capabilities

**Passive Observer:**
- Can read all on-chain data
- Can read public blockchain state
- Cannot access off-chain database
- Cannot compromise backend secrets

**Active Attacker:**
- Can submit arbitrary transactions
- Can attempt to forge commitments
- Can try to link commitments
- Cannot break SHA-256

**Malicious Insider:**
- May have backend database access
- May attempt to steal blinding factors
- Subject to access control and audit logs

#### Security Goals

1. **Privacy:** On-chain data reveals no subscription metadata
2. **Authenticity:** Only legitimate events produce valid commitments
3. **Non-repudiation:** Users cannot deny events they committed to
4. **Selective Disclosure:** Users control what they reveal
5. **Unlinkability:** Commitments cannot be linked without opening

#### Attacks & Mitigations

| Attack | Description | Mitigation |
|--------|-------------|------------|
| **Preimage Attack** | Derive `event_data` from `commitment` | SHA-256 preimage resistance (2^256 operations) |
| **Collision Attack** | Find different inputs with same commitment | SHA-256 collision resistance (2^128 operations) |
| **Timing Analysis** | Infer events from timestamp patterns | Batch commitments; add timestamp jitter |
| **Replay Attack** | Reuse disclosed commitment | Include monotonic `commitment_index` |
| **Linkability Attack** | Correlate commitments by `sub_id` | Remove `sub_id` from on-chain storage |
| **Blinding Factor Theft** | Steal from database | Encrypt at rest; key rotation; access control |
| **Malleable Commitment** | Alter commitment structure | Domain separator; canonical encoding |
| **Side-Channel Leakage** | Infer data from gas usage | Constant-time operations; fixed-size data |

---

### 3.5 Trust Assumptions

1. **SHA-256 Security:** SHA-256 is collision-resistant and preimage-resistant
2. **Backend Security:** Backend database and secret storage are secure
3. **User Device Security:** Users securely store GDPR export data containing blinding factors
4. **Timing Assumptions:** Blockchain timestamps are accurate within reasonable bounds
5. **No Quantum Computer:** (SHA-256 provides ~128-bit post-quantum security via Grover's algorithm)

---

## 4. Implementation Architecture

### 4.1 System Components

```
┌─────────────────────────────────────────────────────────────┐
│                       User Request                          │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│              Backend Service                                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 1. Generate cryptographically secure blinding factor │   │
│  │ 2. Compute commitment = SHA256(event || blinding)   │   │
│  │ 3. Store plaintext + blinding factor in database     │   │
│  │ 4. Write commitment to Soroban contract              │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────┬───────────────────────────────────────────┘
                  │
        ┌─────────┴─────────┐
        │                   │
        ▼                   ▼
┌──────────────┐    ┌──────────────────┐
│   Database   │    │ Soroban Contract │
│  (Plaintext  │    │  (Commitments    │
│   + Blinding)│    │    Only)         │
└──────────────┘    └──────────────────┘
        │                   │
        └─────────┬─────────┘
                  │
                  ▼
        ┌──────────────────┐
        │  GDPR Export     │
        │  (event_data +   │
        │   blinding_factor)│
        └──────────────────┘
                  │
                  ▼
        ┌──────────────────┐
        │ Selective        │
        │ Disclosure       │
        │ (Client Library) │
        └──────────────────┘
```

### 4.2 Modified Soroban Contract

**Storage Changes:**

```rust
// Before (plaintext)
DataKey::Logs(sub_id) -> Vec<LogEntry>

// After (commitments)
DataKey::Commitments -> Vec<AuditCommitment>
DataKey::CommitmentCount -> u64
```

**Key Design Decision:** Remove `sub_id` from storage key to prevent on-chain linkage.

**Contract Interface:**

```rust
pub fn record_commitment(
    env: Env,
    commitment_hash: BytesN<32>
) -> u64;  // Returns commitment_index

pub fn get_commitment(
    env: Env,
    commitment_index: u64
) -> Option<AuditCommitment>;

pub fn get_commitment_count(env: Env) -> u64;

// For Merkle batching (Phase 4)
pub fn commit_merkle_root(
    env: Env,
    root: BytesN<32>,
    start_index: u64,
    end_index: u64
);
```

### 4.3 Database Schema Changes

**New Table:** `commitment_blinding_factors`

```sql
CREATE TABLE commitment_blinding_factors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  commitment_hash BYTEA NOT NULL,           -- 32 bytes
  commitment_index BIGINT NOT NULL,
  blinding_factor BYTEA NOT NULL,           -- 32 bytes, encrypted
  event_type TEXT NOT NULL,
  event_data JSONB NOT NULL,                -- Original plaintext
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_commitment_hash UNIQUE(commitment_hash),
  CONSTRAINT unique_commitment_index UNIQUE(commitment_index)
);

CREATE INDEX idx_blinding_factors_user ON commitment_blinding_factors(user_id);
CREATE INDEX idx_blinding_factors_commitment ON commitment_blinding_factors(commitment_hash);
CREATE INDEX idx_blinding_factors_index ON commitment_blinding_factors(commitment_index);
```

**Encryption Strategy:** `blinding_factor` column encrypted at rest using application-level encryption (AES-256-GCM) with keys from secret provider.

### 4.4 Backend Service Changes

**Key Responsibilities:**

1. **Secure Random Generation:**
```typescript
import crypto from 'crypto';

function generateBlindingFactor(): Buffer {
  return crypto.randomBytes(32);  // 256 bits
}
```

2. **Commitment Computation:**
```typescript
function computeCommitment(
  eventData: any,
  blindingFactor: Buffer
): Buffer {
  const encoder = new CommitmentEncoder();
  const canonical = encoder.encode(eventData);
  const input = Buffer.concat([canonical, blindingFactor]);
  return crypto.createHash('sha256').update(input).digest();
}
```

3. **Atomic Storage:**
```typescript
await db.transaction(async (tx) => {
  // Store blinding factor
  await tx.insert('commitment_blinding_factors', {
    user_id,
    commitment_hash,
    commitment_index,
    blinding_factor: encrypt(blindingFactor),
    event_type,
    event_data
  });
  
  // Write commitment to blockchain
  await blockchain.writeCommitment(commitment_hash);
});
```

### 4.5 Client Library: Selective Disclosure

**New File:** `client/lib/audit-disclosure.ts`

```typescript
export interface DisclozurePackage {
  commitment_hash: string;        // Hex-encoded
  commitment_index: number;
  event_data: any;
  blinding_factor: string;        // Hex-encoded
  verification_url: string;
}

export class AuditDisclosureClient {
  /**
   * Generate a disclosure package for a specific audit event
   */
  async generateDisclosure(
    userId: string,
    commitmentIndex: number
  ): Promise<DisclosurePackage>;
  
  /**
   * Verify a disclosure package
   */
  async verifyDisclosure(
    package: DisclosurePackage
  ): Promise<{
    valid: boolean;
    onChainMatch: boolean;
    timestamp?: Date;
  }>;
  
  /**
   * Generate Merkle membership proof
   */
  async generateMerkleProof(
    commitmentIndex: number
  ): Promise<MerkleProof>;
  
  /**
   * Verify Merkle proof
   */
  async verifyMerkleProof(
    proof: MerkleProof
  ): Promise<boolean>;
}
```

---

## 5. Operational Considerations

### 5.1 Preserving Existing Functionality

**Database as Source of Truth:**
- `blockchain_logs` table continues storing plaintext `event_data`
- Admin queries, anomaly detection, reporting all use database
- No breaking changes to existing operational tooling

**Parallel Logging:**
```typescript
async logEvent(userId, eventData) {
  // 1. Database log (plaintext) - for ops
  await db.insert('blockchain_logs', {
    user_id: userId,
    event_type: eventData.type,
    event_data: eventData,
    status: 'pending'
  });
  
  // 2. Generate commitment
  const blindingFactor = generateBlindingFactor();
  const commitment = computeCommitment(eventData, blindingFactor);
  
  // 3. Store blinding factor
  await db.insert('commitment_blinding_factors', {
    user_id: userId,
    commitment_hash: commitment,
    blinding_factor: encrypt(blindingFactor),
    event_data: eventData
  });
  
  // 4. Write commitment on-chain
  await soroban.recordCommitment(commitment);
}
```

### 5.2 Migration Strategy

**Backward Compatibility:**
- New contracts deployed alongside existing `subscription_logging`
- Gradual rollout using feature flags
- Existing logs remain queryable
- No data migration required

**Feature Flag:**
```typescript
if (featureFlags.auditCommitments) {
  await commitmentService.logEvent(userId, eventData);
} else {
  await legacyService.logEvent(userId, eventData);
}
```

### 5.3 Performance Impact

**On-Chain Storage:**
- Before: ~200 bytes per log entry
- After: 32 bytes (commitment) + 8 bytes (timestamp) + 8 bytes (index) = 48 bytes
- **Savings:** ~75% reduction

**Compute Cost:**
- SHA-256: ~1000 gas units (negligible)
- No expensive curve operations

**Backend Overhead:**
- Additional database table
- Blinding factor encryption/decryption
- Commitment computation (< 1ms)

---

## 6. Phase Implementation Roadmap

### Phase 1: Cryptographic Foundation ✅ (This Document)
- [x] Architecture review
- [x] Threat model
- [x] Cryptographic design selection
- [x] Security analysis

### Phase 2: Soroban Contract Implementation
- [ ] Implement hash-based commitment scheme
- [ ] Update contract storage model
- [ ] Add commitment recording functions
- [ ] Write comprehensive tests

### Phase 3: Backend Integration
- [ ] Create database migration for `commitment_blinding_factors`
- [ ] Implement secure blinding factor generation
- [ ] Add commitment computation logic
- [ ] Integrate with blockchain service
- [ ] Add encryption for blinding factors at rest

### Phase 4: Client Disclosure Library
- [ ] Implement `audit-disclosure.ts`
- [ ] Add disclosure package generation
- [ ] Add verification functions
- [ ] Build user-facing UI components

### Phase 5: Merkle Tree Implementation
- [ ] Design batching strategy
- [ ] Implement Merkle tree construction
- [ ] Add proof generation
- [ ] Add proof verification
- [ ] Update contract with root anchoring

### Phase 6: GDPR Integration
- [ ] Update `compliance-service.ts`
- [ ] Include blinding factors in exports
- [ ] Add verification instructions to export
- [ ] Test end-to-end disclosure workflow

### Phase 7: Time-Range Proof Framework
- [ ] Design abstraction interfaces
- [ ] Document upgrade path to ZK proofs
- [ ] Create proof-of-concept implementation
- [ ] Document security assumptions

### Phase 8: Security Review
- [ ] Internal security review
- [ ] Penetration testing
- [ ] Third-party cryptographic audit (recommended)
- [ ] Document findings and mitigations

### Phase 9: Testing & Validation
- [ ] Unit tests (contract, backend, client)
- [ ] Integration tests
- [ ] End-to-end disclosure tests
- [ ] Performance benchmarks
- [ ] Privacy validation tests

### Phase 10: Documentation & Deployment
- [ ] User documentation
- [ ] Admin documentation
- [ ] API documentation
- [ ] Deployment guide
- [ ] Incident response playbook

---

## 7. Future Extensions

### 7.1 Zero-Knowledge Proofs

**Goal:** Enable time-range proofs without revealing specific events

**Approach:**
- Use zkSNARKs (e.g., Groth16, Plonk) to prove:
  - "I had an active subscription during period X"
  - Without revealing service name, price, or exact dates

**Constraints:**
- Requires off-chain proof generation (circuits)
- On-chain verification in Soroban (verifier contract)
- Significant engineering effort
- Current Soroban SDK may not support BN254/BLS12-381 pairings

**Architecture:**
```
User Device → Generate ZK Proof → Submit to Soroban → Verify On-Chain
```

**Upgrade Path:**
1. Design circuit for subscription predicates
2. Implement proof generation library (client-side)
3. Deploy verifier contract (Soroban)
4. Integrate with disclosure UI

### 7.2 Threshold Cryptography

**Goal:** Distributed commitment generation requiring k-of-n parties

**Use Case:** High-value subscriptions requiring multi-party approval

### 7.3 Revocation Mechanisms

**Goal:** Invalidate compromised commitments

**Approach:** On-chain revocation list with proof of authorization

---

## 8. Recommendations

### Immediate Actions

1. ✅ **Approve Architecture:** This hash-based commitment design is sound for the requirements
2. **Begin Phase 2:** Start implementing Soroban contract changes
3. **Security Review:** Schedule external cryptographic audit after Phase 3
4. **Stakeholder Communication:** Brief compliance, legal, and ops teams on changes

### Long-Term Investments

1. **ZK Proof Research:** Begin exploring zkSNARK integration for time-range proofs
2. **Formal Verification:** Consider formal verification of commitment scheme using tools like TLA+ or Coq
3. **Hardware Security Modules:** Consider HSM for blinding factor key management in production

---

## 9. Conclusion

The proposed hash-based commitment scheme with selective disclosure provides:

✅ **Privacy:** No plaintext subscription data on-chain  
✅ **Auditability:** Users can prove specific events to auditors  
✅ **Operational Continuity:** Existing admin/compliance tools unaffected  
✅ **Security:** Strong cryptographic guarantees via SHA-256  
✅ **Efficiency:** Minimal on-chain storage and compute costs  
✅ **Maintainability:** Simple, auditable implementation  
✅ **Extensibility:** Clear upgrade path to advanced ZK proofs  

**Status:** Ready to proceed with implementation.

---

## Appendices

### Appendix A: Cryptographic Notation

- `||` : Concatenation
- `SHA256(x)` : SHA-256 hash function
- `encode_*(x)` : Canonical encoding function
- `g, h` : Generator points (Pedersen context)
- `^` : Exponentiation (group operation)

### Appendix B: References

1. Pedersen Commitments (1991): https://link.springer.com/chapter/10.1007/3-540-46766-1_9
2. Merkle Trees (1979): https://en.wikipedia.org/wiki/Merkle_tree
3. Soroban Documentation: https://soroban.stellar.org/docs
4. GDPR Article 20 (Right to Data Portability): https://gdpr-info.eu/art-20-gdpr/
5. SHA-256 Specification: FIPS 180-4

### Appendix C: Glossary

- **Commitment:** Cryptographic primitive that hides data while binding to it
- **Blinding Factor:** Random value used to hide committed data
- **Opening:** Revealing commitment by disclosing original data and blinding factor
- **Merkle Proof:** Logarithmic-size proof of membership in a Merkle tree
- **Selective Disclosure:** Revealing specific data items without exposing others
- **Domain Separator:** String that prevents cross-protocol cryptographic attacks

---

**Document Version:** 1.0  
**Last Updated:** 2026-06-24  
**Next Review:** After Phase 3 completion
