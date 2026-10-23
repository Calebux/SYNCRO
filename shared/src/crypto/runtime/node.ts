import { createHash, createHmac, randomFillSync, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';
import { CryptoUnavailableError } from './errors';
import type { CryptoPrimitives } from './types';

function requireLength(name: string, value: Uint8Array, min = 1): void {
  if (!(value instanceof Uint8Array) || value.length < min) {
    throw new CryptoUnavailableError(name, `${name} produced an empty result`);
  }
}

export const cryptoPrimitives: CryptoPrimitives = {
  randomBytes(length: number): Uint8Array {
    if (!Number.isInteger(length) || length < 1) {
      throw new CryptoUnavailableError('randomBytes', 'length must be a positive integer');
    }
    const bytes = new Uint8Array(length);
    randomFillSync(bytes);
    requireLength('randomBytes', bytes, length);
    return bytes;
  },

  sha256(data: Uint8Array): Uint8Array {
    const digest = createHash('sha256').update(data).digest();
    const out = new Uint8Array(digest);
    requireLength('sha256', out, 32);
    return out;
  },

  hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
    const digest = createHmac('sha256', key).update(data).digest();
    const out = new Uint8Array(digest);
    requireLength('hmacSha256', out, 32);
    return out;
  },

  timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
      return false;
    }
    return nodeTimingSafeEqual(a, b);
  },
};

export { CryptoUnavailableError };
export type { CryptoPrimitives };
