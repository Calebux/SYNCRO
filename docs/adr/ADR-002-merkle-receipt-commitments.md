# ADR-002: Merkle Commitments over Channel Receipts

**Status:** Accepted  
**Date:** 2026-07-01  
**Deciders:** Engineering team  
**Issue:** #1800

---

## Context

When a payment channel settles, the on-chain transaction records only the final
net balance. Nothing on-chain ties that settlement to the individual receipts
(calls, renewals, micro-charges) that accumulated during the channel's lifetime.
A verifier — auditor, subscriber, dispute arbiter — cannot prove that a specific
receipt was included in the settled amount without replaying the entire off-chain
history.

A Merkle root over all receipts in a settlement period compresses that history
into a 32-byte commitment. Any party who holds the receipt and the sibling path
can prove inclusion to anyone who trusts the root, without needing the full list.

---

## Definitions

**Receipt** — a signed record of one billable event within a channel. At minimum
it contains:

| Field | Type | Notes |
|---|---|---|
| `channelId` | `string` | Identifies the payment channel |
| `receiptId` | `string` | Unique within the channel |
| `amount` | `number` | In the channel's token unit |
| `timestamp` | `number` | Unix seconds (UTC) |
| `nonce` | `number` | Monotonically increasing, prevents replay |
| `payerAddress` | `string` | Stellar/Soroban public key |
| `payeeAddress` | `string` | Stellar/Soroban public key |
| `description` | `string` | Human-readable label |
| `metadata` | `object` | Optional structured payload |

**Leaf** — the SHA-256 hash of a canonical, deterministic serialization of one
receipt (see §Leaf Encoding below).

**Tree** — a binary Merkle tree where leaves are sorted ascending by their hex
value before the tree is built. Sorting ensures the root is deterministic
regardless of the order receipts are presented.

**Root** — the 32-byte (64 hex char) value at the apex of the tree.

**Proof** — an ordered list of `{ sibling: string; position: 'left' | 'right' }`
objects sufficient to recompute the root from a single leaf.

**Settlement record** — the signed artifact produced at channel close. It
carries the root and is the authoritative anchor for proofs.

---

## Leaf Encoding

A leaf is `SHA-256(canonicalBytes(receipt))` where `canonicalBytes` is:

```
<channelId>\x00<receiptId>\x00<amount>\x00<timestamp>\x00<nonce>
            \x00<payerAddress>\x00<payeeAddress>\x00<description>
```

All fields are UTF-8 strings separated by a single null byte (`\x00`). Numbers
are serialised as their decimal string representation (no floating-point
ambiguity). The `metadata` field is intentionally excluded from the leaf to keep
the leaf compact and deterministic; callers who need to commit metadata should
include it in `description` or extend the scheme with a versioned prefix.

A `\x00` prefix (`0x00 || data`) is prepended to leaves before hashing, and a
`\x01` prefix to internal nodes (`0x01 || left || right`), following the
RFC 6962 convention to prevent second-preimage attacks.

---

## Tree Construction

1. Hash each receipt into a leaf (sorted ascending by hex value).
2. If the number of leaves is odd, duplicate the last leaf (standard padding).
3. Pair adjacent leaves and hash each pair as an internal node.
4. Repeat until one node remains — that is the root.

---

## Inclusion Proof Format

```ts
interface MerkleProof {
  root: string;           // 64-char hex SHA-256 root
  leaf: string;           // 64-char hex SHA-256 leaf
  index: number;          // 0-based position of the leaf in the sorted list
  siblings: Array<{
    hash: string;         // 64-char hex sibling hash
    position: 'left' | 'right';
  }>;
}
```

Verification recomputes the root from `leaf` by walking `siblings` bottom-up
and comparing to `root`.

---

## Decision: Where Does the Root Live?

Three options were evaluated.

### Option A — Root stored in the on-chain settlement transaction

The escrow contract (`contracts/contracts/escrow`) is extended with a
`bytes32 receiptRoot` field. The root is committed when `release` or
`resolve_dispute` is called.

**Cost analysis (Soroban/Stellar):**
- One additional `Bytes(32)` persistent storage write per settlement.
- Soroban charges ~400 ledger entry write bytes; 32 bytes is negligible (~0.00001 XLM extra).
- The escrow contract already performs a token transfer on `release`, so the
  marginal cost of one more storage write is small.

**Benefit:** The root is immutably anchored to a ledger sequence number.
Anyone can verify inclusion against a public, tamper-evident record.

### Option B — Root embedded in a signed settlement record (off-chain)

The root is included in a JSON settlement record co-signed by both channel
parties and stored off-chain (e.g. in Supabase `channel_settlements` table or
IPFS). The escrow contract is not modified.

**Cost:** Zero on-chain cost.

**Risk:** The root is only as trustworthy as the signing keys. If keys are lost
or disputed, the root has no independent anchor.

### Option C — Root published as a Stellar transaction memo

The settlement transaction includes the root as a 32-byte `MEMO_HASH`.

**Cost:** Memos are free on Stellar.

**Risk:** Memos are not part of the contract's storage; they cannot be read by
other contracts. The root is visible on-chain but not queryable from Soroban.

---

## Decision

**Option B (signed settlement record) is chosen for the prototype**, with a
clear path to Option A.

Rationale:

- The escrow contract is shared infrastructure; adding a Merkle root field is a
  breaking change to its storage layout that requires a contract upgrade and
  migration. That work is out of scope for this exploratory issue.
- Off-chain storage in Supabase gives the same tamper-evidence guarantees for
  current use cases: both channel parties sign the settlement record, and the
  Supabase row is append-only via RLS.
- If a dispute reaches the on-chain arbiter, the settlement record (including
  root) can be supplied as an argument to a future `resolve_with_proof`
  function. The SDK's `verifyInclusion` can run before submitting that call.

**When to migrate to Option A:**

Migrate when any of these conditions are met:

1. The escrow contract requires an upgrade for another reason (the root can be
   added in the same migration at negligible cost).
2. A use-case emerges where on-chain contracts need to verify receipt inclusion
   without trusting an off-chain signature.
3. Regulatory requirements demand an immutable on-chain audit trail.

---

## Consequences

### Positive

- Zero change to the escrow contract, unblocking this work immediately.
- Any party with a receipt and the settlement record can prove inclusion without
  contacting the other party or a backend.
- The root halves the data a verifier needs to trust: they only need 32 bytes
  plus an O(log n) sibling path, not the full receipt list.

### Negative

- Proof security depends on the settlement record's signature validity (Option B
  does not give unconditional on-chain finality).
- Implementers must keep the settlement record accessible; losing it means
  proofs cannot be anchored.

### Neutral

- The `buildReceiptTree` and `verifyInclusion` SDK functions are pure
  (no network calls), making them easy to test and to run in any environment.

---

## Compliance Checklist for New PRs

- [ ] Receipt objects include all required fields (channelId, receiptId, amount,
  timestamp, nonce, payerAddress, payeeAddress, description)
- [ ] `buildReceiptTree` is called with the full receipt list for a settlement
  period before the settlement record is signed
- [ ] The settlement record stores `receiptRoot`, `channelId`, `settledAt`,
  and both party signatures
- [ ] `verifyInclusion` is used to validate proofs before accepting a claim
