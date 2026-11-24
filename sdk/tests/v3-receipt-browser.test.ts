import { generateKeyPairSync, sign } from 'node:crypto';
import type { PaidReceipt } from '../src/types.js';
import { verifyReceiptInBrowser } from '../src/v3/receipt-browser.js';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(',')}}`;
}

function makeReceipt(): PaidReceipt {
  const payload = {
    receiptId: 'receipt-1',
    requestHash: 'hash-1',
    route: '/v3/resource',
    unit: 'request',
    quantity: 1,
    amount: 12,
    rateCardVersion: 'v1',
    exchangeRate: null,
    channelId: 'channel-1',
    stateNonce: 4,
    timestamp: '2026-10-20T12:00:00.000Z',
    signerPublicKey: publicKeyPem,
    keyId: 'provider-key-1',
  };
  return {
    ...payload,
    signature: sign(null, Buffer.from(canonicalize(payload)), privateKey).toString('base64'),
  };
}

describe('verifyReceiptInBrowser', () => {
  const keys = [{ keyId: 'provider-key-1', publicKeyPem }];

  it('verifies a valid signed receipt', async () => {
    await expect(verifyReceiptInBrowser(makeReceipt(), keys)).resolves.toEqual({
      ok: true,
      reason: 'ok',
    });
  });

  it('verifies a legacy receipt signed before key ids were included', async () => {
    const { signature: _signature, keyId: _keyId, ...payload } = makeReceipt();
    const receipt: Omit<PaidReceipt, 'keyId'> = {
      ...payload,
      signature: sign(null, Buffer.from(canonicalize(payload)), privateKey).toString('base64'),
    };
    await expect(verifyReceiptInBrowser(receipt, [...keys, { keyId: 'primary-1', publicKeyPem }])).resolves.toEqual({
      ok: true,
      reason: 'ok',
    });
  });

  it('rejects a tampered receipt', async () => {
    await expect(verifyReceiptInBrowser({ ...makeReceipt(), amount: 99 }, keys)).resolves.toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects a receipt signed by a different signer using a trusted key id', async () => {
    const { signature: _signature, ...payload } = makeReceipt();
    const wrongSigner = generateKeyPairSync('ed25519').privateKey;
    const receipt = {
      ...payload,
      signature: sign(null, Buffer.from(canonicalize(payload)), wrongSigner).toString('base64'),
    };
    await expect(verifyReceiptInBrowser(receipt, keys)).resolves.toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('distinguishes a signer that is not in the trusted key set', async () => {
    await expect(verifyReceiptInBrowser({ ...makeReceipt(), keyId: 'untrusted' }, keys)).resolves.toEqual({
      ok: false,
      reason: 'unknown_key',
    });
  });

  it('rejects malformed receipts', async () => {
    await expect(verifyReceiptInBrowser({}, keys)).resolves.toEqual({
      ok: false,
      reason: 'malformed_receipt',
    });
  });
});
