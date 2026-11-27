/**
 * Merkle commitments over channel receipts.
 *
 * Design note: docs/adr/ADR-002-merkle-receipt-commitments.md
 *
 * The root lives in a *signed settlement record* (Option B in the ADR).
 * Both channel parties sign the record off-chain; it can be anchored
 * on-chain in a future escrow contract upgrade (Option A) without changing
 * this module's API.
 */

import * as crypto from "node:crypto";

// ─── Receipt ─────────────────────────────────────────────────────────────────

/**
 * One billable event within a payment channel.
 * All fields are required so the leaf encoding is deterministic.
 */
export interface Receipt {
  /** Identifies the payment channel this receipt belongs to. */
  channelId: string;
  /** Unique receipt identifier within the channel. */
  receiptId: string;
  /** Amount charged in the channel's token unit (decimal string stored as number). */
  amount: number;
  /** Unix timestamp in seconds (UTC). */
  timestamp: number;
  /** Monotonically increasing counter — prevents replay. */
  nonce: number;
  /** Payer's Stellar/Soroban public key. */
  payerAddress: string;
  /** Payee's Stellar/Soroban public key. */
  payeeAddress: string;
  /** Human-readable label for this charge. */
  description: string;
  /** Optional structured payload (not included in leaf hash). */
  metadata?: Record<string, unknown>;
}

// ─── Proof ───────────────────────────────────────────────────────────────────

/**
 * Sibling node in a Merkle inclusion proof.
 * `position` tells the verifier which side to place the sibling when
 * recomputing the parent hash.
 */
export interface MerkleSibling {
  hash: string;
  position: "left" | "right";
}

/**
 * Inclusion proof for a single receipt inside a Merkle tree.
 */
export interface MerkleProof {
  /** SHA-256 root of the tree (64 hex chars). */
  root: string;
  /** SHA-256 leaf hash of the receipt (64 hex chars). */
  leaf: string;
  /** 0-based position of the leaf in the sorted leaf list. */
  index: number;
  /** Ordered sibling path from leaf to root. */
  siblings: MerkleSibling[];
}

// ─── Settlement record ───────────────────────────────────────────────────────

/**
 * Signed artifact produced at channel close.
 * Stored off-chain (Supabase, IPFS, etc.) and serves as the trust anchor
 * for all receipt proofs issued against this settlement.
 */
export interface SettlementRecord {
  channelId: string;
  receiptRoot: string;
  totalAmount: number;
  receiptCount: number;
  /** Unix timestamp in seconds when the channel was settled. */
  settledAt: number;
  /** Payer's signature over the canonical settlement payload. */
  payerSignature?: string;
  /** Payee's signature over the canonical settlement payload. */
  payeeSignature?: string;
}

// ─── Leaf / node hashing (RFC 6962-style) ────────────────────────────────────

/**
 * Canonical serialisation of a receipt for leaf hashing.
 *
 * Fields are joined with null bytes so no field can absorb a delimiter.
 * Numbers are written as decimal strings to avoid floating-point ambiguity.
 * `metadata` is intentionally excluded; include sensitive metadata in
 * `description` or use a versioned extension scheme.
 */
function canonicalBytes(r: Receipt): Buffer {
  const parts = [
    r.channelId,
    r.receiptId,
    String(r.amount),
    String(r.timestamp),
    String(r.nonce),
    r.payerAddress,
    r.payeeAddress,
    r.description,
  ];
  return Buffer.from(parts.join("\x00"), "utf8");
}

/**
 * Hash a leaf: `SHA-256(0x00 || canonicalBytes(receipt))`.
 * The 0x00 prefix follows RFC 6962 to prevent second-preimage attacks
 * where an internal node could be mistaken for a leaf.
 */
export function hashLeaf(receipt: Receipt): string {
  return crypto
    .createHash("sha256")
    .update(Buffer.from([0x00]))
    .update(canonicalBytes(receipt))
    .digest("hex");
}

/**
 * Hash an internal node: `SHA-256(0x01 || left || right)`.
 */
function hashNode(left: string, right: string): string {
  return crypto
    .createHash("sha256")
    .update(Buffer.from([0x01]))
    .update(Buffer.from(left, "hex"))
    .update(Buffer.from(right, "hex"))
    .digest("hex");
}

// ─── Tree ────────────────────────────────────────────────────────────────────

/**
 * Internal representation of a built Merkle tree.
 * `layers[0]` is the sorted leaf layer; `layers[layers.length - 1]` is `[root]`.
 */
interface MerkleTree {
  layers: string[][];
  /** Sorted leaf list (same order as layers[0]). */
  sortedLeaves: string[];
}

