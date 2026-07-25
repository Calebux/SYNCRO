import sodium from 'libsodium-wrappers';

export class StealthKeyConverter {
  /** Ensure libsodium is initialized. */
  private static async ready() {
    if (!(sodium as any).ready) {
      await (sodium as any).ready;
    } else {
      await sodium.ready;
    }
  }

  /**
   * Convert an Ed25519 public key (32 bytes) to a Curve25519 public key (32 bytes).
   */
  static async ed25519PublicKeyToCurve25519(edPublicKey: Uint8Array): Promise<Uint8Array> {
    await this.ready();
    return sodium.crypto_sign_ed25519_pk_to_curve25519(edPublicKey);
  }

  /**
   * Convert an Ed25519 secret seed (32 bytes) or full secret key (64 bytes)
   * to a Curve25519 secret key (32 bytes).
   * If a 32-byte seed is provided, it will be expanded to the full Ed25519
   * secret key using `crypto_sign_seed_keypair` first.
   */
  static async ed25519SecretToCurve25519(edSecret: Uint8Array): Promise<Uint8Array> {
    await this.ready();

    let edSecretFull: Uint8Array;
    if (edSecret.length === 32) {
      const kp = sodium.crypto_sign_seed_keypair(edSecret);
      edSecretFull = kp.privateKey;
    } else if (edSecret.length === 64) {
      edSecretFull = edSecret;
    } else {
      throw new Error('edSecret must be 32-byte seed or 64-byte secret key');
    }

    return sodium.crypto_sign_ed25519_sk_to_curve25519(edSecretFull);
  }

  /**
   * Compute the ECDH shared secret using Curve25519 scalar multiplication.
   * Returns 32-byte shared secret.
   */
  static async deriveSharedSecret(curve25519Secret: Uint8Array, curve25519Public: Uint8Array): Promise<Uint8Array> {
    await this.ready();
    return sodium.crypto_scalarmult(curve25519Secret, curve25519Public);
  }
}

export default StealthKeyConverter;
import { edwardsToMontgomeryPub, edwardsToMontgomeryPriv } from '@noble/curves/ed25519';

/**
 * Converts an Ed25519 public key to Curve25519 public key.
 * @param ed25519PubKey Ed25519 public key as hex string.
 * @returns Curve25519 public key as hex string.
 */
export function ed25519ToCurve25519PubKey(ed25519PubKey: string): string {
  const pubKeyBytes = hexToBytes(ed25519PubKey);
  const montgomeryBytes = edwardsToMontgomeryPub(pubKeyBytes);
  return bytesToHex(montgomeryBytes);
}

/**
 * Converts an Ed25519 secret key to Curve25519 secret key.
 * @param ed25519SecKey Ed25519 secret key as hex string.
 * @returns Curve25519 secret key as hex string.
 */
export function ed25519ToCurve25519SecKey(ed25519SecKey: string): string {
  const secKeyBytes = hexToBytes(ed25519SecKey);
  const montgomeryBytes = edwardsToMontgomeryPriv(secKeyBytes);
  return bytesToHex(montgomeryBytes);
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
