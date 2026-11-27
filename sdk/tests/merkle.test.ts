/**
 * Tests for Merkle receipt commitments (issue #1800).
 *
 * Coverage:
 *  - Leaf encoding determinism
 *  - Tree construction (even / odd / single receipt)
 *  - Inclusion proof generation and round-trip verification
 *  - Tamper detection (wrong amount, swapped siblings, bad root)
 *  - Settlement record helpers
 *  - Edge cases (empty list, duplicate receipts, metadata excluded from leaf)
 */

import { describe, it, expect } from "@jest/globals";
import {
  hashLeaf,
  buildReceiptTree,
  generateProof,
  verifyInclusion,
  buildSettlementRecord,
} from "../src/merkle.js";
import type { Receipt, MerkleProof } from "../src/merkle.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeReceipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    channelId: "chan-001",
    receiptId: "rcpt-001",
    amount: 100,
    timestamp: 1_700_000_000,
    nonce: 1,
    payerAddress: "GPAYER000000000000000000000000000000000000000000000000",
    payeeAddress: "GPAYEE000000000000000000000000000000000000000000000000",
    description: "Monthly renewal",
    ...overrides,
  };
}

function makeReceipts(count: number): Receipt[] {
  return Array.from({ length: count }, (_, i) =>
    makeReceipt({ receiptId: `rcpt-${String(i + 1).padStart(3, "0")}`, nonce: i + 1, amount: (i + 1) * 10 }),
  );
}

// ─── hashLeaf ────────────────────────────────────────────────────────────────

describe("hashLeaf", () => {
  it("produces a 64-character hex string", () => {
    const leaf = hashLeaf(makeReceipt());
    expect(leaf).toHaveLength(64);
    expect(leaf).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same receipt", () => {
    const r = makeReceipt();
    expect(hashLeaf(r)).toBe(hashLeaf(r));
  });

  it("changes when any canonical field changes", () => {
    const base = makeReceipt();
    const fields: Array<keyof Receipt> = [
      "channelId",
      "receiptId",
      "amount",
      "timestamp",
      "nonce",
      "payerAddress",
      "payeeAddress",
      "description",
    ];
    for (const field of fields) {
      const modified = { ...base, [field]: field === "amount" || field === "timestamp" || field === "nonce" ? 999 : "CHANGED" };
      expect(hashLeaf(modified)).not.toBe(hashLeaf(base));
    }
  });

  it("does NOT change when only metadata changes", () => {
    const base = makeReceipt();
    const withMeta = makeReceipt({ metadata: { foo: "bar" } });
    expect(hashLeaf(withMeta)).toBe(hashLeaf(base));
  });
});

// ─── buildReceiptTree ────────────────────────────────────────────────────────

describe("buildReceiptTree", () => {
  it("throws for an empty receipt list", () => {
    expect(() => buildReceiptTree([])).toThrow(
      "Cannot build a Merkle tree from an empty receipt list",
    );
  });

  it("produces a 64-char hex root for a single receipt", () => {
    const { root } = buildReceiptTree([makeReceipt()]);
    expect(root).toHaveLength(64);
    expect(root).toMatch(/^[0-9a-f]{64}$/);
  });

  it("root is a valid 64-char hex value when there is only one receipt", () => {
    const r = makeReceipt();
    const { root } = buildReceiptTree([r]);
    // Single-leaf tree: the lone leaf is padded with itself.
    // The root is deterministic — just verify its shape here.
    expect(root).toHaveLength(64);
    expect(root).toMatch(/^[0-9a-f]{64}$/);
  });

  it("root is deterministic regardless of input order", () => {
    const receipts = makeReceipts(5);
    const { root: root1 } = buildReceiptTree(receipts);
    const shuffled = [...receipts].reverse();
    const { root: root2 } = buildReceiptTree(shuffled);
    expect(root1).toBe(root2);
  });

  it("root changes when a receipt changes", () => {
    const receipts = makeReceipts(4);
    const { root: root1 } = buildReceiptTree(receipts);
    receipts[2]!.amount = 9999;
    const { root: root2 } = buildReceiptTree(receipts);
    expect(root1).not.toBe(root2);
  });

  it("builds correct layer count for 8 leaves (log2(8)+1 = 4 layers)", () => {
    const { tree } = buildReceiptTree(makeReceipts(8));
    expect(tree.layers).toHaveLength(4); // leaves, pairs, quads, root
    expect(tree.layers[0]).toHaveLength(8);
    expect(tree.layers[1]).toHaveLength(4);
    expect(tree.layers[2]).toHaveLength(2);
    expect(tree.layers[3]).toHaveLength(1);
  });

  it("handles odd number of receipts (last node duplicated)", () => {
    // 3 leaves → layer1 has 2 nodes (last duplicated)
    const { tree } = buildReceiptTree(makeReceipts(3));
    expect(tree.layers[1]).toHaveLength(2);
    expect(tree.layers[2]).toHaveLength(1);
  });
});

