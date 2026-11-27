# Security Analysis: Hash-Based Audit Commitments

**Date:** 2026-06-24  
**Classification:** Internal Security Review  
**Scope:** Privacy-preserving audit commitment system

---

## 1. Cryptographic Design Rationale

### 1.1 Why Not Pedersen Commitments?

**Initial Proposal:** Pedersen commitments `C = g^v · h^r`

**Rejection Reasons:**

1. **Soroban SDK Limitations (SDK 26):**
   - No native elliptic curve point multiplication beyond Ed25519 signatures
   - No exposed scalar arithmetic operations
   - No BLS12-381 or BN254 pairing support

2. **Implementation Complexity:**
   - Custom curve arithmetic: ~2000-3000 lines of security-critical code
   - Requires formal security audit ($50k-$100k)
   - Maintenance burden for non-standard cryptography
   - Difficult to review for non-cryptographers

3. **Performance Costs:**
   - Elliptic curve operations: ~10,000-50,000 gas units
   - Point serialization: 64 bytes per commitment (vs. 32 bytes for hash)
   - Compute budget constraints in Soroban

4. **Unnecessary Complexity:**
   - Perfect hiding not required (computational hiding sufficient)
   - Homomorphic properties not needed for this use case
   - Simple hash commitments meet all functional requirements

**Decision:** Use SHA-256-based commitments.

---

### 1.2 Hash-Based Commitment Scheme

**Construction:**

```
commitment = SHA256(
    canonical_encode(event_data) || 
    blinding_factor || 
    domain_separator
)
```

**Properties:**

| Property | Guarantee | Basis |
|----------|-----------|-------|
| **Hiding** | Computational | SHA-256 preimage resistance (2^256 ops) |
| **Binding** | Computational | SHA-256 collision resistance (2^128 ops) |
| **Verifiability** | Deterministic | Anyone can verify with (data, blinding) |
| **Efficiency** | O(1) hash ops | ~1000 gas units per commitment |

**Security Level:** 128 bits (quantum), 256 bits (classical)

---

## 2. Detailed Threat Model

### 2.1 Adversary Profiles

#### Profile 1: External Observer
**Capabilities:**
- Read all on-chain data (commitments, timestamps, tx metadata)
- Analyze blockchain history
- Monitor transaction patterns
- No access to off-chain database
- No access to backend infrastructure

**Goals:**
- Reconstruct user subscription history
- Link commitments to users
- Infer subscription prices, names, or services

**Mitigations:**
- Commitments reveal no plaintext
- No `sub_id` or `user_id` on-chain
- Blinding factor provides 256-bit entropy
- Merkle batching hides individual commitment timing

#### Profile 2: Curious Admin/Employee
**Capabilities:**
- Database read access (via RLS policies)
- Can query plaintext `blockchain_logs` table
- Cannot access `commitment_blinding_factors` table (restricted)
- No access to encryption keys for blinding factors

**Goals:**
- Access blinding factors for users they shouldn't see
- Forge commitments for non-existent events

**Mitigations:**
- Strict RLS policies on blinding factors table
- Blinding factors encrypted at rest (AES-256-GCM)
- Encryption keys in HSM or secret provider (not accessible to admins)
- Audit logging for all blinding factor access
- Principle of least privilege for database roles

#### Profile 3: Compromised Backend
**Capabilities:**
- Full database access (including plaintext event data)
- Can compute valid commitments
- Access to blinding factors (if encryption keys compromised)

**Goals:**
- Steal blinding factors
- Link commitments to users
- Forge events retroactively

**Mitigations:**
- Commitments anchored on-chain (immutable, timestamped)
- Cannot retroactively alter blockchain history
- Key rotation policy for encryption keys
- Intrusion detection and monitoring
- Separation of duties (different keys for different operations)

#### Profile 4: Malicious Verifier
**Capabilities:**
- Receives disclosure packages from users
- Can attempt to extract more information than disclosed

**Goals:**
- Infer non-disclosed events
- Correlate disclosures across users

**Mitigations:**
- Disclosure packages contain only single event data
- No side-channel leakage in verification
- User controls what to disclose (consent-based)

