import { describe, it, expect } from 'vitest';
import {
  createPaymentCommitment,
  verifyPaymentCommitment,
} from '../../shared/src/crypto/payment-commitment';

const ITERATIONS = 20;
const TARGET_MS = 5000;

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

describe('ZK Proof Generation Benchmark', () => {
  it('desktop-class: prove+verify latency stays under 5s (p95)', () => {
    const samples: number[] = [];
    const amount = BigInt(1599);

    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      const commitment = createPaymentCommitment({
        userId: 'bench-user',
        serviceId: 'bench-service',
        amount,
        timestamp: Date.now() + i,
      });
      expect(verifyPaymentCommitment(amount, commitment)).toBe(true);
      samples.push(performance.now() - start);
    }

    samples.sort((a, b) => a - b);
    const p95 = percentile(samples, 95);

    // Expose metrics for benchmark documentation consumers
    (globalThis as { __zkBench?: Record<string, number> }).__zkBench = {
      p50: percentile(samples, 50),
      p95,
      p99: percentile(samples, 99),
      mean: samples.reduce((a, b) => a + b, 0) / samples.length,
    };

    expect(p95).toBeLessThan(TARGET_MS);
  }, 30000);
});
