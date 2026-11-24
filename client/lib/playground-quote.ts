/** Compare Stellar decimal amounts in stroops without floating-point rounding. */
function stroops(value: string): bigint {
  if (!/^\d{1,12}(\.\d{1,7})?$/.test(value)) {
    throw new Error('Enter an amount with up to seven decimal places.');
  }
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * BigInt(10_000_000) + BigInt(fraction.padEnd(7, '0'));
}

export function decimalExceeds(amount: string, limit: string): boolean {
  return stroops(amount) > stroops(limit);
}

function serverDetail(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const record = body as { message?: unknown; error?: unknown };
  if (typeof record.message === 'string' && record.message.trim()) return record.message.trim();
  if (typeof record.error === 'string' && record.error.trim()) return record.error.trim();
  return '';
}

/** Clear copy when the gateway cannot quote or accept a paid call. */
export function describeGatewayUnavailable(body: unknown): string {
  const detail = serverDetail(body);
  if (detail) return `The gateway returned 503. ${detail}`;
  return 'The gateway returned 503 and did not explain why.';
}

export async function getPlaygroundQuote(
  apiOrigin: string,
  budget: string,
  fetchImpl: typeof fetch = fetch,
  routeId: 'proxy' | 'inference' | 'storage' | 'compute' = 'proxy',
) {
  const limit = stroops(budget);
  if (limit <= BigInt(0)) throw new Error('The budget must be positive.');
  const url = new URL(`/api/v3/gateway/challenge?routeId=${routeId}`, apiOrigin);
  const response = await fetchImpl(url, { credentials: 'omit', redirect: 'error', cache: 'no-store' });
  if (response.status === 503) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    throw new Error(describeGatewayUnavailable(body));
  }
  if (response.status !== 402) throw new Error('The demo gateway did not return a payment challenge.');
  const payload: unknown = await response.json();
  const challenge = payload && typeof payload === 'object'
    ? (payload as { challenge?: unknown }).challenge
    : undefined;
  if (!challenge || typeof challenge !== 'object') {
    throw new Error('The demo gateway returned an unsupported challenge.');
  }
  const record = challenge as {
    scheme?: unknown;
    chain?: unknown;
    amount?: unknown;
    settlementAsset?: unknown;
  };
  if (record.scheme !== 'channel-state' || record.chain !== 'stellar:testnet'
      || typeof record.amount !== 'string' || typeof record.settlementAsset !== 'string') {
    throw new Error('The demo gateway returned an unsupported challenge.');
  }
  if (stroops(record.amount) > limit) throw new Error('The quoted cost exceeds the selected budget.');
  return { amount: record.amount, asset: record.settlementAsset, challenge };
}
