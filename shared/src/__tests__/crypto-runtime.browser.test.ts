import { cryptoPrimitives } from '../crypto/runtime/browser';
import { CryptoUnavailableError } from '../crypto/runtime/errors';

describe('browser crypto runtime', () => {
  it('uses WebCrypto getRandomValues', () => {
    const bytes = cryptoPrimitives.randomBytes(32);
    expect(bytes).toHaveLength(32);
  });

  it('throws when getRandomValues is missing', () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
    try {
      expect(() => cryptoPrimitives.randomBytes(16)).toThrow(CryptoUnavailableError);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
    }
  });
});
