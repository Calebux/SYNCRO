/**
 * ZK proof generation benchmark (Node.js / desktop class).
 * Run from backend: npx ts-node scripts/benchmark-zk-proofs.ts
 */
import { performance } from 'node:perf_hooks';
import {
  createPaymentCommitment,
  verifyPaymentCommitment,
} from '../../shared/src/crypto/payment-commitment';

const ITERATIONS = 200;
const WARMUP = 20;

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

function benchmarkProveVerify() {
  const samples: number[] = [];
  const amount = BigInt(1599);
  const input = {
    userId: 'bench-user',
    serviceId: 'bench-service',
    amount,
    timestamp: Date.now(),
  };

  for (let i = 0; i < WARMUP; i++) {
    const c = createPaymentCommitment(input);
    verifyPaymentCommitment(amount, c);
  }

  const memBefore = process.memoryUsage().heapUsed;

  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    const commitment = createPaymentCommitment({
      ...input,
      timestamp: input.timestamp + i,
    });
    verifyPaymentCommitment(amount, commitment);
    samples.push(performance.now() - start);
  }

  const memAfter = process.memoryUsage().heapUsed;
  samples.sort((a, b) => a - b);

  return {
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    mean: samples.reduce((a, b) => a + b, 0) / samples.length,
    heapMb: (memAfter - memBefore) / (1024 * 1024),
  };
}

const result = benchmarkProveVerify();

// eslint-disable-next-line no-console
console.log(
  JSON.stringify(
    {
      deviceClass: 'desktop-node',
      runtime: `Node ${process.version}`,
      platform: process.platform,
      arch: process.arch,
      iterations: ITERATIONS,
      unit: 'ms',
      proofGeneration: result,
      targetMs: 5000,
      meetsTarget: result.p95 < 5000,
    },
    null,
    2,
  ),
);
