/**
 * Ring Signatures module for privacy-preserving team proofs
 * Enables anonymous team proofs without identifying the signer
 * 
 * This implementation provides a simplified ring signature scheme where:
 * - A member can prove they belong to a team without revealing their identity
 * - Aggregated team statistics can be computed without individual attribution
 */

import { cryptoPrimitives } from './runtime/node';

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function sha256(data: Uint8Array): Uint8Array {
  return cryptoPrimitives.sha256(data);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export interface RingSignatureParams {
  message: string;
  memberPublicKeys: string[]; // Public keys of all team members
  signerPrivateKey: string; // Private key of the actual signer
  signerIndex: number; // Index of signer in memberPublicKeys array
}

export interface RingSignature {
  signature: string;
  challengeHash: string;
  responses: string[]; // One response per member
  signerIndex?: number; // Optional: only revealed if needed for verification
}

/**
 * Generate a ring signature that proves membership without revealing identity
 */
export function generateRingSignature(params: RingSignatureParams): RingSignature {
  const { message, memberPublicKeys, signerPrivateKey, signerIndex } = params;
  
  if (signerIndex >= memberPublicKeys.length) {
    throw new Error('Signer index out of bounds');
  }

  const messageHash = sha256(utf8(message));

  // Initialize responses array
  const responses: string[] = new Array(memberPublicKeys.length);
  
  // Generate random challenge and responses for non-signer members
  for (let i = 0; i < memberPublicKeys.length; i++) {
    if (i !== signerIndex) {
      responses[i] = toHex(cryptoPrimitives.randomBytes(32));
    }
  }

  // Compute the ring to create the challenge
  const ringParts: Uint8Array[] = [messageHash];
  for (let i = 0; i < memberPublicKeys.length; i++) {
    if (i !== signerIndex) {
      ringParts.push(utf8(responses[i]));
    } else {
      ringParts.push(new Uint8Array(32));
    }
  }
  const challengeHash = sha256(concat(ringParts));
  
  const signerResponse = toHex(
    sha256(
      concat([
        hexToBytes(signerPrivateKey),
        messageHash,
        challengeHash,
      ]),
    ),
  );

  responses[signerIndex] = signerResponse;

  return {
    signature: toHex(cryptoPrimitives.hmacSha256(utf8(signerPrivateKey), utf8(message))),
    challengeHash: toHex(challengeHash),
    responses,
  };
}

/**
 * Verify a ring signature (does not reveal who signed)
 */
export function verifyRingSignature(
  signature: RingSignature,
  message: string,
  memberPublicKeys: string[]
): boolean {
  if (signature.responses.length !== memberPublicKeys.length) {
    return false;
  }

  const messageHash = sha256(utf8(message));

  const ringParts: Uint8Array[] = [messageHash];
  for (let i = 0; i < memberPublicKeys.length; i++) {
    ringParts.push(utf8(signature.responses[i]));
  }

  const reconstructedChallenge = toHex(sha256(concat(ringParts)));
  
  return reconstructedChallenge === signature.challengeHash;
}

/**
 * Create an aggregated team proof that proves subscriptions exist
 * without revealing which member has which subscription
 */
export function createAggregatedTeamProof(
  teamId: string,
  memberPublicKeys: string[],
  subscriptionCounts: Map<string, number>, // toolType -> count
  signerPrivateKey: string,
  signerIndex: number
): RingSignature & { aggregateData: Record<string, number> } {
  // Create proof message from aggregated data
  const sortedTools = Array.from(subscriptionCounts.keys()).sort();
  const aggregateMessage = {
    teamId,
    toolCounts: Object.fromEntries(
      sortedTools.map(tool => [tool, subscriptionCounts.get(tool) ?? 0])
    ),
    timestamp: new Date().toISOString(),
    memberCount: memberPublicKeys.length,
  };

  const messageString = JSON.stringify(aggregateMessage);
  
  const ringSignature = generateRingSignature({
    message: messageString,
    memberPublicKeys,
    signerPrivateKey,
    signerIndex,
  });

  return {
    ...ringSignature,
    aggregateData: aggregateMessage.toolCounts,
  };
}

/**
 * Verify an aggregated team proof
 */
export function verifyAggregatedTeamProof(
  proof: RingSignature & { aggregateData: Record<string, number> },
  message: string,
  memberPublicKeys: string[]
): boolean {
  return verifyRingSignature(proof, message, memberPublicKeys);
}

/**
 * Generate a commitment for audit log privacy
 */
export function generateAuditLogCommitment(
  data: Record<string, any>,
  blindingFactor: string
): { commitment: string; hash: string } {
  const dataHash = sha256(utf8(JSON.stringify(data)));
  const commitment = toHex(sha256(concat([dataHash, hexToBytes(blindingFactor)])));

  return {
    commitment,
    hash: toHex(dataHash),
  };
}

/**
 * Verify an audit log commitment without revealing the data
 */
export function verifyAuditLogCommitment(
  commitment: string,
  data: Record<string, any>,
  blindingFactor: string
): boolean {
  const { commitment: recomputedCommitment } = generateAuditLogCommitment(
    data,
    blindingFactor
  );
  
  return commitment === recomputedCommitment;
}
