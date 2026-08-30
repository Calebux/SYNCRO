import { describe, it, expect } from '@jest/globals';
import { performance } from 'node:perf_hooks';
import {
  createPaymentCommitment,
  verifyPaymentCommitment,
} from '../../shared/src/crypto/payment-commitment';

describe('ZK proof benchmark smoke', () => {
  it('generates and verifies proofs within 5s p95 budget (n=30)', () => {
    const samples: number[] = [];
    const amount = 1599n;

    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      const commitment = createPaymentCommitment({
        userId: 'bench',
        serviceId: 'svc',
        amount,
        timestamp: Date.now() + i,
      });
      expect(verifyPaymentCommitment(amount, commitment)).toBe(true);
      samples.push(performance.now() - start);
    }

    samples.sort((a, b) => a - b);
    const p95 = samples[Math.ceil(0.95 * samples.length) - 1]!;
    expect(p95).toBeLessThan(5000);
  });
});
