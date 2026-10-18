process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';

import { generateKeyPairSync } from 'node:crypto';
import { ReceiptService } from '../src/v3/receipt-service';

function pemPair() {
  const pair = generateKeyPairSync('ed25519');
  return {
    privatePem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

describe('receipt key rotation (issue #1702)', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('receipts signed before rotation still verify after it', () => {
    const oldKeys = pemPair();
    process.env.SYNCRO_RECEIPT_KEY_ID = 'key-old-1';
    process.env.SYNCRO_RECEIPT_PRIVATE_KEY_PEM = oldKeys.privatePem;
    process.env.SYNCRO_RECEIPT_PUBLIC_KEY_PEM = oldKeys.publicPem;
    const before = new ReceiptService();
    const receipt = before.issueReceipt({
      receiptId: 'r1', route: 'GET /x', unit: 'call', quantity: 1, amount: 1,
      rateCardVersion: 'v1', exchangeRate: null, channelId: 'c1', stateNonce: 1,
      requestMethod: 'GET', requestPath: '/x', requestQuery: {},
    });
    expect(receipt.keyId).toBe('key-old-1');

    const newKeys = pemPair();
    process.env.SYNCRO_RECEIPT_KEY_ID = 'key-new-2';
    process.env.SYNCRO_RECEIPT_PRIVATE_KEY_PEM = newKeys.privatePem;
    process.env.SYNCRO_RECEIPT_PUBLIC_KEY_PEM = newKeys.publicPem;
    process.env.SYNCRO_RECEIPT_PREVIOUS_KEY_ID = 'key-old-1';
    process.env.SYNCRO_RECEIPT_PREVIOUS_PUBLIC_KEY_PEM = oldKeys.publicPem;
    const after = new ReceiptService();

    const keys = after.getReceiptPublicKeys().map((k) => k.keyId);
    expect(keys).toContain('key-new-2');
    expect(keys).toContain('key-old-1');
    expect(after.verifyReceipt(receipt)).toEqual({ ok: true, reason: 'ok' });
  });

  it('receipts signed with a revoked key fail with revoked_key', () => {
    const oldKeys = pemPair();
    process.env.SYNCRO_RECEIPT_KEY_ID = 'key-old-1';
    process.env.SYNCRO_RECEIPT_PRIVATE_KEY_PEM = oldKeys.privatePem;
    process.env.SYNCRO_RECEIPT_PUBLIC_KEY_PEM = oldKeys.publicPem;
    const receipt = new ReceiptService().issueReceipt({
      receiptId: 'r2', route: 'GET /x', unit: 'call', quantity: 1, amount: 1,
      rateCardVersion: 'v1', exchangeRate: null, channelId: 'c1', stateNonce: 1,
      requestMethod: 'GET', requestPath: '/x', requestQuery: {},
    });
    process.env.SYNCRO_RECEIPT_REVOKED_KEY_IDS = 'key-old-1';
    expect(new ReceiptService().verifyReceipt(receipt)).toEqual({ ok: false, reason: 'revoked_key' });
  });
});
