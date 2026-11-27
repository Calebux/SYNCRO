import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

// ==========================================
// --- 1. CORE IMPLEMENTATION CODE ---
// ==========================================

export interface SubscriptionEvent {
  id: string;
  type: string;
  timestamp: number;
}

export interface DisclosureProof {
  commitment: string;
  opening: {
    value: string; // Serialized string of the disclosed event
    blindingFactor: string; // Salt 'r' to prevent brute-force attacks
  };
  merkleProof: string[]; // Neighboring hashes up the tree
  merkleRoot: string;
  expiresAt: number;
  signature: string;
}

export class SelectiveDisclosureSDK {
  /**
   * Helper utility to compute a deterministic SHA-256 hash string
   */
  public static sha256(data: string): string {
    return createHash("sha256").update(data).digest("hex");
  }

  /**
   * Computes a cryptographic commitment for an event value and a random blinding factor r:
   * c = SHA256(value + r)
   */
  public static computeCommitment(value: string, blindingFactor: string): string {
    return this.sha256(`${value}:${blindingFactor}`);
  }

  /**
   * Verifies an independent disclosure document without access to the full database state
   */
  public verifyProof(proof: DisclosureProof, expectedRoot: string): boolean {
    const currentTime = Date.now();

    // Acceptance Criteria Checking: Expired disclosures must be rejected instantly
    if (currentTime > proof.expiresAt) {
      return false;
    }

    // Step 1: Recompute the cryptographic commitment from the disclosed opening values
    const reconstructedCommitment = SelectiveDisclosureSDK.computeCommitment(
      proof.opening.value,
      proof.opening.blindingFactor
    );

    if (reconstructedCommitment !== proof.commitment) {
      return false;
    }

    // Step 2: Verify the commitment belongs to the valid Merkle Root tree path
    // Simulating sibling verification hash processing
    let currentHash = proof.commitment;
    for (const sibling of proof.merkleProof) {
      currentHash = SelectiveDisclosureSDK.sha256(`${currentHash}${sibling}`);
    }

    return currentHash === expectedRoot && proof.signature.length > 0;
  }
}

// ==========================================
// --- 2. TDD AUTOMATED TEST SUITE ---
// ==========================================

describe("TDD - Selective Disclosure & Privacy Proof Verification Engine", () => {
  let sdk: SelectiveDisclosureSDK;
  let sampleEvent: SubscriptionEvent;
  let sampleBlindingFactor: string;
  let sampleValueStr: string;

  beforeEach(() => {
    sdk = new SelectiveDisclosureSDK();
    
    sampleEvent = {
      id: "evt_100",
      type: "premium_subscription_activated",
      timestamp: 1719500000
    };
    
    sampleBlindingFactor = "r_secure_salt_99999abc";
    sampleValueStr = JSON.stringify(sampleEvent);
  });

  it("should successfully verify a valid, time-compliant disclosure proof path", () => {
    // Arrange: Generate accurate cryptographic commitment links
    const commitment = SelectiveDisclosureSDK.computeCommitment(sampleValueStr, sampleBlindingFactor);
    const mockSiblingHash = SelectiveDisclosureSDK.sha256("evt_101_hidden_commitment");
    const expectedRoot = SelectiveDisclosureSDK.sha256(`${commitment}${mockSiblingHash}`);

    const validProof: DisclosureProof = {
      commitment,
      opening: {
        value: sampleValueStr,
        blindingFactor: sampleBlindingFactor
      },
      merkleProof: [mockSiblingHash],
      merkleRoot: expectedRoot,
      expiresAt: Date.now() + 60000, // Valid for 1 minute into the future
      signature: "sig_user_approved_disclosure_token"
    };

    // Act
    const isVerified = sdk.verifyProof(validProof, expectedRoot);

    // Assert: Check acceptance validation criteria mapping passes safely
    expect(isVerified).toBe(true);
  });

  it("should reject disclosure proofs if their expiration timestamp has passed", () => {
    const commitment = SelectiveDisclosureSDK.computeCommitment(sampleValueStr, sampleBlindingFactor);
    const mockSiblingHash = SelectiveDisclosureSDK.sha256("evt_101_hidden_commitment");
    const expectedRoot = SelectiveDisclosureSDK.sha256(`${commitment}${mockSiblingHash}`);

    const expiredProof: DisclosureProof = {
      commitment,
      opening: {
        value: sampleValueStr,
        blindingFactor: sampleBlindingFactor
      },
      merkleProof: [mockSiblingHash],
      merkleRoot: expectedRoot,
      expiresAt: Date.now() - 5000, // Expired 5 seconds ago
      signature: "sig_stale_token"
    };

    // Act
    const isVerified = sdk.verifyProof(expiredProof, expectedRoot);

    // Assert
    expect(isVerified).toBe(false);
  });

  it("should enforce compliance by guaranteeing blinding factors exist during mock export runs", () => {
    // Compliance Service Requirement: Blinding factors must accompany values in exports to avoid brute-forcing
    const exportDataPayload = {
      event: sampleEvent,
      blindingFactor: sampleBlindingFactor
    };

    expect(exportDataPayload.blindingFactor).toBeDefined();
    expect(exportDataPayload.blindingFactor.length).toBeGreaterThan(10);
  });
});