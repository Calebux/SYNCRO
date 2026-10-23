# External Security Review & Baseline Verification: Settlement Path

**Scope:** Settlement Path & Smart Contracts  
**Target Architecture:** `payment-channel`, `allowance`, `agent-registry`, `escrow`, and Client Signing Pipelines  
**Baseline Status:** Internal verification complete (Property tests, fuzzing, griefing analysis, threat model)  
**Mainnet Readiness:** Defensible baseline achieved; blocking criteria and mitigated findings defined.

---

## 1. Executive Summary & Review Scope

Before enabling real-value settlement and custody on mainnet, an external security review scope has been established across all critical value-moving contracts and client-side state signing libraries:

1. **`payment-channel`**: Bidirectional off-chain state channels, dispute adjudication periods, sequence monotonicity, balance conservation, and watchtower bounty incentives.
2. **`allowance` (Spend-Cap)**: Authorized spender delegation, monotonic cumulative spend counters, period resets, and lifetime limits.
3. **`agent-registry`**: Agent registration, capability scoping, admin rights transfers, and invocation permission checks.
4. **`escrow`**: Multi-party fund escrow, arbiter dispute resolution, partial balance splits, and testnet-validated escape hatches.
5. **Client Signing & State Validation**: Cryptographic message digest serialization, EIP-712/domain separator bindings, monotonic nonce validation, and rejection of replayed channel states.

---

## 2. Internal Baseline Verification (Completed)

To ensure external review begins from a verified baseline rather than discovering automated testing edge cases:

- **Property-Based Testing & Fuzzing:**
  - `proptest` suites for state channel transitions (`contracts/contracts/payment-channel/src/fuzz.rs`).
  - Escrow split invariant fuzzing (`contracts/contracts/escrow`).
  - Allowance overdraft property testing (`contracts/contracts/allowance`).
  - Deterministic WASM compilation verified across multiple compilation passes in CI (`.github/workflows/contracts.yml`).
- **Griefing & Denial of Service Analysis:**
  - Evaluated griefing attack vectors where counterparty stalls channel closure; mitigated with finite dispute timeout and watchtower bounties.
  - Storage exhaustion attacks prevented by requiring registration deposits in `agent-registry`.
- **Threat Model:**
  - Formal STRIDE threat matrix and key management custody zones documented in `docs/security/blockchain_threat_model.md`.

---

## 3. Mainnet Blocking vs Non-Blocking Criteria

### Mainnet Blocking Findings (Must Resolve Before Mainnet Deployment)
1. **Critical/High Severity Vulnerabilities:**
   - Any flaw enabling unauthorized balance extraction or drain from `payment-channel` or `escrow`.
   - Any bypass of the spend-cap in `allowance` contract.
   - Unauthorized privilege escalation or impersonation in `agent-registry`.
   - Flaws in client-side state signing that allow channel signature forgery or replay across chains.
2. **Incomplete Baseline Tests:**
   - Failing property/fuzz tests or non-deterministic WASM build hashes.
   - Untested escape hatch or guardian recovery mechanisms.

### Non-Blocking / Mitigated Findings (Acceptable for Mainnet with Controls)
1. **Low/Informational Findings:**
   - Minor gas/CPU budget optimization suggestions without re-entrancy or DoS risk.
   - Non-critical event emission formatting or metadata naming updates.
2. **Medium Severity with Compensating Mitigations:**
   - Low-velocity rate-limit adjustments backed by on-chain circuit breakers (`InitialCaps` and `SoakPeriod` guardrails configured in `deploy/mainnet-config.json`).

---

## 4. Published Review Outcomes & Tracking

All findings from internal fuzzing and external audit reports are tracked under the `security/finding` lifecycle:
- Status: **Internal Baseline Verified / Ready for External Audit Sign-off**
- Escape Hatch Status: Verified on testnet with multi-sig guardian set (minimum 3 distinct addresses).
- WASM Provenance: SLSA provenance attestations and CycloneDX SBOM attached to every contract release tag.
