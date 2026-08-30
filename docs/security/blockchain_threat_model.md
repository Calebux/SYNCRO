# Blockchain Threat Model

Version: 1.0
Last Updated: 2026-05-26
Author: Security Engineering

Purpose: This document defines the comprehensive threat model, pre-mainnet audit checklist, and findings tracking & remediation process for all blockchain-related systems and integrations in this repository. It is written for engineers, security reviewers, and operators responsible for custody, transaction flows, signing infrastructure, and deployment controls.

Scope
- On-chain smart contracts and program logic (EVM-compatible and non-EVM as noted)
- Off-chain services that sign or submit transactions (relayers, bots, guardians)
- Key management: hardware and cloud KMS/HSM, multi-signature signers, threshold schemes
- Operational infrastructure used during deployment and runtime (CI/CD, RPC providers, queueing systems)

Audience: Security engineers, release engineers, backend engineers, and auditors.

---

## 1. BLOCKCHAIN THREAT MODEL (STRIDE Framework Matrix)

Overview: The matrix below maps STRIDE categories to specific blockchain threats and concrete mitigations for custody boundaries, authorization and approvals, replay attacks, and agent/automation risks.

### STRIDE Matrix (summary)

| Threat Category | Custody Boundaries & Key Management | Authorization & Approvals | Transaction Replay Attacks | Agent Abuse & Automation Exploits |
|---|---|---:|---|---|
| Spoofing (S) | Strong identity for signers, attested HSM/KMS, multi-sig signer identity proofs (x509/TPM). Use device attestation per signer. | Signed approval records, cryptographic non-repudiation, threshold sigs to prevent single-actor spoofing. | Chain-ID binding in signatures (EIP-155 / chain-specific domain separators). | Authenticated operator identities for agents; rotate API keys; enforce mutual TLS between services. |
| Tampering (T) | Hardened signing service: process isolation, signed firmware verification for HSMs, encrypted key material at rest using HSM-protected keys. | Approval state machine enforce immutable audit trail; content hash signing for proposals. | Transaction canonicalization before signing; TTL field validated by on-chain/pre-submit checks. | Protect queue state with signed receipts; use distributed locks to prevent concurrent mutation. |
| Repudiation (R) | Signed audit logs, append-only tamper-evident logs (Cloud KMS audit + SIEM). | Multi-party approvals with recorded signatures and time-series offsets. | Signed nonces/sequence numbers included in payloads and logs to provide non-repudiable history. | Agents must forward signed processing receipts to a central ledger for irrefutable evidence. |
| Information Disclosure (I) | Minimal key exposure: keep private keys in HSM/KMS; secrets never persist in plain-text in logs or backups. | Redact sensitive request/response payloads; limit approval metadata exposure. | Avoid storing private nonces and secret salts in cleartext logs. | Mask sensitive telemetry; use secure channels for agent telemetry (mTLS). |
| Denial of Service (D) | Rate-limit signing requests; circuit-breakers on signer load; geo-redundant HSM clusters. | Rate limits and velocity caps at authorization layer; emergency pause switches for approvals. | Limit mempool flooding by validating TTL/nonce pre-flight; prioritized replay-protected queues. | Apply concurrency limits on agents; implement backoff & exponential retry with jitter. |
| Elevation of Privilege (E) | Strict role separation (operator vs signer), least-privilege IAM, hardware-backed role attestations. | Enforce two-of-three or higher multisig thresholds; require out-of-band confirmations for high-value ops. | Signing service validates transaction intent against a whitelist and approval policies before signing. | Agents run with dedicated service accounts; no human-level credentials on automation nodes. |

---

### 1.1 Custody Boundaries & Key Management (Detailed Controls)

- Boundary definition: Distinguish four custody zones:
  1. Cold offline key generation (air-gapped HSM or offline hardware wallet)
  2. Warm HSM-backed offline signing (physically protected HSM cluster, remote attestation)
  3. Programmatic signing zone (cloud KMS with limited signing-only keys, private network access)
  4. Operator and dev workstations (no private key material allowed; use ephemeral signing tokens)

- Multi-sig configurations
  - Recommended architecture: Threshold multi-sig (e.g., 3-of-5) with a mix of signer types (hardware, cloud KMS, custodial):
    - 1 on-prem HSM signer (air gapped or tamper-evident HSM)
    - 1 cloud KMS signer (with strict IAM policies)
    - 1 delegated operational signer (hot but rate-limited)
    - 2 backup signers (separated by ownership/region)
  - Use canonical multisig contracts that support key rotation and signer replacement with governance delays.
  - Use threshold signature schemes (TSS) where applicable to enable single aggregated signatures while preserving split-key security.

