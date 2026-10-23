# ADR 0001: ZK payment proofs are out of v3 scope

- Status: Accepted
- Date: 2024-01-01
- Issue: #1670 ([v3][sdk] Ship or remove the ZK prover placeholder)

## Context

`sdk/src/zk/wasm/index.ts` begins with the comment "WASM prover artifacts
placeholder." The SDK therefore exposes ZK functionality that cannot actually
produce proofs. The `zk-payment-verifier` contract is not part of the v3
component list, so there is no on-chain verifier that the SDK could target in
v3.

Shipping a public ZK surface that cannot work is misleading: consumers may
integrate it expecting proof generation and verification to succeed. The
acceptance criteria for #1670 require that the SDK no longer exports code that
cannot work, and that the decision be recorded here.

## Decision

ZK payment proofs are **not** in v3 scope.

- The `sdk/src/zk` module is removed from the SDK's public exports for the v3
  major release. It is no longer re-exported from the SDK entry point, so
  consumers cannot import a prover that cannot produce proofs.
- The `zk-payment-verifier` contract is not shipped as part of v3.
- The placeholder WASM prover artifacts are not published as part of the v3
  public API surface.

## Consequences

- The v3 SDK only exports functionality that works end to end.
- Consumers that relied on the placeholder ZK exports must remove those imports
  when upgrading to v3. This is a breaking change and is appropriate for a
  major release.
- ZK payment proofs can be reintroduced in a future major once the
  `zk-payment-verifier` contract and real WASM prover artifacts are available
  and covered by a working example.

## Alternatives considered

- **Ship the artifacts and a working example.** Rejected for v3 because the
  verifier contract is not in the v3 component list; without it, proofs cannot
  be verified on-chain and the feature would remain incomplete.
- **Leave the placeholder exported.** Rejected because it violates the
  acceptance criterion that the SDK must not export code that cannot work.
