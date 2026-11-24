# Requirements Document

## Introduction

This feature adds a zero-knowledge proof of subscription payment to SYNCRO. Users can prove to a third party that they paid a specific subscription on time without revealing the payer identity, the service name, or the payment amount. The proof is anchored on-chain via the existing `zk-payment-verifier` Soroban contract and generated through the `@syncro/sdk` client SDK.

The system builds on the already-implemented Fiat-Shamir commitment scheme in `shared/src/crypto/payment-commitment.ts`, the `verifier.rs` / `commitment.rs` logic in `contracts/contracts/zk-payment-verifier/`, and the stub `client/lib/zk-proof.ts`. This requirement document formalises the end-to-end behaviour, privacy guarantees, performance constraints, and integration points that must hold before the feature ships.

## Glossary

- **ZK_SDK**: The `@syncro/sdk` TypeScript module that exposes `generatePaymentProof()` and `verifyPaymentProof()` to browser clients and server code.
- **ZK_Verifier_Contract**: The deployed Soroban smart contract at `contracts/contracts/zk-payment-verifier/` that verifies and records proofs on the Stellar network.
- **Proof**: A 64-byte Fiat-Shamir proof blob composed of a `proof_key` (32 bytes) and a response scalar `s` (32 bytes) as defined in `verifier.rs`.
- **Commitment**: A 32-byte SHA-256 hash binding `(user_id, service_id, amount, timestamp, blinding_factor)` under the `syncro:payment:v1` domain separator.
- **Nullifier**: A 32-byte SHA-256 hash derived from `(blinding_factor, service_id)` that prevents the same proof from being verified twice.
- **Blinding_Factor**: A cryptographically random 32-byte value generated client-side that keeps the preimage of a Commitment secret.
- **Payment_Preimage**: The secret tuple `(user_id, service_id, amount, timestamp)` that the prover knows but never reveals on-chain.
- **Billing_Window**: A time range `[time_window_start, time_window_end]` expressed as Unix timestamps within which the proof timestamp must fall.
- **ProofInput**: The structured input `{ userId, serviceId, amount, timestamp }` provided to `generatePaymentProof()`.
- **ProofRecord**: The database row in `zk_payment_proofs` that stores the commitment hash, nullifier, and on-chain transaction reference.
- **GiftCardService**: The existing backend service in `backend/src/services/gift-card-service.ts` that triggers ZK proof generation after gift-card hash storage.
- **CommitmentStorageService**: The existing backend service that encrypts and persists blinding factors alongside commitment hashes.
- **Subscription_Logging_Contract**: The deployed Soroban contract that records privacy-preserving commitment hashes for audit events.

---

## Requirements

### Requirement 1: Client-Side Proof Generation

**User Story:** As a subscriber, I want to generate a ZK payment proof in the browser so that I can share proof of subscription payment with third parties without disclosing my identity, service, or amount.

#### Acceptance Criteria

1. WHEN `generatePaymentProof(input: ProofInput)` is called with valid `userId` (non-empty string), `serviceId` (non-empty string), `amount` (non-negative `bigint`), and `timestamp` (positive integer Unix epoch in seconds) fields, THE ZK_SDK SHALL return a `PaymentProofResult` — with shape `{ proof: string, commitment: { hash: string, version: string }, publicInputs: Record<string, string> }` — within 5 seconds wall-clock time on a mid-range device (baseline: 2022 mid-range laptop, single-core WASM execution).
2. WHEN `generatePaymentProof` is called, THE ZK_SDK SHALL generate a cryptographically random Blinding_Factor using `crypto.getRandomValues` with exactly 32 bytes of entropy.
3. WHEN `generatePaymentProof` is called, THE ZK_SDK SHALL compute the Proof using the Fiat-Shamir scheme defined in `verifier.rs`: `proof_key = SHA256(PROOF_KEY_DOMAIN || w)`, `commitment = SHA256(COMMIT_DOMAIN || proof_key)`, `nullifier = SHA256(NULL_DOMAIN || proof_key)`, `context = SHA256(commitment || nullifier || params)`, `s = SHA256(proof_key || context)`, encoding the final Proof as `proof_key(32B) || s(32B)`, and the resulting `proof` field in `PaymentProofResult` SHALL be encoded as a 128-character lowercase hex string.
4. WHEN `verifyPaymentProof(proof: string, amount: bigint, amountThreshold: bigint, timeWindowStart: number, timeWindowEnd: number)` is called with a 128-character hex `proof`, non-negative `bigint` `amount` and `amountThreshold`, and integers `timeWindowStart < timeWindowEnd`, THE ZK_SDK SHALL return `true` when the Proof passes all four checks in `verify_proof` in `verifier.rs` and `false` otherwise; IF `proof` is not a 128-character hex string or either time window parameter is invalid, THE ZK_SDK SHALL throw a `TypeError`.
5. IF `generatePaymentProof` receives a `ProofInput` where `amount` is not a non-negative `bigint`, THEN THE ZK_SDK SHALL throw a `TypeError` with the message `"amount must be a non-negative bigint"`.
6. IF `generatePaymentProof` receives a `ProofInput` where `timestamp` is not a positive integer representing a Unix epoch in seconds, THEN THE ZK_SDK SHALL throw a `TypeError` with the message `"timestamp must be a positive Unix epoch in seconds"`.
7. IF `generatePaymentProof` receives a `ProofInput` where `userId` is an empty string or `serviceId` is an empty string, THEN THE ZK_SDK SHALL throw a `TypeError` with the message `"userId and serviceId must be non-empty strings"`.
8. THE ZK_SDK SHALL NOT make any network request leaving the browser runtime — including fetch, XHR, WebSocket, or any equivalent API — that carries `userId`, `serviceId`, `amount`, `timestamp`, or the Blinding_Factor as part of a proof generation call.
9. WHEN `generatePaymentProof` completes successfully, THE ZK_SDK SHALL include in `publicInputs` exactly the keys `commitment` (64-character lowercase hex), `nullifier` (64-character lowercase hex), and `version` (string `"1"`), and no other fields that could identify the user or service.