- Programmatic signing isolation
  - All programmatic signing must run inside a dedicated signing service with the following properties:
    - Single responsibility: accepts signing requests only and returns signatures; no general compute or storage of business data.
    - Minimal attack surface: hardened container, immutable image, restricted outgoing network egress.
    - Signing request validation: policy engine enforces allowed operations, destination addresses, token types, and caps before signing.
    - Rate limiting and anomaly detection on signing requests (per-signer, per-origin).
    - Short-lived ephemeral tokens for callers; no persistent secrets in application configuration.

- KMS/HSM integration strategies
  - KMS recommendations:
    - Use cloud KMS or managed HSM for warm signers with `sign-only` IAM roles.
    - Enable customer-managed keys (CMKs) and rotation policies. Tie key usage to a service account bound via strong IAM rules and mTLS.
  - HSM recommendations:
    - Use FIPS 140-2/3 validated modules for high-value signers.
    - Use attestation (TPM or enclave attestation) to confirm HSM firmware and configuration prior to accepting keys.
    - Maintain an offline backup key strategy: use Shamir's Secret Sharing (SSS) to split master seed across geographically separated custodians with documented recovery SOPs.
  - Signing flows should adopt strict guardrails:
    1. Requestor -> Signing Policy Evaluation (whitelist, caps) -> KMS/HSM signing call -> Signature returned to caller.
    2. Each signing operation produces an immutable audit record: request hash, signer ID, signature, policy version, TTL, and operator correlation ID.

- Key lifecycle controls
  - Generation: Keys generated in HSM or trusted KMS; record origin and attestation.
  - Distribution: Private key material must never leave protective boundary; use public key export only.
  - Rotation: Automated rotation windows with staggered rollouts; rotate both keys and policies that reference the keys.
  - Revocation and compromise: Support immediate key revocation, quorum-based emergency rotate, and on-chain replacement workflows with governance delays.

---

### 1.2 Authorization & Approvals

- Authorization primitives
  - Approval policies are enforced by a dedicated Approval Engine which is distinct from the Signing Service. The engine must:
    - Evaluate a signed proposal (payload + metadata) against policy rules (velocity, volume, destination whitelist, business rules) before generating an approval record.
    - Produce an approval artifact cryptographically bound to the payload (signed JSON Web Signature including policy version and expiry).
    - Store approvals in append-only storage with integrity verification (e.g., signed log + Merkle root anchored to ledger or audit chain).

- Velocity limits and volume caps (examples and rationale)
  - Recommended baseline controls (tune to treasury size and business risk):
    - Single transaction cap: 1,000,000 USDC-equivalent (or equivalent token value)
    - Hourly aggregate cap: 5,000,000 USDC-equivalent
    - Daily aggregate cap: 20,000,000 USDC-equivalent
    - Low-value fast-path: transactions <= 10,000 USDC-equivalent may require 1 approver; above requires 2+ approvers.
  - Implementation notes:
    - Use real-time counters backed by strongly-consistent storage (e.g., Redis with persistence or distributed database with linearizable writes) and enforce atomic checks-and-increments.
    - Caps are categorical by transaction type (transfer, contract upgrade, parameter change). Each category should have separate counters and thresholds.

- Cryptographic verification loops
  - Approval artifact structure:
    - Fields: {proposal_hash, proposer_id, approver_ids[], threshold, timestamp, expiry, policy_version, merkle_root}
    - Signed by the Approval Engine's signing key and stored with the proposal.
  - Verification flow prior to signing:
    1. Signing Service receives request + approval artifact.
    2. Verify approval signature(s) and that `proposal_hash` matches the unsigned transaction content.
    3. Verify approvals meet current policy_version, threshold, and are within TTL.
    4. Verify that the aggregate volume counters allow the transaction.

---

### 1.3 Transaction Replay Attacks

- Nonce enforcement
  - Maintain account-specific monotonic nonces on-chain where possible; use server-side sequence counters for wrapped meta-transaction flows.
  - For meta-tx relayers, bind relayer signatures to a strictly-incremented per-user nonce and persist it in linearizable storage.

- Binding signatures to unique Chain IDs
  - Always include a domain separator containing chain ID, protocol version, and contract address in the signing payload (EIP-712 style or equivalent).
  - Reject signatures that have domain separators mismatching the target chain.

- Time-to-Live (TTL) expiration tracking
  - Include explicit `valid_from` and `valid_until` timestamps inside the signed payload. Reject and refuse to sign payloads with expired TTL.
  - On-chain contracts should also check TTL where feasible and revert if outside allowed windows.

- Additional anti-replay controls
  - Use unique request IDs and idempotency keys so replayed network traffic is detected and discarded.
  - If using off-chain batching, include batch sequence numbers and Merkle inclusion proofs for each transaction.

---

