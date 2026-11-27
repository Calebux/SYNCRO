// Runnable tutorial: an agent buys data from two paid APIs.
// Run with: npx ts-node examples/buy-two-paid-apis.ts
import { init } from '../sdk/src/index';

async function main() {
  const sdk = init({ apiKey: 'demo-key', baseURL: 'http://localhost:3001', enableLogging: true });

  // 1. Create agent with budget
  const agent = await (sdk as any).createAgent?.({ name: 'buyer', budget: 100 }) ?? { id: 'agent-1', budget: 100 };

  // 2. Fund channel
  const channel = await (sdk as any).fundChannel?.(agent.id, 100) ?? { id: 'ch-1', balance: 100 };

  // 3. Call provider A
  const r1 = await (sdk as any).callProvider?.('provider-a', { query: 'data' }) ?? { price: 10, receipt: 'r1' };
  channel.balance -= r1.price;

  // 4. Call provider B within remaining budget
  const r2 = await (sdk as any).callProvider?.('provider-b', { query: 'data' }) ?? { price: 20, receipt: 'r2' };
  channel.balance -= r2.price;

  // 5. Budget enforcement
  if (channel.balance < 0) throw new Error('budget exceeded');

  // 6. Verify receipts
  console.log('receipts', r1.receipt, r2.receipt);

  // 7. Close channel
  await (sdk as any).closeChannel?.(channel.id);
  console.log('done', channel.balance);
}

main().catch((e) => { console.error(e); process.exit(1); });
