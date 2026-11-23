export { CryptoUnavailableError } from '@syncro/shared/crypto';

// Benchmarked in browser runtime: state signing, receipt signing, and receipt verification.
// See docs/benchmarks for published per-call throughput. CI fails on >20% regression.
export { cryptoPrimitives } from '@syncro/shared/crypto/runtime/browser';
export type { CryptoPrimitives } from '@syncro/shared/crypto';
