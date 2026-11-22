/** Compare Stellar decimal amounts in stroops without floating-point rounding. */
function stroops(value: string): bigint {
  if (!/^\d{1,12}(\.\d{1,7})?$/.test(value)) {
    throw new Error('Enter an amount with up to seven decimal places.');
  }
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10_000_000n + BigInt(fraction.padEnd(7, '0'));
}

export async function getPlaygroundQuote(
  apiOrigin: string,
  budget: string,
  fetchImpl: typeof fetch = fetch,
) {
  const limit = stroops(budget);
  if (limit <= 0n) throw new Error('The budget must be positive.');
  const url = new URL('/api/v3/gateway/challenge?routeId=proxy', apiOrigin);
  const response = await fetchImpl(url, { credentials: 'omit', redirect: 'error', cache: 'no-store' });
  if (response.status !== 402) throw new Error('The demo gateway did not return a payment challenge.');
  const { challenge } = await response.json();
  if (challenge?.scheme !== 'channel-state' || challenge.chain !== 'stellar:testnet'
      || typeof challenge.amount !== 'string' || typeof challenge.settlementAsset !== 'string') {
    throw new Error('The demo gateway returned an unsupported challenge.');
  }
  if (stroops(challenge.amount) > limit) throw new Error('The quoted cost exceeds the selected budget.');
  return { amount: challenge.amount, asset: challenge.settlementAsset, challenge };
}