---

### 2.2 Attack Scenarios & Mitigations

#### Attack 1: Preimage Attack on Commitments

**Scenario:**
```
Attacker observes: commitment_hash = 0x1234...
Goal: Find event_data, blinding_factor such that SHA256(data || blinding) = commitment_hash
```

**Difficulty:** 2^256 operations (infeasible with current/near-future technology)

**Mitigation Strength:** ✅ Strong (cryptographic impossibility)

**Residual Risk:** None (breaks SHA-256 preimage resistance)

---

#### Attack 2: Collision Attack (Commitment Forgery)

**Scenario:**
```
User commits to event_data_1 with blinding_1 → commitment_hash
Attacker finds event_data_2, blinding_2 → same commitment_hash
```

**Difficulty:** 2^128 operations (SHA-256 collision resistance)

**Mitigation Strength:** ✅ Strong (beyond computational feasibility)

**Residual Risk:** None (would require breaking SHA-256)

---

#### Attack 3: Replay Attack

**Scenario:**
```
User discloses (event_data, blinding_factor) once
Attacker reuses disclosure to claim event happened twice
```

**Mitigation:**
- Include monotonic `commitment_index` in event data
- Each commitment index is unique (enforced on-chain)
- Verifiers check commitment_index hasn't been reused

**Residual Risk:** ✅ Mitigated

---

#### Attack 4: Timing-Based Correlation

**Scenario:**
```
Attacker observes commitments at timestamps:
  - Commitment A: 2026-06-01 10:00:00
  - Commitment B: 2026-06-01 10:00:05
Infers: User has multiple subscriptions renewed simultaneously
```

**Likelihood:** Moderate (metadata leakage via timing)

**Mitigation Strategies:**

**Option 1: Batch Commitments (Recommended)**
```
Daily batch: all commitments in 24-hour window → single Merkle root
Attacker sees only: "N commitments today" (not individual timings)
```

**Option 2: Timestamp Jitter**
```
Add random delay (0-60 minutes) to commitment submission
Attacker cannot precisely correlate events
```

**Option 3: Dummy Commitments**
```
Periodically submit dummy commitments (indistinguishable from real)
Increases noise in timing analysis
```

**Implementation:** Start with Merkle batching (Phase 4), add jitter if needed.

**Residual Risk:** ⚠️ Low (timing patterns within batches may leak coarse-grained information)

---

#### Attack 5: Blinding Factor Theft (Database Compromise)

**Scenario:**
```
Attacker gains database access
Reads commitment_blinding_factors table
Decrypts blinding factors → links commitments to users
```

**Likelihood:** Low (requires both database breach AND encryption key compromise)

**Mitigation Layers:**

1. **Encryption at Rest:**
   ```typescript
   blinding_factor_encrypted = AES256_GCM.encrypt(
     key=from_hsm('blinding_factor_key'),
     plaintext=blinding_factor,
     additional_data=user_id || commitment_index
   )
   ```

2. **Key Management:**
   - Encryption keys stored in HSM or cloud secret manager (AWS Secrets Manager, GCP Secret Manager)
   - Keys NOT accessible via database credentials
   - Separate key per environment (dev/staging/prod)

3. **Access Controls:**
   - RLS policies: users can only access their own blinding factors
   - Service role has limited blinding factor access (write-only for generation, read-only for export)
   - Audit log all blinding factor access

4. **Key Rotation:**
   - Rotate encryption keys every 90 days
   - Re-encrypt blinding factors with new key (background job)

**Residual Risk:** ⚠️ Low (defense in depth)

---

#### Attack 6: Side-Channel Leakage (Gas/Compute Analysis)

**Scenario:**
```
Attacker measures transaction gas consumption
Different event types consume different gas → event type leakage
```

**Mitigation:**
- Fixed-size commitment encoding (all events padded to same size)
- Constant-time SHA-256 operations (no data-dependent branches)
- Soroban fee structure based on compute budget (predictable)

**Residual Risk:** ✅ Mitigated (constant-time operations)

---

#### Attack 7: Cross-Protocol Attack (Commitment Reuse)

