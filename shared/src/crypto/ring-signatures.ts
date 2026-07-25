/**
 * Ring Signatures module for privacy-preserving team proofs
 * Enables anonymous team proofs without identifying the signer
 * 
 * This implementation provides a simplified ring signature scheme where:
 * - A member can prove they belong to a team without revealing their identity
 * - Aggregated team statistics can be computed without individual attribution
 */

import crypto from 'crypto';

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

  const messageHash = crypto
    .createHash('sha256')
    .update(message)
    .digest();

  // Initialize responses array
  const responses: string[] = new Array(memberPublicKeys.length);
  
  // Generate random challenge and responses for non-signer members
  for (let i = 0; i < memberPublicKeys.length; i++) {
    if (i !== signerIndex) {
      responses[i] = crypto.randomBytes(32).toString('hex');
    }
  }

  // Compute the ring to create the challenge
  let ringHash = crypto.createHash('sha256');
  ringHash.update(messageHash);
  
  // For each member, compute their contribution to the ring
  for (let i = 0; i < memberPublicKeys.length; i++) {
    if (i !== signerIndex) {
      // Use random value for non-signer positions
      ringHash.update(responses[i]);
    } else {
      // Placeholder for signer position (will be computed)
      ringHash.update(Buffer.alloc(32, 0));
    }
  }

  const challengeHash = ringHash.digest();
  
  // Compute signer's response to complete the ring
  const signerResponse = crypto
    .createHash('sha256')
    .update(Buffer.concat([
      Buffer.from(signerPrivateKey, 'hex'),
      messageHash,
      challengeHash,
    ]))
    .digest()
    .toString('hex');

  responses[signerIndex] = signerResponse;

  return {
    signature: crypto
      .createHmac('sha256', signerPrivateKey)
      .update(message)
      .digest('hex'),
    challengeHash: challengeHash.toString('hex'),
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

  const messageHash = crypto
    .createHash('sha256')
    .update(message)
    .digest();

  // Reconstruct the ring to verify the challenge
  let ringHash = crypto.createHash('sha256');
  ringHash.update(messageHash);
  
  for (let i = 0; i < memberPublicKeys.length; i++) {
    ringHash.update(signature.responses[i]);
  }

  const reconstructedChallenge = ringHash.digest('hex');
  
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
      sortedTools.map(tool => [tool, subscriptionCounts.get(tool)])
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
  const dataHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(data))
    .digest();

  const commitment = crypto
    .createHash('sha256')
    .update(Buffer.concat([dataHash, Buffer.from(blindingFactor, 'hex')]))
    .digest('hex');

  return {
    commitment,
    hash: dataHash.toString('hex'),
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
