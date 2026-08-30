# ZK Proving System Comparison for SYNCRO

## Context

SYNCRO needs zero-knowledge proofs to verify subscription payments on Soroban without revealing payment details. This document evaluates candidate proving systems against Soroban's constraints.

## Soroban Constraints

| Constraint | Limit |
|---|---|
| Transaction size | ~16 KB |
| Compute budget | ~100M CPU instructions |
| WASM binary size | 256 KB (contract) |
| Available crypto | SHA-256, Ed25519, secp256k1 (native); no pairing support |

## Comparison Matrix

| Criteria | Groth16 | Bulletproofs | PLONK | Halo2 |
|---|---|---|---|---|
| **Proof size** | ~200 bytes (smallest) | ~700 bytes (logarithmic) | ~400 bytes | ~500 bytes |
| **Verification cost** | ~3ms (3 pairings) | ~50ms (linear in circuit) | ~5ms (1 pairing + poly) | ~10ms (no pairing, IPA) |
| **Trusted setup** | Per-circuit ceremony required | None | Universal (updatable) | None |
| **Rust maturity** | bellman, arkworks (mature) | bulletproofs (dalek, mature) | halo2_proofs (PSE fork, active) | halo2_proofs (PSE fork, active) |
| **WASM prover** | arkworks-rs compiles to WASM | dalek bulletproofs compiles to WASM | Limited WASM support | Limited WASM support |
| **Soroban verifier feasibility** | Requires BN254 pairing — **not natively supported** | Uses Ristretto/Ed25519 — **compatible** | Requires pairing — **not natively supported** | IPA-based — **potentially compatible** |
| **Client-side proving (Freighter)** | ~2s for small circuits | ~1-5s depending on range | ~3s | ~3-5s |

## Analysis

### Groth16
- **Pros**: Smallest proofs, fastest verification, most battle-tested (Zcash, Tornado Cash)
- **Cons**: Requires BN254 pairing precompile which Soroban lacks. Adding pairing math in WASM would blow the compute budget. Per-circuit trusted setup adds operational burden.
- **Verdict**: Not feasible without Soroban pairing support.

### Bulletproofs
- **Pros**: No trusted setup. Uses Ristretto/Curve25519 which aligns with Stellar's Ed25519 ecosystem. Mature Rust crate (dalek). Range proofs are the core primitive — ideal for proving "amount is within range" without revealing it. Verification is ~O(n) but for small circuits (payment commitments) stays within budget.
- **Cons**: Verification scales linearly with circuit size — limits complexity. No general-purpose circuit support (range proofs + inner product arguments only).
- **Verdict**: **Best fit for SYNCRO's payment proofs.** Compatible with Soroban, no trusted setup, and sufficient for payment amount range proofs.

### PLONK
- **Pros**: Universal trusted setup (one ceremony for all circuits). More flexible circuits than Bulletproofs.
- **Cons**: Requires pairing-friendly curves (BN254/BLS12-381) — same Soroban incompatibility as Groth16.
- **Verdict**: Not feasible without pairing support.

### Halo2
- **Pros**: No trusted setup. IPA-based (inner product argument) so no pairings needed. Flexible circuit design with PLONKish arithmetization. Used by Zcash Orchard.
- **Cons**: Larger proofs than Groth16. PSE fork is actively maintained but API is unstable. WASM compilation is possible but heavy (~1MB+). Verification cost in pure WASM may be tight against Soroban's budget.
- **Verdict**: Viable alternative if Bulletproofs prove too limited. Higher implementation risk.

## Recommendation

**Bulletproofs** is the recommended proving system for SYNCRO's payment privacy layer.

### Rationale

1. **Soroban compatibility**: Uses Curve25519/Ristretto — the same curve family as Stellar's Ed25519 keys. No pairing precompiles needed.
2. **No trusted setup**: Eliminates operational complexity and trust assumptions.
3. **Right-sized**: Payment amount range proofs are exactly what Bulletproofs excels at. We don't need general-purpose circuits for "prove I paid between $5-$50/month."
4. **Mature ecosystem**: `bulletproofs` (dalek) crate is stable, audited, and compiles to WASM for client-side proving in Freighter.
5. **Proof size**: ~700 bytes fits comfortably within Soroban's 16 KB transaction limit.

### Migration Path

If SYNCRO later needs more complex proofs (e.g., proving subscription history without revealing services), Halo2 is the natural upgrade path — same no-trusted-setup property, but with general-purpose circuits. This would require Soroban to support IPA verification efficiently, which could come via a host function.

### Prototype Plan

The prototype verifier contract (`contracts/contracts/zk-payment-verifier/`) currently uses SHA-256 commitments as a stand-in. The next step is to integrate the `bulletproofs` crate for range proof verification:

```rust
// Future: verify a Bulletproofs range proof on-chain
pub fn verify_range_proof(
    env: Env,
    commitment: BytesN<32>,  // Pedersen commitment to amount
    proof: Bytes,            // Bulletproof range proof (~700 bytes)
    range_bits: u32,         // e.g., 64 for amounts up to 2^64
) -> bool { ... }
```

## Decision Record

- **Date**: 2026-06-23
- **Decision**: Bulletproofs for payment amount range proofs
- **Status**: Accepted
- **Participants**: SYNCRO core team
