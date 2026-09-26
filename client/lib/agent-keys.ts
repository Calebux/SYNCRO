import { publicKeyFromSeed } from './ed25519-public';
import { decodePublicKey, decodeSecretSeed, encodePublicKey, encodeSecretSeed } from './stellar-strkey';

const PKCS8_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

export interface LocalKeypair {
  publicKey: string;
  secretKey: string;
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function generateKeypair(): Promise<LocalKeypair> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' } as Algorithm, true, ['sign', 'verify']) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const seed = pkcs8.slice(pkcs8.length - 32);
  const rawPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return {
    publicKey: encodePublicKey(rawPublic),
    secretKey: encodeSecretSeed(seed),
  };
}

export async function identifyKey(value: string): Promise<{ publicKey: string; secretKey: string | null }> {
  const trimmed = value.trim();
  if (trimmed.startsWith('S')) {
    const seed = decodeSecretSeed(trimmed);
    return {
      publicKey: encodePublicKey(await publicKeyFromSeed(seed)),
      secretKey: trimmed,
    };
  }
  if (trimmed.startsWith('G')) {
    return { publicKey: encodePublicKey(decodePublicKey(trimmed)), secretKey: null };
  }
  throw new Error('Paste a Stellar key. Public keys start with G. Secret keys start with S.');
}

export async function signMessage(secretKey: string, message: string): Promise<string> {
  const seed = decodeSecretSeed(secretKey.trim());
  const key = await crypto.subtle.importKey(
    'pkcs8',
    concat(PKCS8_PREFIX, seed) as BufferSource,
    { name: 'Ed25519' } as Algorithm,
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    { name: 'Ed25519' } as Algorithm,
    key,
    new TextEncoder().encode(message),
  );
  return bytesToBase64(new Uint8Array(signature));
}
