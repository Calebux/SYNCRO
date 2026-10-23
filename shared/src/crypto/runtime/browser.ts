import { sha256 as nobleSha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';
import { CryptoUnavailableError } from './errors';
import type { CryptoPrimitives } from './types';

function requireWebCrypto(): Crypto {
  const web = globalThis.crypto;
  if (!web || typeof web.getRandomValues !== 'function') {
    throw new CryptoUnavailableError('getRandomValues');
  }
  return web;
}

export const cryptoPrimitives: CryptoPrimitives = {
  randomBytes(length: number): Uint8Array {
    if (!Number.isInteger(length) || length < 1) {
      throw new CryptoUnavailableError('randomBytes', 'length must be a positive integer');
    }
    return requireWebCrypto().getRandomValues(new Uint8Array(length));
  },

  sha256(data: Uint8Array): Uint8Array {
    return nobleSha256(data);
  },

  hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
    return hmac(nobleSha256, key, data);
  },

  timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
      return false;
    }
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) {
      diff |= a[i] ^ b[i];
    }
    return diff === 0;
  },
};

export { CryptoUnavailableError };
export type { CryptoPrimitives };
