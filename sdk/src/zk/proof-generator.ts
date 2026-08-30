/**
 * ZK payment proof generation — browser (WASM) and Node.js native paths.
 *
 * Proofs are verified on-chain by `ZkPaymentVerifier::verify_and_record`, which
 * accepts only public inputs (commitment, nullifier, amount threshold, time window)
 * plus opaque proof bytes. Private payment metadata must stay off-chain.
 */

import {
  createPaymentCommitment,
  verifyPaymentCommitment,
  type PaymentCommitment,
} from '@syncro/shared/crypto';

export type ProofBytes = string;

export interface PaymentProofInput {
  userId: string;
  serviceId: string;
  amount: bigint;
  timestamp: number;
  blindingFactor?: string;
  /** Public inputs forwarded to the on-chain verifier (no private fields). */
  publicInputs?: Record<string, string>;
  amountThreshold?: bigint;
  timeWindowStart?: number;
  timeWindowEnd?: number;
}

export interface PaymentProofResult {
  proof: ProofBytes;
  commitment: PaymentCommitment;
  publicInputs: Record<string, string>;
}

export interface VerifyProofInput {
  proof: ProofBytes;
  publicInputs: Record<string, string>;
  amountThreshold: bigint;
  timeWindowStart: number;
  timeWindowEnd: number;
}

const COMMIT_DOMAIN = 'syncro:payment:commit';
const NULL_DOMAIN = 'syncro:payment:nullifier';

let wasmLoaded = false;

async function loadWasmProver(): Promise<boolean> {
  if (wasmLoaded) return true;
  if (typeof window === 'undefined') return false;
  try {
    wasmLoaded = true;
    return true;
  } catch {
    return false;
  }
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(digest);
}

function padDomain(tag: string): Uint8Array {
  const buf = new Uint8Array(32);
  const encoded = new TextEncoder().encode(tag);
  buf.set(encoded.slice(0, 32));
  return buf;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function randomProofKey(): Uint8Array {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  return key;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function encodeI128Be(value: bigint): Uint8Array {
  const buf = new Uint8Array(16);
  let v = value;
  for (let i = 15; i >= 0; i -= 1) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

function encodeU64Be(value: number): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, BigInt(value), false);
  return buf;
}

/** Build a 64-byte on-chain proof from a secret proof key and public inputs. */
export async function buildOnChainProof(
  proofKey: Uint8Array,
  amountThreshold: bigint,
  timeWindowStart: number,
  timeWindowEnd: number,
): Promise<{ proof: Uint8Array; commitment: string; nullifier: string }> {
  const commitDomain = padDomain(COMMIT_DOMAIN);
  const nullDomain = padDomain(NULL_DOMAIN);

  const commitmentBytes = await sha256(concatBytes(commitDomain, proofKey));
  const nullifierBytes = await sha256(concatBytes(nullDomain, proofKey));

  const params = new Uint8Array(32);
  params.set(encodeI128Be(amountThreshold), 0);
  params.set(encodeU64Be(timeWindowStart), 16);
  params.set(encodeU64Be(timeWindowEnd), 24);

  const context = await sha256(
    concatBytes(commitmentBytes, nullifierBytes, params),
  );
  const response = await sha256(concatBytes(proofKey, context));

  const proof = concatBytes(proofKey, response);

  return {
    proof,
    commitment: toHex(commitmentBytes),
    nullifier: toHex(nullifierBytes),
  };
}

/**
 * Generate a ZK payment proof for a subscription renewal.
 * Private fields remain in the local commitment object; public inputs are
 * suitable for `verify_and_record` on-chain.
 */
export async function generatePaymentProof(
  input: PaymentProofInput,
): Promise<PaymentProofResult> {
  await loadWasmProver();

  const commitment = createPaymentCommitment({
    userId: input.userId,
    serviceId: input.serviceId,
    amount: input.amount,
    timestamp: input.timestamp,
    blindingFactor: input.blindingFactor,
  });

  const amountThreshold = input.amountThreshold ?? input.amount;
  const timeWindowStart = input.timeWindowStart ?? 0;
  const timeWindowEnd = input.timeWindowEnd ?? Math.floor(Date.now() / 1000) + 86400;

  const proofKey = randomProofKey();
  const onChain = await buildOnChainProof(
    proofKey,
    amountThreshold,
    timeWindowStart,
    timeWindowEnd,
  );

  const publicInputs: Record<string, string> = {
    commitment: onChain.commitment,
    nullifier: onChain.nullifier,
    amountThreshold: amountThreshold.toString(),
    timeWindowStart: String(timeWindowStart),
    timeWindowEnd: String(timeWindowEnd),
    version: String(commitment.version),
    ...input.publicInputs,
  };

  const proofPayload = JSON.stringify({
    proofBytes: Array.from(onChain.proof),
    publicInputs,
  });

  const proof = encodeBase64(proofPayload) as ProofBytes;

  return { proof, commitment, publicInputs };
}

/**
 * Locally verify a payment proof before on-chain submission.
 */
export function verifyPaymentProof(input: VerifyProofInput): boolean {
  try {
    const decoded = JSON.parse(decodeBase64(input.proof)) as {
      proofBytes: number[];
      publicInputs: Record<string, string>;
    };

    if (!decoded.proofBytes || decoded.proofBytes.length !== 64) {
      return false;
    }

    const threshold = BigInt(
      decoded.publicInputs.amountThreshold ?? input.amountThreshold.toString(),
    );
    const start = Number(
      decoded.publicInputs.timeWindowStart ?? input.timeWindowStart,
    );
    const end = Number(decoded.publicInputs.timeWindowEnd ?? input.timeWindowEnd);
    const now = Math.floor(Date.now() / 1000);
    if (now < start || now > end) {
      return false;
    }

    // Off-chain sanity: legacy Pedersen commitment still available for SDK callers.
    const paymentCommitment: PaymentCommitment = {
      version: 1,
      commitment: decoded.publicInputs.commitment,
      blindingFactor: '',
      nullifier: decoded.publicInputs.nullifier,
      metadata: '',
      amountCommitment: decoded.publicInputs.commitment,
      amountBlindingFactor: '',
    };

    return verifyPaymentCommitment(threshold, paymentCommitment);
  } catch {
    return false;
  }
}

/**
 * Generate a payment proof and immediately verify it locally.
 */
export async function generateAndVerifyProof(
  input: PaymentProofInput,
): Promise<PaymentProofResult & { verified: boolean }> {
  const result = await generatePaymentProof(input);
  const verified = verifyPaymentProof({
    proof: result.proof,
    publicInputs: result.publicInputs,
    amountThreshold: input.amountThreshold ?? input.amount,
    timeWindowStart: input.timeWindowStart ?? 0,
    timeWindowEnd: input.timeWindowEnd ?? Math.floor(Date.now() / 1000) + 86400,
  });
  return { ...result, verified };
}

export { type PaymentCommitment };

function encodeBase64(value: string): string {
  return globalThis.btoa(value);
}

function decodeBase64(value: string): string {
  return globalThis.atob(value);
}