**Scenario:**
```
Attacker takes commitment from Synchro system
Reuses in different protocol with same hash scheme
```

**Mitigation:**
- Domain separator: `"SYNCRO_AUDIT_V1"`
- Included in every commitment hash
- Different protocols have different separators

```rust
const DOMAIN_SEPARATOR: &[u8] = b"SYNCRO_AUDIT_V1";
commitment = SHA256(event_data || blinding || DOMAIN_SEPARATOR);
```

**Residual Risk:** ✅ Mitigated

---

#### Attack 8: Selective Disclosure Coercion

**Scenario:**
```
Auditor demands: "Disclose all your subscription events"
User has no technical means to refuse
```

**Mitigation (Legal/Policy, not technical):**
- User education: selective disclosure is opt-in
- Clear consent flow in UI
- Legal protections against coercive disclosure requests
- Verifier code of conduct

**Technical Limitation:** Cannot prevent user from voluntarily disclosing all events.

**Residual Risk:** ⚠️ Moderate (social engineering, not cryptographic)

---

## 3. Privacy Analysis

### 3.1 Information Leakage Matrix

| Data Type | On-Chain Visibility | Off-Chain (DB) Visibility | GDPR Export Visibility |
|-----------|---------------------|---------------------------|------------------------|
| Commitment Hash | ✅ Public | ✅ Yes | ✅ Yes |
| Subscription ID | ❌ Hidden | ✅ Yes | ✅ Yes |
| Event Type | ❌ Hidden | ✅ Yes | ✅ Yes |
| Event Data | ❌ Hidden | ✅ Yes | ✅ Yes |
| Timestamp (precise) | ❌ Hidden* | ✅ Yes | ✅ Yes |
| Blinding Factor | ❌ Hidden | ✅ Yes (encrypted) | ✅ Yes (plaintext) |
| User ID | ❌ Hidden | ✅ Yes | ✅ Yes (own data) |

*Batch timestamp visible (e.g., "June 24, 2026"), not exact time.

### 3.2 Correlation Attack Resistance

**Query:** Can attacker link two commitments to the same user?

**Without Disclosure:**
- ❌ Cannot link by `sub_id` (not stored on-chain)
- ❌ Cannot link by `user_id` (not stored on-chain)
- ⚠️ May correlate by timing (if not batched)
- ⚠️ May correlate by transaction sender (if same wallet)

**Mitigation:**
- Use service-managed wallet for all commitment writes (not user wallets)
- Batch commitments to hide individual timings

