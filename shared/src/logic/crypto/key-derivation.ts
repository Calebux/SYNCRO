import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';

export interface HKDFOptions {
  salt?: Uint8Array;
  info?: Uint8Array;
  length?: number;
}

const SUBSCRIPTION_KEY_SALT = new TextEncoder().encode('syncro:subscription:v1');
const SUBSCRIPTION_KEY_INFO = new TextEncoder().encode('encryption-key');

/**
 * Derives a key using HKDF from Stellar keys or other secret material.
 * @param ikm Input key material (secret).
 * @param options HKDF options (salt, info, length).
 * @returns Derived key as Uint8Array.
 */
export function deriveKey(ikm: Uint8Array, options: HKDFOptions = {}): Uint8Array {
  const salt = options.salt || new Uint8Array(0);
  const info = options.info || new Uint8Array(0);
  const length = options.length || 32;

  return hkdf(sha256, ikm, salt, info, length);
}

/**
 * Convenience function to derive key from hex string.
 * @param ikmHex Input key material as hex string.
 * @param options HKDF options.
 * @returns Derived key as hex string.
 */
export function deriveKeyHex(ikmHex: string, options: HKDFOptions = {}): string {
  const ikm = hexToBytes(ikmHex);
  const derived = deriveKey(ikm, options);
  return bytesToHex(derived);
}

/**
 * Derives a 256-bit AES encryption key from a Stellar Ed25519 signing key seed.
 *
 * Uses HKDF-SHA256 with:
 *   salt = "syncro:subscription:v1"
 *   info = "encryption-key"
 *
 * Deterministic: same Stellar key always produces the same encryption key.
 * Works in both browser (SubtleCrypto) and Node.js environments.
 *
 * @param stellarSecretKeySeed - Raw 32-byte Ed25519 seed (from StrKey.decodeEd25519SecretSeed).
 * @returns 32-byte AES key as a lowercase hex string.
 */
export function deriveSubscriptionEncryptionKey(stellarSecretKeySeed: Uint8Array): string {
  if (stellarSecretKeySeed.length !== 32) {
    throw new Error('Stellar secret key seed must be exactly 32 bytes');
  }
  const derived = hkdf(sha256, stellarSecretKeySeed, SUBSCRIPTION_KEY_SALT, SUBSCRIPTION_KEY_INFO, 32);
  return bytesToHex(derived);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
