import { sha256 } from '@noble/hashes/sha256';
import { RistrettoPoint } from '@noble/curves/ed25519';

const DOMAIN_PREFIX = 'Syncro-Pedersen-v1';
const RISTRETTO_ORDER = 2n ** 252n + 27742317777372353535851937790883648493n;

function groupOrder(): bigint {
  return RISTRETTO_ORDER;
}

function hashToRistrettoPoint(seed: string) {
  const h1 = sha256(new TextEncoder().encode(seed));
  const h2 = sha256(h1);
  const combined = new Uint8Array(64);
  combined.set(h1, 0);
  combined.set(h2, 32);
  return RistrettoPoint.hashToCurve(combined);
}

const G = hashToRistrettoPoint(DOMAIN_PREFIX + '-G');
const H = hashToRistrettoPoint(DOMAIN_PREFIX + '-H');

/**
 * Pedersen commitment to a value.
 *
 * @interface PedersenCommitment
 * @property {string} commitment - Commitment point (hex-encoded Ristretto)
 * @property {string} blindingFactor - Secret blinding factor (hex scalar)
 */
export interface PedersenCommitment {
  commitment: string;
  blindingFactor: string;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function scalarToHex(scalar: bigint): string {
  const hex = scalar.toString(16).padStart(64, '0');
  return hex;
}

/**
 * Convert hex string to scalar (bigint) modulo group order.
 *
 * @param {string} hex - Hex-encoded scalar
 * @returns {bigint} Scalar value modulo group order
 */
export function hexToScalar(hex: string): bigint {
  return BigInt('0x' + hex) % groupOrder();
}

function bytesToScalar(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let i = 0; i < bytes.length; i++) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result % groupOrder();
}

function hashToScalar(...parts: string[]): bigint {
  const input = parts.join('||');
  const hash = sha256(new TextEncoder().encode(input));
  return bytesToScalar(hash);
}

function randomScalar(): bigint {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return bytesToScalar(bytes);
}

function modGroupOrder(n: bigint): bigint {
  const L = groupOrder();
  return ((n % L) + L) % L;
}

/**
 * Create a Pedersen commitment to a value.
 *
 * Creates a commitment C = v*G + r*H where:
 * - v is the value
 * - r is the (random or provided) blinding factor
 * - G, H are independent Ristretto generators
 *
 * The commitment is computationally hiding (reveals no info about v)
 * and perfectly binding (can't prove different value).
 *
 * @param {bigint} value - Value to commit to (amount in cents)
 * @param {bigint} [blindingFactor] - Blinding factor (random if omitted)
 * @returns {PedersenCommitment} Commitment and blinding factor
 *
 * @example
 * ```typescript
 * const commitment = commit(1500n); // $15.00
 * // { commitment: "...", blindingFactor: "..." }
 * ```
 */
export function commit(value: bigint, blindingFactor?: bigint): PedersenCommitment {
  const v = modGroupOrder(value);
  const r = blindingFactor !== undefined ? modGroupOrder(blindingFactor) : randomScalar();
  const C = G.multiply(v).add(H.multiply(r));
  return {
    commitment: C.toHex(),
    blindingFactor: scalarToHex(r),
  };
}

/**
 * Verify a Pedersen commitment.
 *
 * Checks that v*G + r*H == commitment. Returns true if valid, false otherwise.
 *
 * @param {bigint} value - Claimed value
 * @param {bigint} blindingFactor - Blinding factor (as bigint or hex scalar)
 * @param {string} commitment - Original commitment (hex point)
 * @returns {boolean} True if commitment is valid, false otherwise
 *
 * @example
 * ```typescript
 * const isValid = verify(1500n, blindingFactor, commitment.commitment);
 * ```
 */
export function verify(value: bigint, blindingFactor: bigint, commitment: string): boolean {
  try {
    const v = modGroupOrder(value);
    const r = modGroupOrder(blindingFactor);
    const expected = G.multiply(v).add(H.multiply(r));
    return expected.toHex() === commitment;
  } catch {
    return false;
  }
}

/**
 * Create a commitment to an event.
 *
 * Hashes the event type and data, then commits to the hash.
 * Useful for proving events occurred without revealing details.
 *
 * @param {string} eventType - Type of event (e.g., "subscription_payment")
 * @param {string} eventData - Event data (e.g., JSON string)
 * @returns {PedersenCommitment} Event commitment
 *
 * @example
 * ```typescript
 * const commitment = createEventCommitment(
 *   'subscription_payment',
 *   '{"amount": 1500, "date": "2024-01-01"}'
 * );
 * ```
 */
export function createEventCommitment(
  eventType: string,
  eventData: string,
): PedersenCommitment {
  const v = hashToScalar(DOMAIN_PREFIX, 'event', eventType, eventData);
  return commit(v);
}

/**
 * Verify an event commitment.
 *
 * @param {string} eventType - Type of event
 * @param {string} eventData - Event data
 * @param {string} blindingFactor - Blinding factor (hex)
 * @param {string} commitment - Original commitment (hex point)
 * @returns {boolean} True if commitment is valid
 */
export function verifyEventCommitment(
  eventType: string,
  eventData: string,
  blindingFactor: string,
  commitment: string,
): boolean {
  const v = hashToScalar(DOMAIN_PREFIX, 'event', eventType, eventData);
  return verify(v, hexToScalar(blindingFactor), commitment);
}

/**
 * Compute hash of an event.
 *
 * @param {string} eventType - Type of event
 * @param {string} eventData - Event data
 * @returns {string} SHA-256 hash (hex)
 */
export function computeEventHash(eventType: string, eventData: string): string {
  const hash = sha256(
    new TextEncoder().encode([DOMAIN_PREFIX, 'event', eventType, eventData].join('||')),
  );
  return bytesToHex(hash);
}