### 1.4 Agent Abuse & Automation Exploits

- Threats
  - Automation agents (relayers, cron jobs, oracles, reconciliation workers) can be subverted to front-run, double-submit, or bypass approval flows if they operate without distributed locking, idempotency, and strong auth.

- Distributed queue locks and idempotency
  - Use robust distributed locking (Redis-based Redlock with proper configuration) or consensus-backed locks (e.g., etcd, Zookeeper) to ensure at-most-once execution semantics for job processing.
  - Locking design notes (Redis Redlock):
    - Use multiple independent Redis nodes across availability zones (minimum 5) and require quorum for lock acquisition.
    - Set lock TTL conservatively relative to expected job runtime and refresh locks only after successful heartbeat checks.
    - Implement fallback for lock failures: exponential backoff with randomized jitter and operator alerting on repeated failures.
  - Implement idempotency keys (UUID v4 + deterministic content hash) for each transaction-processing job. All processing steps must be guard-checked against processed idempotency keys before attempting any state change or signing.

- Preventing front-running and ordering exploits
  - Commit–reveal pattern for sensitive operations where ordering information can be exploited. Commit stores hash on-chain or off-chain audit prior to reveal and execution.
  - Use channel-based submission where the final submission is scheduled with randomized small delays and monitor mempool propagation to detect potential front-runners.

- Agent monitoring & runtime constraints
  - Agents must run under dedicated service accounts with limited IAM capabilities.
  - Monitor agent behavior for abnormal patterns: sudden throughput spikes, unusual destination addresses, or repeated failures. Feed anomalies into automated pause/hold mechanisms that require manual operator review.

---

## 2. PRE-MAINNET DEPLOYMENT AUDIT CHECKLIST

Instructions: Each item is actionable and must be completed and checked off before mainnet deployment. Evidence links (CI artifact, ticket, or log) must be attached to each checked item.

### Cryptographic Key Lifecycle

- [ ] Key generation performed in HSM/KMS; generation attestation artifacts stored and linked to the release ticket.
- [ ] Private keys never exported in plain text; verification of key material location completed (scan for accidental secrets in builds).
- [ ] Multi-sig / TSS configuration verified with unit tests and integration tests demonstrating signer rotation and recovery.
- [ ] Rotation policy defined and automated with test runbooks (simulate rotate and rollback with a staging keyset).
- [ ] Backups of key shares (SSS) created per SOP and stored in geographically-separated secure vaults (evidence: backup receipts).
- [ ] Emergency key-revocation and on-chain signer replacement playbook documented and dry-run executed.

### Code Payload / State Machine Security

- [ ] Formal approval engine tests: policy evaluation unit tests cover edge cases (e.g., overlapping caps, concurrent approvals).
- [ ] Signing Service fuzz & property tests: invalid payloads, malformed domain separators, replayed nonces.
- [ ] Smart contract security audits complete (3rd-party report attached) and critical/high findings closed or mitigated.
- [ ] Smart contract upgradeability patterns documented and upgrade guards in place (delays, multisig upgrade path, restricted pausing capability).
- [ ] Deterministic serialization tests: signatures produced against canonical serialized payloads match expected verification keys.

### Infrastructure & Operational Guardrails

- [ ] Rate limiting and velocity enforcement validated end-to-end (tests demonstrating block attempts above limits are rejected).
- [ ] Distributed lock configuration tested: demonstrate Redis Redlock acquires/releases locks across AZ failures.
- [ ] CI/CD pipeline enforces secret scanning and rejects builds containing private key material or credentials.
- [ ] Monitoring/alerting configured: signer-heartbeat, approval-engine throughput, failed-signing attempts, queue backlogs.
- [ ] Runbook: manual pause/kill of signing service, emergency governance flow, and rollback procedure documented and tested.
- [ ] On-call rota and escalation paths established for critical incidents affecting signing or treasury flows.

### Operational Acceptance Criteria (must be satisfied)

- [ ] Automated tests (unit + integration) pass with >95% coverage on signing and approval components.
- [ ] End-to-end staging run: full transaction lifecycle executed and approved by independent reviewer.
- [ ] Load testing: signing service sustains expected QPS under fault-injection while honoring velocity caps.
- [ ] Recovery drill: demonstrate rotation and re-key steps with minimal downtime (< SLAs defined below).

---

## 3. FINDINGS TRACKING & REMEDIATION PROCESS

This section defines how security findings are categorized, tracked, and closed. All findings must be tracked in the centralized issue tracker and follow the SLAs below.

### Severity Categorization Matrix

