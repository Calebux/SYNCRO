import { PaidReceipt } from '../src/v3/types';
import { ReceiptService, ReceiptStore } from '../src/v3/receipt-service';

describe('receipt persistence', () => {
  it('loads issued receipts after the in-memory service instance is replaced', async () => {
    const records = new Map<string, PaidReceipt>();
    const store: ReceiptStore = {
      async save(receipt) {
        records.set(receipt.receiptId, receipt);
      },
      async get(receiptId) {
        return records.get(receiptId) ?? null;
      },
    };
    const issued = await new ReceiptService(store).issueReceipt({
      receiptId: 'persisted-receipt',
      route: 'GET /resource',
      unit: 'request',
      quantity: 1,
      amount: 1,
      rateCardVersion: 'v3',
      exchangeRate: null,
      channelId: 'channel-1',
      stateNonce: 1,
      requestMethod: 'GET',
      requestPath: '/resource',
      requestQuery: {},
    });

    await expect(new ReceiptService(store).getReceipt(issued.receiptId)).resolves.toEqual(issued);
  });
});
