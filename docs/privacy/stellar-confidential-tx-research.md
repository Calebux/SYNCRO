# Stellar Confidential Transactions Research

## Current Status

### CAP-0046-13 (Confidential Assets / ZK Transfers)

Stellar has discussed confidential transactions through several CAPs. The most relevant is **CAP-0046-13** (part of the Soroban extension family), which proposes hiding transaction amounts using Pedersen commitments and Bulletproofs range proofs at the protocol level.

| Detail | Status |
|---|---|
| CAP number | CAP-0046-13 (draft / under discussion) |
| SDF timeline | No committed release date as of June 2026 |
| Protocol version target | Not assigned |
| Testnet availability | Not yet available |
| Soroban integration | Planned as host functions, not yet implemented |

### What Stellar CT Would Provide

- **Amount hiding**: Native Pedersen commitments on Stellar payments — the network verifies `sum(inputs) = sum(outputs)` without revealing amounts
- **Range proofs**: Built-in Bulletproofs verification to prove amounts are non-negative
- **Asset type hiding**: Potential to hide which asset is being transferred (confidential assets extension)

## Comparison: Stellar CT vs. SYNCRO Custom Approach

| Capability | Stellar CT (if available) | SYNCRO Custom (current) |
|---|---|---|
| **Amount hiding** | Native — zero app-level code | Custom Pedersen commitments in `shared/src/crypto/pedersen.ts` + on-chain verifier |
| **Sender/receiver hiding** | Not covered — addresses still visible | Stealth addresses via `shared/src/crypto/stealth-keys.ts` |
| **Subscription metadata hiding** | Not covered — only amounts | Encrypted metadata via `shared/src/crypto/metadata-encryption.ts` |
| **Payment linkability** | Payments still linkable by address pair | Payment channels reduce on-chain footprint; nullifiers prevent correlation |
| **Recurring payment privacy** | Each renewal is a visible on-chain tx | Payment channels batch renewals off-chain |
| **ZK proofs of payment** | Not supported — CT proves validity, not arbitrary statements | Custom commitment scheme with domain separation allows proving "I paid service X" without revealing amount |
| **Soroban compatibility** | Would be native host functions (fast) | WASM-based verification (compute budget constrained) |
| **Availability** | Unknown timeline | Available now |

## Gap Analysis

Even if Stellar CT ships, SYNCRO still needs:

1. **Stealth addresses** — CT hides amounts, not participants. SYNCRO's privacy model requires hiding which user pays which service.
2. **Metadata encryption** — Subscription names, billing cycles, and categories are not covered by CT.
3. **Payment channels** — CT doesn't reduce on-chain tx count. Recurring subscriptions still generate one visible tx per renewal without channels.
4. **ZK proofs of payment** — SYNCRO's commitment scheme lets users prove "I paid for service X in period Y" to third parties without revealing amount. CT's Pedersen commitments are for network validation, not selective disclosure.
5. **Nullifiers** — CT has no concept of "this payment was already proven" — SYNCRO's nullifier scheme prevents double-claiming.

## Recommendation

**Continue with SYNCRO's custom approach. Adopt Stellar CT for amount hiding when available, as a complement — not a replacement.**

### Rationale

- Stellar CT addresses only **one dimension** (amount hiding) of SYNCRO's **five-dimensional** privacy model (amount, sender, receiver, metadata, linkability).
- CT has no committed timeline. Blocking on it would indefinitely delay privacy features users need now.
- SYNCRO's custom Pedersen commitments are architecturally compatible with Stellar CT — when CT ships, the on-chain commitment verification can be replaced by native host functions, reducing compute cost without changing the application-level privacy model.

### Migration Path (When CT Becomes Available)

1. **Phase 1 — Drop-in replacement**: Replace SYNCRO's WASM Pedersen verification with Stellar CT host functions. The commitment format is the same (Pedersen over Curve25519), so existing commitments remain valid.
2. **Phase 2 — Native range proofs**: Replace SYNCRO's custom Bulletproofs verification with Stellar's built-in range proof checking. Saves ~80% of on-chain compute cost.
3. **Phase 3 — Evaluate asset hiding**: If CT includes confidential assets (hiding token type), evaluate whether SYNCRO can leverage this for multi-currency subscription payments.

### What NOT to Migrate

- Stealth addresses, metadata encryption, payment channels, and the nullifier scheme remain SYNCRO-owned — these are orthogonal to CT.

## Decision Record

- **Date**: 2026-06-23
- **Decision**: Continue custom approach; adopt Stellar CT for amount hiding when available
- **Status**: Accepted
- **Review trigger**: Re-evaluate when Stellar CT reaches testnet
