# [v3][sdk] Python binding assessment (Issue #1497)

## Goal

Define the minimum viable Python SDK scope once the TypeScript v3 SDK semantics are stable.

## Minimum Python client requirements

1. **Transport wrapper parity**
   - HTTP client with request timeout, structured gateway errors, and default retry policy.
   - Mandatory per-logical-call idempotency-key generation and propagation across retries.
   - Retry-after header support and retry budget cap behavior equivalent to TypeScript.

2. **Proof signing parity**
   - Deterministic payload canonicalization matching TypeScript.
   - Ed25519 signing support for payment proof or receipt payloads.
   - Fixtures that prove Python and TypeScript signatures verify against the same vectors.

3. **Receipt verification parity**
   - Offline `verify_receipt(receipt, public_key, expected_channel, expected_nonce)`.
   - Structured failure output with named checks (`signature`, `amount`, `channel`, `nonce`, `receipt-shape`).
   - Shared fixtures demonstrating distinct failures for each tampered field.

## Build approach tradeoff

### Option A: hand-written Python client
- **Pros:** flexible ergonomics; faster to iterate on auth/retry policy details.
- **Cons:** transport and error behavior can drift from TypeScript unless heavily tested.

### Option B: generated transport + hand-written crypto layer (**selected**)
- **Pros:** transport and error taxonomy stay aligned with server OpenAPI/taxonomy changes.
- **Pros:** signing/verification remains deliberate and audited in shared fixtures.
- **Cons:** generation tooling introduces a build step and template maintenance.

## Decision

**Defer shipping the Python package until TypeScript v3 stabilizes.**

The Python implementation will proceed with:
- generated transport from API + gateway taxonomy artifacts,
- hand-written signing and receipt verification wrappers validated by cross-language fixtures.

## Defer exit criteria

Start Python implementation when all are true:

1. TypeScript v3 receipt verification contract is declared stable (no breaking field changes planned).
2. Generated gateway taxonomy classes are green in CI and drift checks have run for at least one release cycle.
3. Retry/idempotency behavior has integration tests proving one charge per logical call under retries.
4. Shared language-agnostic test vectors exist for signature and receipt verification.

Once criteria are met, open follow-up tasks:
- `sdk-python`: generated transport scaffold,
- `sdk-python`: signing + receipt verification parity,
- `sdk-python`: parity tests against TypeScript fixtures.
