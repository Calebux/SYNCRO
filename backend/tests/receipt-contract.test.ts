import { createPrivateKey, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ReceiptService } from '../src/v3/receipt-service';
import { PaidReceipt } from '../src/v3/types';

const fixture = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../shared/fixtures/paid-receipt.json'), 'utf8'),
) as PaidReceipt;
const privateKey = createPrivateKey({
  key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex'),
  ]),
  format: 'der',
  type: 'pkcs8',
});
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKeyPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();

describe('shared paid receipt contract', () => {
  const originalPrivateKey = process.env.SYNCRO_RECEIPT_PRIVATE_KEY_PEM;
  const originalPublicKey = process.env.SYNCRO_RECEIPT_PUBLIC_KEY_PEM;

  afterEach(() => {
    jest.useRealTimers();
    if (originalPrivateKey === undefined) {
      delete process.env.SYNCRO_RECEIPT_PRIVATE_KEY_PEM;
    } else {
      process.env.SYNCRO_RECEIPT_PRIVATE_KEY_PEM = originalPrivateKey;
    }
    if (originalPublicKey === undefined) {
      delete process.env.SYNCRO_RECEIPT_PUBLIC_KEY_PEM;
    } else {
      process.env.SYNCRO_RECEIPT_PUBLIC_KEY_PEM = originalPublicKey;
    }
  });

  it('regenerates the shared receipt fixture identically', () => {
    process.env.SYNCRO_RECEIPT_PRIVATE_KEY_PEM = privateKeyPem;
    process.env.SYNCRO_RECEIPT_PUBLIC_KEY_PEM = publicKeyPem;
    jest.useFakeTimers().setSystemTime(new Date(fixture.timestamp));

    const receipt = new ReceiptService().issueReceipt({
      receiptId: fixture.receiptId,
      route: fixture.route,
      unit: fixture.unit,
      quantity: fixture.quantity,
      amount: fixture.amount,
      rateCardVersion: fixture.rateCardVersion,
      exchangeRate: fixture.exchangeRate,
      channelId: fixture.channelId,
      stateNonce: fixture.stateNonce,
      requestMethod: 'POST',
      requestPath: '/echo/task',
      requestQuery: { page: 2, tag: 'fixture' },
    });

    expect(receipt).toEqual(fixture);
  });
});
