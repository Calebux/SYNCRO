import * as pedersen from './pedersen';
import { sha256 } from '@noble/hashes/sha256';

const DOMAIN_PREFIX = 'syncro:payment:v1';
const COMMITMENT_VERSION = 1;

export interface PaymentCommitment {
  version: number;
  commitment: string;
  blindingFactor: string;
  nullifier: string;
  metadata: string;
  // Kept for backward compatibility
  amountCommitment: string;
  amountBlindingFactor: string;
}

export interface CommitmentInput {
  userId: string;
  serviceId: string;
  amount: bigint;
  timestamp: number;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToScalar(hex: string): bigint {
  return BigInt('0x' + hex);
}

function generateBlindingFactor(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function domainSeparatedHash(...parts: string[]): string {
  const input = [DOMAIN_PREFIX, ...parts].join('||');
  return bytesToHex(sha256(new TextEncoder().encode(input)));
}

/**
 * C = Pedersen(amount, r) where the payload is domain-separated:
 *   Hash(syncro:payment:v1 || user_id || service_id || amount || timestamp || blinding_factor)
 *
 * The Pedersen commitment hides the amount; the domain-separated hash
 * binds user_id, service_id, timestamp, and blinding factor to prevent
 * cross-protocol replay.
 */
export function createPaymentCommitment(
  input: CommitmentInput | bigint,
  metadata: string = ''
): PaymentCommitment {
  if (typeof input === 'bigint') {
    // Legacy path: amount-only commitment (backward compatible)
    const { commitment, blindingFactor } = pedersen.commit(input);
    const metadataHash = bytesToHex(sha256(new TextEncoder().encode(metadata)));
    const bf = blindingFactor;
    const nullifier = bytesToHex(sha256(new TextEncoder().encode(DOMAIN_PREFIX + '||' + bf)));
    return {
      version: COMMITMENT_VERSION,
      commitment,
      blindingFactor: bf,
      nullifier,
      metadata: metadataHash,
      amountCommitment: commitment,
      amountBlindingFactor: bf,
    };
  }

  const { userId, serviceId, amount, timestamp } = input;
  const blindingFactor = generateBlindingFactor();

  const commitmentHash = domainSeparatedHash(
    userId,
    serviceId,
    amount.toString(),
    timestamp.toString(),
    blindingFactor
  );

  const { commitment, blindingFactor: pedersenBlinding } = pedersen.commit(amount);

  // N = Hash(blinding_factor || service_id) -- prevents double-proving for same service
  const nullifier = computeNullifier(blindingFactor, serviceId);

  const metadataHash = bytesToHex(sha256(new TextEncoder().encode(metadata)));

  return {
    version: COMMITMENT_VERSION,
    commitment,
    blindingFactor: pedersenBlinding,
    nullifier,
    metadata: metadataHash,
    amountCommitment: commitment,
    amountBlindingFactor: pedersenBlinding,
  };
}

/**
 * N = Hash(blinding_factor || service_id)
 * Deterministic per (blinding_factor, service_id) pair.
 * Publishing N on-chain prevents the same payment from being proved twice
 * without revealing the blinding factor or service identity.
 */
export function computeNullifier(blindingFactor: string, serviceId: string): string {
  return domainSeparatedHash(blindingFactor, serviceId);
}

export function verifyPaymentCommitment(amount: bigint, commitment: PaymentCommitment): boolean {
  return pedersen.verify(
    amount,
    hexToScalar(commitment.blindingFactor ?? commitment.amountBlindingFactor),
    commitment.commitment ?? commitment.amountCommitment
  );
}
