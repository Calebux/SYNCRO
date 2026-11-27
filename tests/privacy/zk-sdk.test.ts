import { describe, it, expect } from 'vitest';
import {
  createPaymentCommitment,
  verifyPaymentCommitment,
} from '../../shared/src/crypto/payment-commitment';

/** Mirrors @syncro/sdk/zk generatePaymentProof + verifyPaymentProof */
async function generatePaymentProof(input: {
  userId: string;
  serviceId: string;
  amount: bigint;
  timestamp: number;
}) {
  const commitment = createPaymentCommitment(input);
  const publicInputs = {
    commitment: commitment.commitment,
    nullifier: commitment.nullifier,
    version: String(commitment.version),
  };
  const proof = btoa(JSON.stringify({ ...commitment, publicInputs }));
  return { proof, commitment, publicInputs };
}

function verifyPaymentProof(proof: string, amount: bigint): boolean {
  const decoded = JSON.parse(atob(proof));
  return verifyPaymentCommitment(amount, decoded);
}

describe('ZK Proof SDK', () => {
  it('generates and verifies a payment proof', async () => {
    const result = await generatePaymentProof({
      userId: 'user-1',
      serviceId: 'netflix',
      amount: 1599n,
      timestamp: Date.now(),
    });

    expect(result.proof).toBeTruthy();
    expect(result.publicInputs.commitment).toBeTruthy();
    expect(result.publicInputs.nullifier).toBeTruthy();

    const valid = verifyPaymentProof(result.proof, 1599n);
    expect(valid).toBe(true);
  });

  it('rejects proof with wrong amount', async () => {
    const result = await generatePaymentProof({
      userId: 'user-1',
      serviceId: 'netflix',
      amount: 1599n,
      timestamp: Date.now(),
    });

    const valid = verifyPaymentProof(result.proof, 999n);
    expect(valid).toBe(false);
  });
});
