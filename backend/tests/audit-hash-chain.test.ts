import { hashEvent, verifyChain } from '../src/services/audit-hash-chain';

test('tamper detection', () => {
  const events = [{ a: 1 }, { a: 2 }];
  const hashes = [hashEvent('GENESIS', events[0]), hashEvent(hashEvent('GENESIS', events[0]), events[1])];
  expect(verifyChain(events, hashes)).toBe(true);
  // modify
  events[1] = { a: 3 };
  expect(verifyChain(events, hashes)).toBe(false);
});
