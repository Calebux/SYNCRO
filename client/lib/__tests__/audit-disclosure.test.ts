/**
 * Tests for AES-256-GCM decryption in AuditDisclosureClient.decryptBlindingFactor
 *
 * The method is private, so we access it via `(client as any)` to keep the
 * production interface unchanged while still achieving full coverage.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuditDisclosureClient } from '../audit-disclosure';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 64-character hex key (32 bytes) used in every test. */
const TEST_KEY_HEX = 'a'.repeat(64); // 32 bytes of 0xAA

/**
 * Encrypt `plaintext` with AES-256-GCM using the given key and optional IV.
 * Returns a Buffer in the wire format expected by decryptBlindingFactor:
 *   [ iv: 12 bytes ][ ciphertext+tag: N+16 bytes ]
 */
async function encryptForTest(
  plaintext: Uint8Array,
  keyHex: string = TEST_KEY_HEX,
  iv?: Uint8Array
): Promise<Buffer> {
  const keyBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    keyBytes[i] = parseInt(keyHex.slice(i * 2, i * 2 + 2), 16);
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  const randomIv = new Uint8Array(new ArrayBuffer(12));
  crypto.getRandomValues(randomIv);
  // Ensure the IV is backed by a plain ArrayBuffer (not SharedArrayBuffer) so
  // WebCrypto's BufferSource constraint is satisfied.
  const srcIv = iv ?? randomIv;
  const usedIv = new Uint8Array(new ArrayBuffer(12));
  usedIv.set(srcIv);

  // Ensure plaintext is backed by a plain ArrayBuffer for WebCrypto compatibility.
  const plaintextBuf = new Uint8Array(new ArrayBuffer(plaintext.byteLength));
  plaintextBuf.set(plaintext);

  const ciphertextWithTag = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: usedIv, tagLength: 128 },
    cryptoKey,
    plaintextBuf
  );

  // Wire format: iv || ciphertext+tag
  const result = new Uint8Array(12 + ciphertextWithTag.byteLength);
  result.set(usedIv, 0);
  result.set(new Uint8Array(ciphertextWithTag), 12);
  return Buffer.from(result);
}

// ---------------------------------------------------------------------------
// Test fixture
// ---------------------------------------------------------------------------

describe('AuditDisclosureClient — decryptBlindingFactor', () => {
  let client: AuditDisclosureClient;
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.BLINDING_FACTOR_KEY;
    process.env.BLINDING_FACTOR_KEY = TEST_KEY_HEX;
    client = new AuditDisclosureClient();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.BLINDING_FACTOR_KEY;
    } else {
      process.env.BLINDING_FACTOR_KEY = originalEnv;
    }
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('decrypts a valid AES-256-GCM ciphertext and returns the original plaintext', async () => {
    const plaintext = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe, 0xba, 0xbe]);
    const encrypted = await encryptForTest(plaintext);

    const result = await (client as any).decryptBlindingFactor(encrypted);

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result).toEqual(plaintext);
  });

  it('correctly decrypts a 32-byte blinding factor (typical use case)', async () => {
    // 32 random bytes representing a realistic blinding factor
    const blindingFactor = crypto.getRandomValues(new Uint8Array(32));
    const encrypted = await encryptForTest(blindingFactor);

    const result = await (client as any).decryptBlindingFactor(encrypted);

    expect(result).toEqual(blindingFactor);
  });

  it('produces a Uint8Array (not a Buffer or plain Array)', async () => {
    const plaintext = new Uint8Array(16);
    const encrypted = await encryptForTest(plaintext);

    const result = await (client as any).decryptBlindingFactor(encrypted);

    expect(result).toBeInstanceOf(Uint8Array);
  });

  // -------------------------------------------------------------------------
  // Auth-tag / tampered-ciphertext negative tests
  // -------------------------------------------------------------------------

  it('throws when the auth tag is tampered (last byte flipped)', async () => {
    const plaintext = new Uint8Array([1, 2, 3, 4]);
    const encrypted = await encryptForTest(plaintext);

    // Flip the very last byte (auth tag)
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] ^= 0xff;

    await expect(
      (client as any).decryptBlindingFactor(tampered)
    ).rejects.toThrow(/decryption failed|tampered/i);
  });

  it('throws when a ciphertext byte is flipped (body corruption)', async () => {
    const plaintext = new Uint8Array(32).fill(0xab);
    const encrypted = await encryptForTest(plaintext);

    // Flip a byte in the ciphertext body (byte 12 = first byte after the IV)
    const tampered = Buffer.from(encrypted);
    tampered[12] ^= 0x01;

    await expect(
      (client as any).decryptBlindingFactor(tampered)
    ).rejects.toThrow(/decryption failed|tampered/i);
  });

  it('throws when decrypting with the wrong key', async () => {
    const plaintext = new Uint8Array([0x01, 0x02, 0x03]);
    const encrypted = await encryptForTest(plaintext, TEST_KEY_HEX);

    // Switch to a different key before decrypting
    process.env.BLINDING_FACTOR_KEY = 'b'.repeat(64);

    await expect(
      (client as any).decryptBlindingFactor(encrypted)
    ).rejects.toThrow(/decryption failed|tampered/i);
  });

  it('throws when the IV is replaced but ciphertext+tag remain (IV mismatch)', async () => {
    const plaintext = new Uint8Array([0xca, 0xfe]);
    const originalIv = new Uint8Array(12).fill(0x01);
    const encrypted = await encryptForTest(plaintext, TEST_KEY_HEX, originalIv);

    // Replace IV with all-zeros
    const tampered = Buffer.from(encrypted);
    tampered.fill(0x00, 0, 12);

    await expect(
      (client as any).decryptBlindingFactor(tampered)
    ).rejects.toThrow(/decryption failed|tampered/i);
  });

  // -------------------------------------------------------------------------
  // Input-validation negative tests
  // -------------------------------------------------------------------------

  it('throws when the buffer is shorter than the minimum 28 bytes', async () => {
    const tooShort = Buffer.alloc(27);

    await expect(
      (client as any).decryptBlindingFactor(tooShort)
    ).rejects.toThrow(/too short/i);
  });

  it('throws when BLINDING_FACTOR_KEY is not set', async () => {
    delete process.env.BLINDING_FACTOR_KEY;
    delete process.env.NEXT_PUBLIC_BLINDING_FACTOR_KEY;

    const plaintext = new Uint8Array([0x01]);
    const encrypted = await encryptForTest(plaintext);

    await expect(
      (client as any).decryptBlindingFactor(encrypted)
    ).rejects.toThrow(/BLINDING_FACTOR_KEY.*not set/i);
  });

  it('throws when BLINDING_FACTOR_KEY is the wrong length', async () => {
    process.env.BLINDING_FACTOR_KEY = 'abc'; // only 3 hex chars

    const plaintext = new Uint8Array([0x01]);
    const encrypted = await encryptForTest(plaintext);

    await expect(
      (client as any).decryptBlindingFactor(encrypted)
    ).rejects.toThrow(/64 hex/i);
  });
});
