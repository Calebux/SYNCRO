export { CryptoUnavailableError } from '@syncro/shared/crypto';
export type { CryptoPrimitives } from '@syncro/shared/crypto';
export { cryptoPrimitives } from '@syncro/shared/crypto/runtime/node';

// Benchmark hook: expose primitives for per-call throughput measurement
// (state signing, receipt signing, receipt verification) in CI.
export const benchmarkTargets = ['stateSign', 'receiptSign', 'receiptVerify'] as const;