**With Partial Disclosure:**
- If user discloses two events, verifier can confirm they're from same user
- By design (verifier needs to know whose data they're auditing)

---

### 3.3 Metadata Leakage Assessment

**On-Chain Metadata:**
```
Transaction {
  from: BACKEND_WALLET_ADDRESS,  // Same for all users (good)
  to: COMMITMENT_CONTRACT_ADDRESS,
  data: record_commitment(0x1234...),
  timestamp: LEDGER_TIMESTAMP,
  gas: FIXED_AMOUNT
}
```

**Leakage Analysis:**
- ✅ No user-specific metadata
- ✅ No subscription metadata
- ⚠️ Timestamp reveals "something happened at time T"
- ✅ Fixed gas usage (no event-type leakage)

**Conclusion:** Minimal metadata leakage.

---

## 4. Cryptographic Assumptions

### 4.1 Core Assumptions

1. **SHA-256 Preimage Resistance**
   - **Assumption:** Given `h = SHA256(x)`, it's computationally infeasible to find `x`
   - **Security Level:** 2^256 operations
   - **Status:** ✅ Widely accepted, no known attacks
   - **Post-Quantum:** 2^128 with Grover's algorithm (still secure)

2. **SHA-256 Collision Resistance**
   - **Assumption:** Computationally infeasible to find `x ≠ y` such that `SHA256(x) = SHA256(y)`
   - **Security Level:** 2^128 operations (birthday bound)
   - **Status:** ✅ No known collisions
   - **Post-Quantum:** Grover's doesn't help with collisions

3. **Cryptographic Randomness**
   - **Assumption:** `crypto.randomBytes(32)` produces uniformly random 256-bit strings
   - **Source:** Node.js crypto module (uses OS CSPRNG)
   - **Status:** ✅ Standard practice
   - **Failure Mode:** Weak RNG → predictable blinding factors → commitment forgery

4. **AES-256-GCM Security**
   - **Assumption:** Blinding factors encrypted with AES-256-GCM are IND-CCA2 secure
   - **Status:** ✅ NIST-approved standard
   - **Requirement:** Unique nonce per encryption

5. **Blockchain Immutability**
   - **Assumption:** Stellar blockchain provides immutable, tamper-proof ledger
   - **Status:** ✅ Proven by Stellar's history
   - **Failure Mode:** 51% attack (highly unlikely on Stellar)

---

### 4.2 Implementation Dependencies

**Trusted Components:**
- ✅ Soroban SDK 26 (audited by Stellar Foundation)
- ✅ Node.js `crypto` module (widely used, well-tested)
- ✅ Stellar Blockchain (9+ years operational history)
- ⚠️ Backend secret provider (custom, needs review)
- ⚠️ Commitment encoding logic (custom, needs review)

**Critical Code Paths (High Assurance Required):**
1. Blinding factor generation
2. Commitment computation
3. Canonical event encoding
4. Encryption/decryption of blinding factors

---

## 5. Operational Security

### 5.1 Key Management

**Encryption Key Lifecycle:**

```
Generation → Storage → Usage → Rotation → Destruction
```

**Key Hierarchy:**
```
Master Key (HSM)
  ↓
Blinding Factor Encryption Key (derived, rotated)
  ↓
Individual Blinding Factor (ephemeral)
```

**Rotation Policy:**
- Master key: Never rotated (backed up securely)
- Encryption key: Every 90 days
- Blinding factors: Generated per-event (never rotated)

### 5.2 Access Control Matrix

| Role | Blinding Factor Access | Event Data Access | Commitment Access |
|------|------------------------|-------------------|-------------------|
| User | Own data only (RLS) | Own data only | Public (on-chain) |
| Admin | ❌ No | ✅ Yes (for support) | ✅ Yes |
| Backend Service | ✅ Yes (generation/export) | ✅ Yes | ✅ Yes |
| Auditor (disclosed) | Specific events only | Specific events only | ✅ Yes |

### 5.3 Audit Logging

**Events to Log:**
- Blinding factor generation (user_id, commitment_index)
- Blinding factor access (user_id, accessor_id, timestamp)
- GDPR export requests (user_id, timestamp)
- Disclosure package generation (user_id, commitment_index, timestamp)
- Key rotation events

**Retention:** 2 years (compliance requirement)

---

## 6. Compliance & Regulatory

### 6.1 GDPR Compliance

**Right to Access (Article 15):**
- ✅ Users can export blinding factors via GDPR export
- ✅ Users can verify their commitments on-chain

**Right to Erasure (Article 17):**
- ⚠️ Commitments on blockchain are immutable (can't be deleted)
- ✅ Off-chain blinding factors can be deleted
- **Post-Deletion State:** Commitments remain on-chain but cannot be opened (privacy preserved)
- **Legal Basis:** Blockchain's immutability is fundamental limitation (GDPR recital 26)

**Right to Data Portability (Article 20):**
- ✅ GDPR export includes blinding factors in machine-readable format
- ✅ Users can verify data independently

### 6.2 Audit Trail Integrity

**Requirement:** Prove audit logs haven't been tampered with

**Solution:**
- Commitments anchored on Stellar blockchain (immutable)
- Merkle roots provide batch integrity
- Users can verify commitments against blockchain state

**Benefit over Traditional Logs:**
- Traditional: Admin can alter database logs
- Blockchain: Cryptographically impossible to alter commitments

---

## 7. Security Review Checklist

### Pre-Deployment Checklist

- [ ] **Cryptographic Review:**
  - [ ] Hash function usage (SHA-256)
  - [ ] Domain separator inclusion
  - [ ] Canonical encoding correctness
  - [ ] Blinding factor entropy (256 bits)

- [ ] **Implementation Review:**
  - [ ] No timing side-channels
  - [ ] Constant-time comparisons
  - [ ] Fixed-size encodings
  - [ ] Error handling (no info leaks)

- [ ] **Key Management:**
  - [ ] Encryption keys in HSM/secret manager
  - [ ] Key rotation implemented
  - [ ] Backup and recovery procedures
  - [ ] Access controls on keys

- [ ] **Database Security:**
  - [ ] RLS policies on blinding factors table
  - [ ] Encryption at rest enabled
  - [ ] Audit logging configured
  - [ ] Backup encryption

- [ ] **Testing:**
  - [ ] Unit tests (commitment generation/verification)
  - [ ] Integration tests (end-to-end disclosure)
  - [ ] Fuzzing (canonical encoding)
  - [ ] Penetration testing

- [ ] **Documentation:**
  - [ ] Security assumptions documented
  - [ ] Threat model reviewed
  - [ ] Incident response plan
  - [ ] User disclosure guide

---

## 8. Incident Response

### Scenario 1: Blinding Factor Leak

**Indicators:**
- Unauthorized access to `commitment_blinding_factors` table
- Encryption keys compromised

**Response:**
1. Revoke compromised keys immediately
2. Rotate encryption keys
3. Re-encrypt all blinding factors with new key
4. Audit: identify which factors were accessed
5. Notify affected users (GDPR breach notification)
6. Investigate root cause

**Impact:** Compromised users' privacy (commitments can be opened)

**Mitigation:** Commitments remain valid (no forgery), but privacy lost for leaked factors.

---

### Scenario 2: Commitment Collision Discovered

**Indicators:**
- Two different events produce same commitment hash

**Response:**
1. **Immediate:** This would break SHA-256 (Nobel Prize-level discovery)
2. Assess impact: which commitments affected?
3. Coordinate with cryptographic community
4. Migrate to stronger hash function (SHA-3, BLAKE3)
5. Re-commit all affected events

**Likelihood:** ≈0 (would break foundational cryptography)

---

### Scenario 3: Backend Compromise

**Indicators:**
- Unauthorized database access
- Suspicious commitment submissions

**Response:**
1. Isolate compromised systems
2. Rotate all keys and secrets
3. Audit commitment submissions (check for forgeries)
4. Review blockchain logs for anomalous patterns
5. Notify users and regulators if PII exposed

**Impact:** Potential privacy breach, data integrity concerns

---

## 9. Recommendations

### Immediate (Pre-Launch)

1. ✅ **Use hash-based commitments** (not Pedersen) - design approved
2. ✅ **Implement domain separator** - prevents cross-protocol attacks
3. ✅ **Encrypt blinding factors at rest** - defense in depth
4. ✅ **Strict RLS policies** - minimize insider threats

### Short-Term (0-3 months post-launch)

1. **Implement Merkle batching** - reduces timing correlation risks
2. **External security audit** - third-party cryptographic review ($30k-$50k)
3. **Penetration testing** - simulate attacker scenarios
4. **User education** - explain selective disclosure benefits

### Long-Term (6-12 months)

1. **Zero-knowledge proof research** - enable time-range queries
2. **Hardware Security Module (HSM)** - for production key management
3. **Formal verification** - prove commitment scheme correctness
4. **Post-quantum migration plan** - prepare for quantum threat (SHA-256 → SHA-3/BLAKE3)

---

## 10. Conclusion

**Security Posture:** ✅ Strong

The hash-based commitment scheme provides:
- **Strong hiding:** 2^256 preimage resistance
- **Strong binding:** 2^128 collision resistance
- **Operational security:** Defense-in-depth for blinding factors
- **Compliance:** GDPR-compatible with limitations documented
- **Auditability:** Blockchain-anchored integrity

**Recommended for Production Deployment** after:
1. Implementation review (internal)
2. Security testing (penetration + fuzzing)
3. External audit (optional but recommended)

**Risk Level:** Low (with proper key management and access controls)

---

**Document Version:** 1.0  
**Classification:** Internal Security Review  
**Approver:** [Pending]  
**Next Review:** After Phase 8 (Security Review)
