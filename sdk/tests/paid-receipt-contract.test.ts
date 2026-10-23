import { readFileSync } from 'node:fs';
import path from 'node:path';
import { verifyReceipt } from '../src/receipts.js';
import type { PaidReceipt } from '../src/types.js';

const fixture = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../shared/fixtures/paid-receipt.json'), 'utf8'),
) as PaidReceipt;

describe('shared paid receipt contract', () => {
  it('verifies the backend-generated fixture and its required contract fields', () => {
    expect(fixture.amount).toBe(600);
    expect(fixture.rateCardVersion).toBeTruthy();
    expect(fixture.requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(fixture.channelId).toBeTruthy();
    expect(fixture.stateNonce).toBe(17);
    expect(verifyReceipt(fixture)).toBe(true);
  });
});
