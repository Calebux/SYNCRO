/**
 * Client wrapper for ZK payment proof generation (Freighter / browser).
 *
 * Re-exports from the SDK — the canonical implementation lives in
 * `@syncro/sdk/zk`. This file provides only the browser-specific
 * `generateAndVerifyProof` convenience.
 */

import {
  generatePaymentProof as sdkGeneratePaymentProof,
  verifyPaymentProof as sdkVerifyPaymentProof,
  generateAndVerifyProof as sdkGenerateAndVerifyProof,
  type PaymentProofInput,
  type PaymentProofResult,
} from '../../sdk/src/zk/proof-generator.js';

export type { PaymentProofInput, PaymentProofResult };
export { type ProofBytes, type VerifyProofInput, type PaymentCommitment } from '../../sdk/src/zk/proof-generator.js';

/** @see {@link sdkGeneratePaymentProof} */
export const generatePaymentProof = sdkGeneratePaymentProof;

/**
 * Verify a payment proof locally (browser context).
 * Accepts a simpler input shape than the SDK variant.
 */
export function verifyPaymentProof(input: {
  proof: string;
  amount: bigint;
}): boolean {
  return sdkVerifyPaymentProof({
    proof: input.proof,
    publicInputs: {},
    amount: input.amount,
  });
}

/** @see {@link sdkGenerateAndVerifyProof} */
export const generateAndVerifyProof = sdkGenerateAndVerifyProof;
