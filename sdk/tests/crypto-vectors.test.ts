import { cryptoPrimitives as nodeCrypto } from '../src/crypto/node.js';
import { cryptoPrimitives as browserCrypto } from '../src/crypto/browser.js';

const MESSAGE = new TextEncoder().encode('syncro-sdk-crypto-vector');
const KEY = new TextEncoder().encode('sdk-hmac-key');

describe('sdk crypto vectors', () => {
  it('node and browser implementations agree', () => {
    expect(Buffer.from(nodeCrypto.sha256(MESSAGE))).toEqual(Buffer.from(browserCrypto.sha256(MESSAGE)));
    expect(Buffer.from(nodeCrypto.hmacSha256(KEY, MESSAGE))).toEqual(
      Buffer.from(browserCrypto.hmacSha256(KEY, MESSAGE)),
    );
  });
});
