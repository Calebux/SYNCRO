/**
 * Stealth payment memo encoding/decoding for Stellar transactions
 * Memo format: SYNCRO_STEALTH_V1 || compressed_R (32 bytes total)
 * Uses memo_return field to fit ephemeral pubkey R (32 bytes)
 */

const MEMO_PREFIX = 'SYNCRO_STEALTH_V1';
const MEMO_PREFIX_BYTES = Buffer.from(MEMO_PREFIX, 'utf8');

/**
 * Encode ephemeral public key as Stellar transaction memo
 * @param ephemeralPubkey - 32-byte compressed ephemeral public key
 * @returns Encoded memo string for memo_return field
 */
export function encodeSteaithMemo(ephemeralPubkey: Buffer | string): string {
  const pubkeyBuffer = typeof ephemeralPubkey === 'string'
    ? Buffer.from(ephemeralPubkey, 'hex')
    : ephemeralPubkey;

  if (pubkeyBuffer.length !== 32) {
    throw new Error(`Ephemeral pubkey must be 32 bytes, got ${pubkeyBuffer.length}`);
  }

  // Stellar memo_return supports 32 bytes, we use full ephemeral pubkey
  return pubkeyBuffer.toString('base64');
}

/**
 * Decode ephemeral public key from Stellar transaction memo
 * @param memoReturn - Base64-encoded memo_return field
 * @returns Ephemeral public key as hex string
 */
export function decodeStealthMemo(memoReturn: string): string {
  const buffer = Buffer.from(memoReturn, 'base64');

  if (buffer.length !== 32) {
    throw new Error(
      `Invalid stealth memo length: expected 32 bytes, got ${buffer.length}`
    );
  }

  return buffer.toString('hex');
}

/**
 * Check if a memo is a stealth payment memo
 * @param memoType - Type of memo ('hash', 'return', 'text', or 'id')
 * @param memoValue - Value of the memo
 * @returns True if memo matches stealth pattern
 */
export function isStealthMemo(memoType: string, memoValue: string): boolean {
  if (memoType !== 'return') {
    return false;
  }

  try {
    const buffer = Buffer.from(memoValue, 'base64');
    return buffer.length === 32;
  } catch {
    return false;
  }
}

/**
 * Extract ephemeral pubkey from transaction memo
 * @param tx - Stellar transaction object
 * @returns Ephemeral pubkey as hex string, or null if not a stealth memo
 */
export function extractStealthPubkeyFromTx(tx: any): string | null {
  if (!tx.memo || !tx.memo.value) {
    return null;
  }

  const memoType = tx.memo.type || 'text';
  const memoValue = tx.memo.value;

  if (isStealthMemo(memoType, memoValue)) {
    try {
      return decodeStealthMemo(memoValue);
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Create Stellar transaction memo object for stealth payment
 * @param ephemeralPubkey - 32-byte compressed ephemeral public key
 * @returns Memo object suitable for Stellar transaction builder
 */
export function createStealthMemoObject(ephemeralPubkey: Buffer | string) {
  const encodedMemo = encodeSteaithMemo(ephemeralPubkey);

  return {
    type: 'return',
    value: encodedMemo,
  };
}