/**
 * Build a Merkle tree from a list of receipts.
 *
 * Steps:
 *  1. Hash every receipt into a leaf.
 *  2. Sort leaves ascending by hex value — makes the root deterministic
 *     regardless of input order.
 *  3. Build the tree bottom-up, duplicating the last node when the layer
 *     has an odd count.
 *
 * @throws {Error} when `receipts` is empty (a tree with no leaves has no root).
 */
export function buildReceiptTree(receipts: Receipt[]): {
  root: string;
  tree: MerkleTree;
} {
  if (receipts.length === 0) {
    throw new Error("Cannot build a Merkle tree from an empty receipt list");
  }

  // Step 1 — hash leaves
  const rawLeaves = receipts.map(hashLeaf);

  // Step 2 — sort for determinism
  const sortedLeaves = [...rawLeaves].sort();

  // Step 3 — build layers
  const layers: string[][] = [sortedLeaves];

  let current = sortedLeaves;
  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]!;
      // Duplicate last node if the layer is odd-length
      const right = current[i + 1] ?? left;
      next.push(hashNode(left, right));
    }
    layers.push(next);
    current = next;
  }

  const root = current[0]!;
  return { root, tree: { layers, sortedLeaves } };
}

// ─── Proof generation ────────────────────────────────────────────────────────

/**
 * Generate an inclusion proof for `receipt` against a pre-built tree.
 *
 * @param receipt  The receipt to prove.
 * @param tree     The tree returned by `buildReceiptTree`.
 * @returns        A `MerkleProof` or `null` if the receipt is not in the tree.
 */
export function generateProof(
  receipt: Receipt,
  tree: MerkleTree,
): MerkleProof | null {
  const leaf = hashLeaf(receipt);
  const index = tree.sortedLeaves.indexOf(leaf);
  if (index === -1) return null;

  const siblings: MerkleSibling[] = [];
  let currentIndex = index;

  for (let level = 0; level < tree.layers.length - 1; level++) {
    const layer = tree.layers[level]!;
    const isRightNode = currentIndex % 2 === 1;
    const siblingIndex = isRightNode ? currentIndex - 1 : currentIndex + 1;

    // If there is no sibling (odd layer), use the node itself
    const siblingHash = layer[siblingIndex] ?? layer[currentIndex]!;

    siblings.push({
      hash: siblingHash,
      position: isRightNode ? "left" : "right",
    });

    currentIndex = Math.floor(currentIndex / 2);
  }

  const root = tree.layers[tree.layers.length - 1]![0]!;
  return { root, leaf, index, siblings };
}

// ─── Proof verification ───────────────────────────────────────────────────────

/**
 * Verify that `receipt` is included in the settlement identified by `expectedRoot`.
 *
 * This function is **pure** — it makes no network calls and can run in any
 * environment (browser, Node.js, edge runtime).
 *
 * @param receipt       The receipt to verify.
 * @param proof         The inclusion proof obtained from the settlement party.
 * @param expectedRoot  The root from the signed settlement record.
 * @returns             `true` if the receipt is proven to be in the tree.
 */
export function verifyInclusion(
  receipt: Receipt,
  proof: MerkleProof,
  expectedRoot: string,
): boolean {
  if (!proof || !expectedRoot) return false;

  const leaf = hashLeaf(receipt);

  // Guard: the proof's own leaf must match the receipt we're verifying
  if (leaf !== proof.leaf) return false;

  let computed = leaf;
  for (const sibling of proof.siblings) {
    if (sibling.position === "left") {
      computed = hashNode(sibling.hash, computed);
    } else {
      computed = hashNode(computed, sibling.hash);
    }
  }

  return computed === expectedRoot;
}

// ─── Settlement record helpers ────────────────────────────────────────────────

/**
 * Build a settlement record from a list of receipts.
 * Call `buildReceiptTree` first if you also need proofs; pass the same root.
 *
 * @param channelId   The channel being settled.
 * @param receipts    All receipts for the settlement period.
 * @param settledAt   Unix timestamp of channel close (defaults to `Date.now()/1000`).
 */
export function buildSettlementRecord(
  channelId: string,
  receipts: Receipt[],
  settledAt?: number,
): SettlementRecord {
  const { root } = buildReceiptTree(receipts);
  const totalAmount = receipts.reduce((sum, r) => sum + r.amount, 0);

  return {
    channelId,
    receiptRoot: root,
    totalAmount,
    receiptCount: receipts.length,
    settledAt: settledAt ?? Math.floor(Date.now() / 1000),
  };
}