// ─── generateProof ───────────────────────────────────────────────────────────

describe("generateProof", () => {
  it("returns null for a receipt not in the tree", () => {
    const { tree } = buildReceiptTree(makeReceipts(4));
    const stranger = makeReceipt({ receiptId: "rcpt-999" });
    expect(generateProof(stranger, tree)).toBeNull();
  });

  it("returns a proof with the correct root and leaf", () => {
    const receipts = makeReceipts(4);
    const { root, tree } = buildReceiptTree(receipts);
    const proof = generateProof(receipts[1]!, tree);
    expect(proof).not.toBeNull();
    expect(proof!.root).toBe(root);
    expect(proof!.leaf).toBe(hashLeaf(receipts[1]!));
  });

  it("proof siblings have the correct length (ceil(log2(n)))", () => {
    const receipts = makeReceipts(8);
    const { tree } = buildReceiptTree(receipts);
    const proof = generateProof(receipts[0]!, tree);
    // 8 leaves → 3 levels of siblings
    expect(proof!.siblings).toHaveLength(3);
  });
});

// ─── verifyInclusion ─────────────────────────────────────────────────────────

describe("verifyInclusion", () => {
  function setup(count: number) {
    const receipts = makeReceipts(count);
    const { root, tree } = buildReceiptTree(receipts);
    return { receipts, root, tree };
  }

  it("returns true for every receipt in a 2-receipt tree", () => {
    const { receipts, root, tree } = setup(2);
    for (const r of receipts) {
      const proof = generateProof(r, tree)!;
      expect(verifyInclusion(r, proof, root)).toBe(true);
    }
  });

  it("returns true for every receipt in a 7-receipt tree (odd count)", () => {
    const { receipts, root, tree } = setup(7);
    for (const r of receipts) {
      const proof = generateProof(r, tree)!;
      expect(verifyInclusion(r, proof, root)).toBe(true);
    }
  });

  it("returns true for every receipt in a 1-receipt tree", () => {
    const { receipts, root, tree } = setup(1);
    const proof = generateProof(receipts[0]!, tree)!;
    expect(verifyInclusion(receipts[0]!, proof, root)).toBe(true);
  });

  it("returns false when the receipt amount is tampered", () => {
    const { receipts, root, tree } = setup(4);
    const proof = generateProof(receipts[2]!, tree)!;
    const tampered = { ...receipts[2]!, amount: receipts[2]!.amount + 1 };
    expect(verifyInclusion(tampered, proof, root)).toBe(false);
  });

  it("returns false when the proof leaf does not match the receipt", () => {
    const { receipts, root, tree } = setup(4);
    const proof = generateProof(receipts[0]!, tree)!;
    // Provide a different receipt with the same proof
    expect(verifyInclusion(receipts[1]!, proof, root)).toBe(false);
  });

  it("returns false when a sibling hash is modified", () => {
    const { receipts, root, tree } = setup(4);
    const proof = generateProof(receipts[0]!, tree)!;
    const corrupt: MerkleProof = {
      ...proof,
      siblings: proof.siblings.map((s, i) =>
        i === 0 ? { ...s, hash: "00".repeat(32) } : s,
      ),
    };
    expect(verifyInclusion(receipts[0]!, corrupt, root)).toBe(false);
  });

  it("returns false when the expected root is wrong", () => {
    const { receipts, root, tree } = setup(4);
    const proof = generateProof(receipts[0]!, tree)!;
    expect(verifyInclusion(receipts[0]!, proof, "ff".repeat(32))).toBe(false);
  });

  it("returns false when proof is null-ish", () => {
    const r = makeReceipt();
    expect(verifyInclusion(r, null as unknown as MerkleProof, "aa".repeat(32))).toBe(false);
  });

  it("returns false when expectedRoot is an empty string", () => {
    const { receipts, root, tree } = setup(2);
    const proof = generateProof(receipts[0]!, tree)!;
    expect(verifyInclusion(receipts[0]!, proof, "")).toBe(false);
  });
});

