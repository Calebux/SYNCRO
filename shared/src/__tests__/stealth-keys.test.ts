import sodium from 'libsodium-wrappers';
import { StealthKeyConverter } from '../logic/crypto/stealth-keys';

function hexToU8(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

function u8ToHex(u: Uint8Array): string {
  return Array.from(u).map(b => b.toString(16).padStart(2, '0')).join('');
}

describe('StealthKeyConverter + RFC7748 vectors', () => {
  beforeAll(async () => {
    await sodium.ready;
  });

  test('RFC7748 X25519 Alice/Bob vector', async () => {
    const aHex = '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a';
    const bHex = '5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb';
    const Aexp = '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a';
    const Bexp = 'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f';
    const Kexp = '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742';

    const a = hexToU8(aHex);
    const b = hexToU8(bHex);
    const basepoint = new Uint8Array(32);
    basepoint[0] = 9;

    const A = sodium.crypto_scalarmult(a, basepoint);
    const B = sodium.crypto_scalarmult(b, basepoint);

    expect(u8ToHex(A)).toBe(Aexp);
    expect(u8ToHex(B)).toBe(Bexp);

    const K1 = sodium.crypto_scalarmult(a, B);
    const K2 = sodium.crypto_scalarmult(b, A);

    expect(u8ToHex(K1)).toBe(Kexp);
    expect(u8ToHex(K2)).toBe(Kexp);
  });

  test('Ed25519 -> Curve25519 conversion round-trip (shared secret equality)', async () => {
    const seedA = new Uint8Array(32);
    const seedB = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      seedA[i] = i;
      seedB[i] = 255 - i;
    }

    const kpA = sodium.crypto_sign_seed_keypair(seedA);
    const kpB = sodium.crypto_sign_seed_keypair(seedB);

    const curveSkA = await StealthKeyConverter.ed25519SecretToCurve25519(kpA.privateKey);
    const curvePkA = await StealthKeyConverter.ed25519PublicKeyToCurve25519(kpA.publicKey);

    const curveSkB = await StealthKeyConverter.ed25519SecretToCurve25519(kpB.privateKey);
    const curvePkB = await StealthKeyConverter.ed25519PublicKeyToCurve25519(kpB.publicKey);

    const shared1 = await StealthKeyConverter.deriveSharedSecret(curveSkA, curvePkB);
    const shared2 = await StealthKeyConverter.deriveSharedSecret(curveSkB, curvePkA);

    expect(u8ToHex(shared1)).toBe(u8ToHex(shared2));
    expect(u8ToHex(shared1)).not.toBe('0000000000000000000000000000000000000000000000000000000000000000');
  });
});