---

### Requirement 2: Server-Side Proof Triggering After Gift-Card Attachment

**User Story:** As a platform operator, I want the backend to automatically generate and record a ZK payment proof when a gift card is successfully attached to a subscription so that the payment event has an on-chain commitment without exposing subscription metadata.

#### Acceptance Criteria

1. WHEN `GiftCardService.attachGiftCard` completes with `success: true`, THE GiftCardService SHALL invoke the ZK_SDK `generatePaymentProof` with the `userId`, `subscriptionId` as `serviceId`, the resolved gift-card `amount` in the smallest currency unit as a `bigint`, and the current Unix timestamp as a positive integer number of seconds since the Unix epoch.
2. WHEN the ZK proof is generated successfully after gift-card attachment, THE GiftCardService SHALL store the resulting `commitment`, `nullifier`, `proof`, and `subscriptionId` in the `zk_payment_proofs` database table via the CommitmentStorageService before returning the `AttachGiftCardResult`.
3. IF ZK proof generation fails after a successful gift-card attachment, THEN THE GiftCardService SHALL log the failure with severity `warn` including the `userId` (redacted to first 8 characters), the `subscriptionId`, and the error reason string, set `proofStatus: "pending"` in the `zk_payment_proofs` row, and still return `success: true` for the gift-card operation so that proof failure does not block the primary workflow.
4. IF CommitmentStorageService storage fails after a successful ZK proof generation and gift-card attachment, THEN THE GiftCardService SHALL log the storage failure with severity `warn`, set `proofStatus: "pending"` in the `zk_payment_proofs` row, and still return `success: true` for the gift-card operation so that storage failure does not block the primary workflow.
5. THE GiftCardService SHALL NOT include the raw Blinding_Factor, `userId`, `serviceId`, or `amount` in any API response, log line, or outbound message queue payload.

---

### Requirement 3: On-Chain Proof Verification and Storage

**User Story:** As a verifier (e.g., a third-party dApp), I want to submit a ZK proof to the Soroban verifier contract so that the proof validity and nullifier uniqueness are checked trustlessly on-chain.

#### Acceptance Criteria

1. WHEN the ZK_Verifier_Contract's `verify_and_store` function is invoked with a 64-byte Proof, a Commitment equal to `SHA256(COMMIT_DOMAIN || proof_key)` where `proof_key` is the first 32 bytes of the Proof, a Nullifier equal to `SHA256(NULLIFIER_DOMAIN || proof_key)`, a non-negative integer `amount_threshold`, a non-negative integer Unix ledger timestamp `time_window_start`, and a `time_window_end` strictly greater than `time_window_start`, THE ZK_Verifier_Contract SHALL return `true` and persist the Nullifier mapped to a `true` sentinel value in on-chain `persistent` storage.
2. WHEN the ZK_Verifier_Contract's `verify_and_store` is invoked with a Nullifier that is already recorded in on-chain storage, THE ZK_Verifier_Contract SHALL return `false` and NOT update any state (replay prevention).
3. IF the ZK_Verifier_Contract's `verify_and_store` is invoked and the current ledger timestamp falls outside the inclusive range `[time_window_start, time_window_end]`, THEN THE ZK_Verifier_Contract SHALL return `false` and NOT update any state.
4. IF the ZK_Verifier_Contract's `verify_and_store` is invoked with a Proof where `SHA256(COMMIT_DOMAIN || proof_key)` — where `proof_key` is the first 32 bytes of the Proof and `COMMIT_DOMAIN` is the domain-separation prefix defined in `commitment.rs` — does not equal the provided Commitment, THEN THE ZK_Verifier_Contract SHALL return `false` and NOT update any state.
5. IF the ZK_Verifier_Contract's `verify_and_store` is invoked with a Proof of length other than exactly 64 bytes, THEN THE ZK_Verifier_Contract SHALL return `false` and NOT update any state.
6. THE ZK_Verifier_Contract SHALL expose an `is_nullifier_used(nullifier: BytesN<32>) -> bool` function that returns `true` if and only if the Nullifier has been recorded in a prior successful `verify_and_store` call.
7. THE ZK_Verifier_Contract SHALL NOT store any of the following in on-chain storage: `user_id`, `service_id`, `amount`, `timestamp`, the Blinding_Factor, or the Commitment hash; the only per-proof on-chain storage entry SHALL be the Nullifier mapped to a `true` sentinel value.