// ─── buildSettlementRecord ───────────────────────────────────────────────────

describe("buildSettlementRecord", () => {
  it("produces a record with the correct receiptRoot", () => {
    const receipts = makeReceipts(5);
    const { root } = buildReceiptTree(receipts);
    const record = buildSettlementRecord("chan-001", receipts);
    expect(record.receiptRoot).toBe(root);
  });

  it("sums totalAmount correctly", () => {
    const receipts = makeReceipts(4);
    const expected = receipts.reduce((s, r) => s + r.amount, 0);
    const record = buildSettlementRecord("chan-001", receipts);
    expect(record.totalAmount).toBe(expected);
  });

  it("stores receiptCount", () => {
    const receipts = makeReceipts(6);
    const record = buildSettlementRecord("chan-001", receipts);
    expect(record.receiptCount).toBe(6);
  });

  it("uses the provided settledAt timestamp", () => {
    const record = buildSettlementRecord("chan-001", makeReceipts(2), 1_750_000_000);
    expect(record.settledAt).toBe(1_750_000_000);
  });

  it("defaults settledAt to approximately now when not provided", () => {
    const before = Math.floor(Date.now() / 1000);
    const record = buildSettlementRecord("chan-001", makeReceipts(2));
    const after = Math.floor(Date.now() / 1000);
    expect(record.settledAt).toBeGreaterThanOrEqual(before);
    expect(record.settledAt).toBeLessThanOrEqual(after);
  });

  it("throws when receipts list is empty (delegates to buildReceiptTree)", () => {
    expect(() => buildSettlementRecord("chan-001", [])).toThrow();
  });
});

// ─── End-to-end scenario ─────────────────────────────────────────────────────

describe("end-to-end: settle a channel and prove one receipt", () => {
  it("verifier can prove any receipt from only the settlement record and a sibling path", () => {
    // 1. Provider assembles all receipts for the billing period.
    const receipts = makeReceipts(10);

    // 2. Build the tree and the settlement record.
    const { root, tree } = buildReceiptTree(receipts);
    const settlement = buildSettlementRecord("chan-e2e", receipts, 1_750_000_000);
    expect(settlement.receiptRoot).toBe(root);

    // 3. Provider issues a proof for one receipt.
    const target = receipts[6]!;
    const proof = generateProof(target, tree)!;
    expect(proof).not.toBeNull();

    // 4. Verifier receives: (receipt, proof, settlement.receiptRoot).
    //    They do NOT need the other 9 receipts.
    expect(verifyInclusion(target, proof, settlement.receiptRoot)).toBe(true);

    // 5. Tampered receipt fails.
    const tampered = { ...target, amount: target.amount + 1 };
    expect(verifyInclusion(tampered, proof, settlement.receiptRoot)).toBe(false);
  });
});
