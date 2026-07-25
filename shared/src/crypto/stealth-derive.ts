import { createHmac } from "crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";

/**
 * Stealth meta-address containing the recipient's view and spend public keys
 * (secp256k1, compressed hex, 66 chars each).
 */
export interface StealthMetaAddress {
  viewPublicKey: string;
  spendPublicKey: string;
}

/**
 * Result of ephemeral stealth address derivation.
 * - ephemeralPubkey: R = r*G (publish in tx memo so recipient can detect the payment)
 * - stealthAddress: P = spend_pubkey + hash(s)*G (one-time payment destination)
 */
export interface EphemeralStealthResult {
  /** Compressed secp256k1 point R = r*G (hex). Publish in tx memo. */
  ephemeralPubkey: string;
  /** One-time stealth address P = spend_pubkey + hash(s)*G (hex). */
  stealthAddress: string;
}

/**
 * Derives a one-time ephemeral stealth address using ECDH (secp256k1).
 *
 * Protocol:
 *   1. r  = sha256(entropy) mod n          — deterministic ephemeral scalar
 *   2. R  = r * G                           — ephemeral pubkey (publish in memo)
 *   3. s  = r * view_pubkey                 — ECDH shared secret point
 *   4. h  = sha256(s.x || s.y)             — shared secret hash
 *   5. P  = spend_pubkey + h*G             — one-time stealth address
 *
 * @param metaAddress - Recipient's stealth meta-address (view + spend pubkeys).
 * @param entropy     - Per-payment entropy (e.g. `${subscriptionId}:${index}`).
 * @returns { ephemeralPubkey, stealthAddress } — both as compressed-point hex strings.
 */
export function deriveEphemeralStealthAddress(
  metaAddress: StealthMetaAddress,
  entropy: string,
): EphemeralStealthResult {
  const n = secp256k1.CURVE.n;

  // Step 1: deterministic ephemeral scalar r = sha256(entropy) mod n
  const entropyBytes = new TextEncoder().encode(entropy);
  const rBytes = sha256(entropyBytes);
  const r = BigInt("0x" + bytesToHex(rBytes)) % n;
  if (r === 0n) throw new Error("Invalid entropy: scalar is zero");

  // Step 2: R = r * G
  const R = secp256k1.ProjectivePoint.BASE.multiply(r);

  // Step 3: s = r * view_pubkey (ECDH)
  const viewPoint = secp256k1.ProjectivePoint.fromHex(metaAddress.viewPublicKey);
  const S = viewPoint.multiply(r);

  // Step 4: h = sha256(shared secret x-coordinate)
  const sBytes = S.toRawBytes(true); // compressed
  const h = BigInt("0x" + bytesToHex(sha256(sBytes))) % n;

  // Step 5: P = spend_pubkey + h*G
  const spendPoint = secp256k1.ProjectivePoint.fromHex(metaAddress.spendPublicKey);
  const hG = secp256k1.ProjectivePoint.BASE.multiply(h);
  const P = spendPoint.add(hG);

  return {
    ephemeralPubkey: bytesToHex(R.toRawBytes(true)),
    stealthAddress: bytesToHex(P.toRawBytes(true)),
  };
}

/**
 * Derives a deterministic stealth address for a subscription.
 *
 * Address = HMAC-SHA256(meta_address, `${subscriptionId}:${index}`)
 *
 * @param metaAddress - The user's stealth meta-address (wallet-level secret).
 * @param subscriptionId - The subscription's unique identifier.
 * @param index - The per-subscription derivation index (starts at 0).
 * @returns A hex-encoded 32-byte stealth address string.
 */
export function deriveStealthAddress(
  metaAddress: string,
  subscriptionId: string,
  index: number,
): string {
  if (index < 0 || !Number.isInteger(index)) {
    throw new RangeError(`stealth_index must be a non-negative integer, got ${index}`);
  }
  return createHmac("sha256", metaAddress)
    .update(`${subscriptionId}:${index}`)
    .digest("hex");
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Recipient-side stealth detection: given ephemeral pubkey R from a tx memo,
 * derive the one-time destination P = spend_pubkey + hash(view_privkey * R)*G.
 *
 * Normalizes the ephemeral pubkey (auto-prepends '02' for 64-char hex strings).
 */
export function detectStealthDestination(
  viewPrivateKeyHex: string,
  spendPublicKeyHex: string,
  ephemeralPubkeyHex: string,
): string {
  const n = secp256k1.CURVE.n;
  const normalized = ephemeralPubkeyHex.length === 64 ? `02${ephemeralPubkeyHex}` : ephemeralPubkeyHex;
  const viewScalar = BigInt("0x" + viewPrivateKeyHex) % n;
  if (viewScalar === 0n) throw new Error("Invalid view private key");

  const R = secp256k1.ProjectivePoint.fromHex(normalized);
  const S = R.multiply(viewScalar);
  const h = BigInt("0x" + bytesToHex(sha256(S.toRawBytes(true)))) % n;

  const spendPoint = secp256k1.ProjectivePoint.fromHex(spendPublicKeyHex);
  const P = spendPoint.add(secp256k1.ProjectivePoint.BASE.multiply(h));

  return bytesToHex(P.toRawBytes(true));
}

