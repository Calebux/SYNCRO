export interface EncryptedData {
  iv: string;
  authTag: string;
  ciphertext: string;
}

/**
 * Subscription metadata that can be encrypted.
 *
 * @interface SubscriptionMetadata
 * @property {string} name - Service name (non-empty string)
 * @property {number} price - Price in dollars (>= 0, finite number)
 * @property {'weekly' | 'monthly' | 'quarterly' | 'yearly'} cycle - Billing cycle
 * @property {string} provider - Service provider domain (non-empty string)
 */
export interface SubscriptionMetadata {
  name: string;
  price: number;
  cycle: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  provider: string;
}

const VALID_CYCLES = new Set(['weekly', 'monthly', 'quarterly', 'yearly']);

function validateSubscriptionMetadata(data: unknown): data is SubscriptionMetadata {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.name === 'string' &&
    obj.name.length > 0 &&
    typeof obj.price === 'number' &&
    isFinite(obj.price) &&
    obj.price >= 0 &&
    typeof obj.cycle === 'string' &&
    VALID_CYCLES.has(obj.cycle) &&
    typeof obj.provider === 'string' &&
    obj.provider.length > 0
  );
}

/**
 * Encrypt subscription metadata using AES-256-GCM.
 *
 * Encrypts subscription details (name, price, cycle, provider) so only
 * the holder of the encryption key can view the data. Uses authenticated
 * encryption (AES-GCM) to detect tampering.
 *
 * @async
 * @param {string} key - 64-character hex-encoded encryption key (32 bytes)
 * @param {SubscriptionMetadata} metadata - Subscription details to encrypt
 * @returns {Promise<EncryptedData>} Encrypted data with IV and auth tag
 *
 * @throws {Error} If metadata doesn't match schema or key is invalid
 *
 * @example
 * ```typescript
 * const encrypted = await encryptSubscriptionMetadata(
 *   'aabbccddeeff...(64 chars)',
 *   {
 *     name: 'Netflix',
 *     price: 15.99,
 *     cycle: 'monthly',
 *     provider: 'netflix.com'
 *   }
 * );
 * // { iv: "...", authTag: "...", ciphertext: "..." }
 * ```
 */
export async function encryptSubscriptionMetadata(
  key: string,
  metadata: SubscriptionMetadata
): Promise<EncryptedData> {
  if (!validateSubscriptionMetadata(metadata)) {
    throw new Error('Invalid subscription metadata schema');
  }
  const plaintext = JSON.stringify(metadata);
  return encryptMetadata(plaintext, key);
}

/**
 * Decrypt subscription metadata using AES-256-GCM.
 *
 * Decrypts and validates subscription details. Automatically verifies
 * the authentication tag to detect tampering or wrong key.
 *
 * @async
 * @param {string} key - Same 64-character hex key used for encryption
 * @param {EncryptedData} encrypted - Encrypted data from encryptSubscriptionMetadata()
 * @returns {Promise<SubscriptionMetadata>} Decrypted subscription details
 *
 * @throws {Error} If key is wrong, data corrupted, or tampering detected
 *
 * @example
 * ```typescript
 * const metadata = await decryptSubscriptionMetadata(key, encrypted);
 * console.log(metadata.name); // "Netflix"
 * ```
 */
export async function decryptSubscriptionMetadata(
  key: string,
  encrypted: EncryptedData
): Promise<SubscriptionMetadata> {
  const plaintext = await decryptMetadata(encrypted, key);
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new Error('Decrypted data is not valid JSON');
  }
  if (!validateSubscriptionMetadata(parsed)) {
    throw new Error('Decrypted data does not match subscription metadata schema');
  }
  return parsed;
}

/**
 * Encrypt any string data using AES-256-GCM.
 *
 * Low-level encryption function for arbitrary string data. Generates
 * random IV for each encryption (safe to reuse key).
 *
 * @async
 * @param {string} plaintext - String data to encrypt
 * @param {string} keyHex - 64-character hex-encoded key (32 bytes)
 * @returns {Promise<EncryptedData>} Encrypted data with IV and auth tag
 *
 * @example
 * ```typescript
 * const encrypted = await encryptMetadata('my secret note', keyHex);
 * ```
 */
export async function encryptMetadata(plaintext: string, keyHex: string): Promise<EncryptedData> {
  const keyBytes = hexToBytes(keyHex);
  const keyBuffer = keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ivBuffer = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;
  const key = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivBuffer },
    key,
    plaintextBytes
  );
  const ciphertextWithTag = new Uint8Array(ciphertextBuffer);
  const authTag = ciphertextWithTag.slice(-16);
  const ciphertext = ciphertextWithTag.slice(0, -16);

  return {
    iv: bytesToHex(iv),
    authTag: bytesToHex(authTag),
    ciphertext: bytesToHex(ciphertext),
  };
}

/**
 * Decrypt any string data encrypted with AES-256-GCM.
 *
 * Low-level decryption function. Automatically verifies authentication tag.
 *
 * @async
 * @param {EncryptedData} encrypted - Encrypted data structure
 * @param {string} keyHex - 64-character hex-encoded key (32 bytes)
 * @returns {Promise<string>} Decrypted plaintext
 *
 * @throws {Error} If key is wrong, data corrupted, or tampering detected
 *
 * @example
 * ```typescript
 * const plaintext = await decryptMetadata(encrypted, keyHex);
 * ```
 */
export async function decryptMetadata(encrypted: EncryptedData, keyHex: string): Promise<string> {
  const keyBytes = hexToBytes(keyHex);
  const keyBuffer = keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer;
  const iv = hexToBytes(encrypted.iv);
  const ivBuffer = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;
  const authTag = hexToBytes(encrypted.authTag);
  const ciphertext = hexToBytes(encrypted.ciphertext);
  const ciphertextWithTag = new Uint8Array(ciphertext.length + authTag.length);
  ciphertextWithTag.set(ciphertext);
  ciphertextWithTag.set(authTag, ciphertext.length);
  const dataBuffer = ciphertextWithTag.buffer.slice(
    ciphertextWithTag.byteOffset,
    ciphertextWithTag.byteOffset + ciphertextWithTag.byteLength
  ) as ArrayBuffer;

  const key = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  try {
    const plaintextBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBuffer },
      key,
      dataBuffer
    );
    return new TextDecoder().decode(plaintextBuffer);
  } catch {
    throw new Error('Decryption failed: invalid key or corrupted data');
  }
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