---

### Requirement 4: Privacy-Preserving Commitment in Subscription Logging

**User Story:** As a privacy-conscious user, I want subscription payment events in the logging contract to use commitment hashes instead of plaintext metadata so that the event type and timing cannot be linked to my identity or subscription on-chain.

#### Acceptance Criteria

1. WHEN the backend records a payment-related audit event via the Subscription_Logging_Contract, THE backend SHALL call `record_commitment(commitment_hash)` instead of `record_log(sub_id, event, data)` so that no subscription identifier or event type is stored on-chain in plaintext.
2. IF `record_commitment` is called with a `commitment_hash` that is not exactly 32 bytes, THEN THE Subscription_Logging_Contract SHALL return an error and NOT store any state.
3. WHEN `record_commitment` is called with a valid 32-byte `commitment_hash`, THE Subscription_Logging_Contract SHALL assign a monotonically increasing `commitment_index` starting at 0, store an `AuditCommitment` with the `commitment_hash` and ledger `timestamp`, and emit a `CommitmentRecorded` event containing only `commitment_index` and `commitment_hash`.
4. WHEN `record_log` is called on the Subscription_Logging_Contract, THE Subscription_Logging_Contract SHALL emit a `DeprecationNotice` event with the field `message: "record_log is deprecated; use record_commitment"` in addition to performing the existing log-record behavior.
5. WHEN `get_commitment(commitment_index)` is called with a `commitment_index` that exists, THE Subscription_Logging_Contract SHALL return the stored `AuditCommitment` for that index.
6. IF `get_commitment(commitment_index)` is called with a `commitment_index` that does not exist, THEN THE Subscription_Logging_Contract SHALL return `None`.
7. WHEN `anchor_merkle_root(merkle_root, start_index, end_index)` is called with a `start_index` and `end_index` where `start_index <= end_index` and both indices correspond to existing commitments, THE Subscription_Logging_Contract SHALL store a `MerkleRoot` entry associating `merkle_root` with the range `[start_index, end_index]`.
8. IF `anchor_merkle_root` is called with a `start_index` greater than `end_index`, or with either index referencing a non-existent commitment, THEN THE Subscription_Logging_Contract SHALL return an error and NOT store any state.
9. WHEN `verify_merkle_membership(commitment_index, proof_path)` is called for a `commitment_index` within a previously anchored range and a `proof_path` that correctly authenticates the leaf at that index against the stored Merkle root, THE Subscription_Logging_Contract SHALL return `true`; for any other `proof_path` for the same index, THE Subscription_Logging_Contract SHALL return `false`.

---

### Requirement 5: ZK Proof API Endpoint

**User Story:** As a client application or third-party verifier, I want a REST endpoint to submit and verify a ZK payment proof so that I can confirm subscription payment without requiring direct on-chain access.

#### Acceptance Criteria

