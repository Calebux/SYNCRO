import type { PaidReceipt } from '../types.js';

export interface BrowserReceiptKey {
  keyId: string;
  publicKeyPem: string;
  status?: 'current' | 'previous';
}

export type BrowserReceiptVerifyReason =
  | 'ok'
  | 'unknown_key'
  | 'bad_signature'
  | 'malformed_receipt';

export interface BrowserReceiptVerifyResult {
  ok: boolean;
  reason: BrowserReceiptVerifyReason;
}

type BrowserVerifiableReceipt = Omit<PaidReceipt, 'keyId'> & { keyId?: string };

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodePem(value: string): Uint8Array {
  const encoded = value.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '');
  return decodeBase64(encoded);
}

function receiptPayload(receipt: BrowserVerifiableReceipt): Record<string, unknown> {
  return {
    receiptId: receipt.receiptId,
    requestHash: receipt.requestHash,
    route: receipt.route,
    unit: receipt.unit,
    quantity: receipt.quantity,
    amount: receipt.amount,
    rateCardVersion: receipt.rateCardVersion,
    exchangeRate: receipt.exchangeRate,
    channelId: receipt.channelId,
    stateNonce: receipt.stateNonce,
    timestamp: receipt.timestamp,
    signerPublicKey: receipt.signerPublicKey,
    ...(receipt.keyId === undefined ? {} : { keyId: receipt.keyId }),
  };
}

function isPaidReceipt(value: unknown): value is BrowserVerifiableReceipt {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as Partial<PaidReceipt>;
  return typeof receipt.receiptId === 'string'
    && typeof receipt.requestHash === 'string'
    && typeof receipt.route === 'string'
    && typeof receipt.unit === 'string'
    && typeof receipt.quantity === 'number'
    && typeof receipt.amount === 'number'
    && typeof receipt.rateCardVersion === 'string'
    && (receipt.exchangeRate === null || typeof receipt.exchangeRate === 'number')
    && typeof receipt.channelId === 'string'
    && typeof receipt.stateNonce === 'number'
    && typeof receipt.timestamp === 'string'
    && typeof receipt.signerPublicKey === 'string'
    && (receipt.keyId === undefined || typeof receipt.keyId === 'string')
    && typeof receipt.signature === 'string';
}

export async function verifyReceiptInBrowser(
  value: unknown,
  keys: BrowserReceiptKey[],
): Promise<BrowserReceiptVerifyResult> {
  if (!isPaidReceipt(value)) return { ok: false, reason: 'malformed_receipt' };
  const keyId = value.keyId ?? 'primary-1';
  const key = keys.find((candidate) => candidate.keyId === keyId);
  if (!key || key.publicKeyPem !== value.signerPublicKey) {
    return { ok: false, reason: 'unknown_key' };
  }

  try {
    const publicKey = await globalThis.crypto.subtle.importKey(
      'spki',
      decodePem(key.publicKeyPem) as BufferSource,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    const verified = await globalThis.crypto.subtle.verify(
      { name: 'Ed25519' },
      publicKey,
      decodeBase64(value.signature) as BufferSource,
      new TextEncoder().encode(stableStringify(receiptPayload(value))),
    );
    return verified
      ? { ok: true, reason: 'ok' }
      : { ok: false, reason: 'bad_signature' };
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
}
