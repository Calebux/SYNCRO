/**
 * Crypto runtime selected by the package exports map / `browser` field.
 * Do not add environment sniffing here — bundlers rewrite `./node` to `./browser`.
 */
export { cryptoPrimitives, CryptoUnavailableError } from './node';
export type { CryptoPrimitives } from './types';