| Severity | Definition | Business Impact Example | Required Initial Response | Target Remediation SLA |
|---|---|---|---:|---:|
| Critical | Vulnerability enabling loss/theft of funds or full compromise of signing authority without multi-party controls. | Signer private key leak, major protocol bug allowing arbitrary mint/burn. | Acknowledge and mobilize incident response within 1 hour; immediate mitigations (pause, rotate) required. | Mitigation within 24 hours; full remediation / audited fix within 7 days or governed emergency upgrade if needed. |
| High | Vulnerability that materially increases attack surface leading to high-probability fund compromise or large unauthorized actions. | Flawed multisig threshold logic, signer recovery bypass. | Acknowledge within 4 hours; temporary mitigations (reduce caps, disable hot signers) within 24 hours. | Fix within 14 days; temporary mitigation documented and validated within 72 hours. |
| Medium | Vulnerability that aids attackers in reconnaissance, partial state manipulation, or non-fund-impacting privilege escalation. | Exposed internal endpoints, insufficient TTL checks. | Acknowledge within 48 hours. | Fix within 30 days with regression tests. |
| Low | Minor issues, best-practice lapses, or informational issues with low immediate impact. | Missing telemetry for a non-critical worker. | Acknowledge in normal triage cycle (7 days). | Fix within 90 days (or scheduled in roadmap). |

### Findings Lifecycle & Operational Protocols

1. Logging and Triage
   - All security issues and suspicious events must create an issue in the `security` tracker (label `security/finding`). Include: reproduction steps, PoC if available, logs, implicated signer IDs, and initial severity estimate.
   - Triage meeting: Security lead and engineering owner must triage within the severity-required response window.

2. Containment & Mitigation
   - If a finding is Critical/High, perform immediate containment (pause signing service, restrict key usage, disable RPC endpoints) and notify stakeholders (security, legal, ops, product).
   - Document mitigation steps in the issue and produce a short-lived mitigation checklist to avoid blocking normal behavior beyond what is necessary.

3. Fix Implementation
   - Create a remediation PR that references the finding issue. PR must include tests (unit + integration) that cover the vulnerability scenario and assert regressions are prevented.
   - All remediation PRs for Critical/High must be peer-reviewed by at least two engineers and reviewed by Security (security-review label on PR).

4. Regression Testing & Validation
   - For every fix, attach a regression test plan and CI evidence. Regression tests include:
     - Unit tests for policy evaluation and signing logic.
     - Integration tests exercising the signing flow with approval artifacts and distributed locks.
     - Staging deploy with canary traffic validating that the fix addresses the PoC and does not introduce side-effects.

5. Sign-off & Deployment
   - Closure requires: code merged, regression tests passing, staging validation evidence attached to the issue, and Security sign-off (explicit approval comment from `security@` or designated approver).
   - For Critical fixes, require a post-change audit (internal or external) before mainnet redeployment unless a documented and approved emergency governance path is used.

6. Post-mortem and Lessons Learned
   - For Critical/High incidents, produce a post-mortem within 7 days capturing root cause, timeline, detection method, impact, corrective actions, and preventive measures.
   - Retrospective to update this threat model and checklists.

### Communication & Escalation

- All Critical incidents must trigger the following notifications:
  - Pager/phone call to on-call security engineer (immediate)
  - Email/Slack to `#security` and `#ops` channels (1 hour)
  - Executive summary to the CTO/CISO (within 4 hours)

---

## Appendix A — Implementation Examples & Artifacts

### Approval Artifact (JSON Web Signature) Example

```json
{
  "proposal_hash": "b3f5...",
  "proposer_id": "service:rebalancer:v1",
  "approver_ids": ["approver:alice","approver:bob"],
  "threshold": 2,
  "timestamp": "2026-05-26T12:00:00Z",
  "expiry": "2026-05-26T12:30:00Z",
  "policy_version": "v2026-05-01",
  "signature": "MEUCIQD..."
}
```

Verification pseudocode (signing service):

```text
if verify_jws(approval_artifact) == false: reject
if approval_artifact.proposal_hash != hash(tx_payload): reject
if now() > approval_artifact.expiry: reject
if !policy_interpreter.approvals_meet_threshold(approval_artifact): reject
proceed_to_sign(tx_payload)
```

### Redis Redlock (operational checklist)

- Use >=5 independent Redis nodes across fault domains.
- Use monotonic request IDs and lock tokens returned on acquisition.
- Ensure application recovers gracefully from lock acquisition failure (backoff and alerting).

---

## Appendix B — References

- EIP-155: Chain ID replay protection
- EIP-712: Typed structured data signing
- NIST SP 800-57: Key management guidance
- FIPS 140-2/3 certified HSM vendor documentation
- Shamir's Secret Sharing best practices

---

If any section needs further tailoring (specific chain details, token economics for caps, or integrated third-party custodians), open an RFC in the security tracker with proposed parameter values and stakeholders listed.