1. WHEN a `POST /api/zk-proof/verify` request is received with a valid JSON body containing `proof` (128-character lowercase hex string), `commitment` (64-character lowercase hex string), `nullifier` (64-character lowercase hex string), `amountThreshold` (non-negative integer), `timeWindowStart` (positive integer Unix timestamp in seconds), and `timeWindowEnd` (positive integer Unix timestamp in seconds greater than `timeWindowStart`), THE backend SHALL invoke `ZK_Verifier_Contract.verify_and_store` and return HTTP 200 with `{ "verified": true, "txHash": "<hash>" }` on success.
2. IF the `ZK_Verifier_Contract.verify_and_store` call in criterion 1 fails or is unreachable, THEN THE backend SHALL return HTTP 200 with `{ "verified": false, "reason": "contract_unavailable" }`.
3. IF `POST /api/zk-proof/verify` is received with a body that fails schema validation (missing fields, wrong types, or out-of-range values), THEN THE backend SHALL return HTTP 400 with a JSON error body containing a `"errors"` array where each entry identifies the invalid or missing field by name.
4. IF `POST /api/zk-proof/verify` is received for a Nullifier already on-chain, THEN THE backend SHALL return HTTP 409 with `{ "verified": false, "reason": "nullifier_already_used" }`.
5. WHEN a `GET /api/zk-proof/status/:nullifier` request is received with a well-formed 64-character lowercase hex nullifier, THE backend SHALL call `ZK_Verifier_Contract.is_nullifier_used` and return HTTP 200 with `{ "used": true }` or `{ "used": false }` reflecting on-chain state.
6. IF `GET /api/zk-proof/status/:nullifier` is received with a path parameter that is not a 64-character hex string, THEN THE backend SHALL return HTTP 400 with `{ "error": "nullifier must be a 64-character hex string" }`.
7. IF a request to any `/api/zk-proof/*` endpoint is received without a valid JWT in the `Authorization: Bearer <token>` header, THEN THE backend SHALL return HTTP 401 before processing the request body or path parameters.
8. WHEN a user exceeds 30 requests per minute to `/api/zk-proof/*` endpoints, THE backend SHALL return HTTP 429 with a `Retry-After` header indicating when the rate limit resets, and SHALL NOT process the request.

---

### Requirement 6: Proof Persistence and Retrieval

**User Story:** As a user, I want my generated ZK proofs to be stored securely so that I can retrieve and re-share them without regenerating them.

#### Acceptance Criteria

1. WHEN a ZK proof is successfully generated, THE backend SHALL persist a ProofRecord that is subsequently retrievable by its `id` and contains: `id` (UUID), `user_id`, `subscription_id` (nullable), `commitment_hash`, `nullifier`, `proof_blob`, `on_chain_tx_hash` (nullable), `proof_status` (`pending` | `on_chain` | `failed`), `created_at`, and `updated_at`.
2. WHEN a `GET /api/zk-proof/proofs` request is received from an authenticated user, THE backend SHALL return only the ProofRecords belonging to that user, with `proof_blob` always omitted from the list response.
3. WHEN a `GET /api/zk-proof/proofs/:id` request is received and the ProofRecord with that `id` belongs to the requesting user, THE backend SHALL return the full ProofRecord including `proof_blob`.
4. IF a `GET /api/zk-proof/proofs/:id` request is received and no ProofRecord with that `id` exists, THEN THE backend SHALL return HTTP 404.
5. IF a `GET /api/zk-proof/proofs/:id` request is received for a ProofRecord that exists but belongs to a different user, THEN THE backend SHALL return HTTP 403.
6. IF storing a ProofRecord would violate the unique constraint on `nullifier`, THEN THE backend SHALL return HTTP 409 with `{ "error": "nullifier_already_used" }` without performing any additional application-layer deduplication.
7. THE backend SHALL enforce data isolation such that an authenticated user cannot read, list, or delete ProofRecords belonging to any other user, regardless of whether the request arrives through the API or direct database query from the application service layer.

---

### Requirement 7: Proof Serialization Round-Trip

**User Story:** As a developer integrating ZK proofs, I want a stable serialization format so that proofs generated on one client can be parsed and verified on another without data loss.

#### Acceptance Criteria

1. THE ZK_SDK SHALL expose a `serializeProof(result: PaymentProofResult): string` function that encodes the proof as a Base64url-encoded JSON object containing `proof`, `commitment`, `nullifier`, `version`, and `schemaVersion` fields.
2. THE ZK_SDK SHALL expose a `deserializeProof(serialized: string): PaymentProofResult` function that accepts the output of `serializeProof` and returns a `PaymentProofResult`.
3. WHEN `deserializeProof(serializeProof(result))` is called for any valid `PaymentProofResult` produced by `generatePaymentProof`, THE ZK_SDK SHALL return a value where `proof`, `commitment.hash`, `nullifier`, and `version` are strictly equal (===) to the corresponding fields in the original result.
4. IF `deserializeProof` receives a string that is not valid Base64url-encoded content, or the decoded JSON is missing any of the required fields `proof`, `commitment`, `nullifier`, or `version`, THEN THE ZK_SDK SHALL throw a `SyntaxError`.
5. THE serialized JSON envelope produced by `serializeProof` SHALL include a `"schemaVersion": 1` field (integer).
6. IF `deserializeProof` receives a JSON envelope where `schemaVersion` is absent or is not the integer `1`, THEN THE ZK_SDK SHALL throw a `SyntaxError`.
