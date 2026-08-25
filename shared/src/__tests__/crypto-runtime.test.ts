import { cryptoPrimitives as nodeCrypto } from '../crypto/runtime/node';
import { cryptoPrimitives as browserCrypto } from '../crypto/runtime/browser';
import { CryptoUnavailableError } from '../crypto/runtime/errors';

const VECTOR_MESSAGE = new TextEncoder().encode('syncro-v2-crypto-vector');
const VECTOR_KEY = new TextEncoder().encode('syncro-hmac-key');

describe.each([
  ['node', nodeCrypto],
  ['browser', browserCrypto],
])('crypto primitives (%s)', (_name, primitives) => {
  it('sha256 matches the FIPS 180-2 abc vector', () => {
    const digest = primitives.sha256(new TextEncoder().encode('abc'));
    expect(Buffer.from(digest).toString('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hmac is deterministic', () => {
    const a = primitives.hmacSha256(VECTOR_KEY, VECTOR_MESSAGE);
    const b = primitives.hmacSha256(VECTOR_KEY, VECTOR_MESSAGE);
    expect(Buffer.from(a)).toEqual(Buffer.from(b));
  });

  it('randomBytes throws on invalid length instead of degrading', () => {
    expect(() => primitives.randomBytes(0)).toThrow(CryptoUnavailableError);
  });

  it('timingSafeEqual is length-safe', () => {
    const a = primitives.randomBytes(16);
    expect(primitives.timingSafeEqual(a, a)).toBe(true);
    expect(primitives.timingSafeEqual(a, primitives.randomBytes(16))).toBe(false);
  });
});

describe('cross-runtime agreement', () => {
  it('sha256 and hmac agree between node and browser implementations', () => {
    expect(Buffer.from(nodeCrypto.sha256(VECTOR_MESSAGE))).toEqual(
      Buffer.from(browserCrypto.sha256(VECTOR_MESSAGE)),
    );
    expect(Buffer.from(nodeCrypto.hmacSha256(VECTOR_KEY, VECTOR_MESSAGE))).toEqual(
      Buffer.from(browserCrypto.hmacSha256(VECTOR_KEY, VECTOR_MESSAGE)),
    );
  });
});
