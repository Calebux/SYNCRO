import {
  decimalExceeds,
  describeGatewayUnavailable,
  getPlaygroundQuote,
} from './playground-quote';

/** Seeded by `backend/scripts/seed-v3.mjs` (issue #1686). */
export const DEMO_PROVIDER = {
  id: 'v3-provider-demo',
  label: 'v3 mock provider',
  route: 'mock/echo',
} as const;

const DEMO_CHANNEL_BALANCE = 5000;
const FALLBACK_NOTE = 'The demo provider catalog is not available yet. Using the seeded v3 mock provider (mock/echo).';

export interface PlaygroundProvider {
  id: string;
  label: string;
  route: string;
}

export interface PlaygroundSigner {
  publicKey: string;
  sign: (message: string) => Promise<string>;
}

export interface PlaygroundProof {
  channelId: string;
  sequenceNumber: number;
  userBalance: number;
  executorBalance: number;
  totalDeposited: number;
  nonce: string;
  signature: string;
  payerAddress: string;
}

export interface PlaygroundReceipt {
  receiptId: string;
  requestHash: string;
  cost: number;
  unitName?: string;
  units?: number;
  fallbackUsed?: boolean;
  issuedAt: string;
  providerSignature: string;
}

export interface PlaygroundStep {
  id: 'challenge' | 'signed' | 'response' | 'receipt';
  title: string;
  status: 'complete' | 'failed';
  detail: string;
}

export interface PlaygroundRun {
  provider: PlaygroundProvider;
  budget: string;
  prompt: string;
  payerAddress: string;
  amount: string;
  asset: string;
  challenge: unknown;
  signed: {
    message: string;
    header: string;
    proof: PlaygroundProof;
  };
  admission: { granted: boolean; detail: string };
  responseStatus: number;
  responseBody: unknown;
  receipt: PlaygroundReceipt | null;
  verification: { ok: boolean; failures: string[] };
  unavailable: string | null;
  steps: PlaygroundStep[];
  sdkSnippet: string;
}

interface ApiResult {
  status: number;
  ok: boolean;
  data: unknown;
  message: string;
}

function cents(value: string, round: 'ceil' | 'floor'): number {
  const [whole, fraction = ''] = value.split('.');
  const base = Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
  const remainder = fraction.slice(2).split('').some((digit) => digit !== '0');
  if (!remainder) return base;
  return round === 'ceil' ? base + 1 : base;
}

/** Spend cap the playground asks the agent console to grant, in asset units. */
export function playgroundSpendAmount(quote: string, budget: string): number {
  const quoteCents = cents(quote, 'ceil');
  const budgetCents = cents(budget, 'floor');
  const chosen = budgetCents >= quoteCents ? budgetCents : quoteCents;
  return chosen / 100;
}

export function channelBalanceForQuote(amount: string): number {
  const quoted = Number(amount);
  if (!Number.isFinite(quoted) || quoted <= DEMO_CHANNEL_BALANCE) return DEMO_CHANNEL_BALANCE;
  return Math.ceil(quoted);
}

/** Same field order as the gateway's `channelStateProofMessage` (no request hash). */
export function channelStateProofMessage(proof: Omit<PlaygroundProof, 'signature'>): string {
  return [
    proof.channelId,
    proof.sequenceNumber,
    proof.userBalance,
    proof.executorBalance,
    proof.nonce,
    proof.payerAddress,
  ].join(':');
}

export function encodeJsonHeader(value: unknown): string {
  const json = JSON.stringify(value);
  if (typeof btoa === 'function') return btoa(json);
  return Buffer.from(json, 'utf8').toString('base64');
}

function decodeJsonHeader(value: string): unknown {
  const json = typeof atob === 'function' ? atob(value) : Buffer.from(value, 'base64').toString('utf8');
  return JSON.parse(json);
}

function isProvider(value: unknown): PlaygroundProvider | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { id?: unknown; route?: unknown; label?: unknown; name?: unknown };
  if (typeof record.id !== 'string' || record.id.length === 0) return null;
  if (typeof record.route !== 'string' || record.route.length === 0) return null;
  const label = typeof record.label === 'string' && record.label
    ? record.label
    : typeof record.name === 'string' && record.name
      ? record.name
      : record.route;
  return { id: record.id, label, route: record.route };
}

function parseProviders(body: unknown): PlaygroundProvider[] {
  const list = Array.isArray(body)
    ? body
    : body && typeof body === 'object' && Array.isArray((body as { providers?: unknown }).providers)
      ? (body as { providers: unknown[] }).providers
      : [];
  const providers: PlaygroundProvider[] = [];
  for (const item of list) {
    const provider = isProvider(item);
    if (provider && !providers.some((existing) => existing.id === provider.id)) providers.push(provider);
  }
  return providers;
}

function preferDemo(providers: PlaygroundProvider[]): PlaygroundProvider[] {
  const index = providers.findIndex((provider) => provider.id === DEMO_PROVIDER.id || provider.route === DEMO_PROVIDER.route);
  if (index <= 0) return providers;
  const selected = providers[index];
  return [selected, ...providers.slice(0, index), ...providers.slice(index + 1)];
}

export async function loadPlaygroundProviders(
  apiOrigin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ providers: PlaygroundProvider[]; usedFallback: boolean; note: string }> {
  const fallback = { providers: [DEMO_PROVIDER], usedFallback: true, note: FALLBACK_NOTE };
  try {
    const response = await fetchImpl(new URL('/api/v3/gateway/providers', apiOrigin), {
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) return fallback;
    const providers = preferDemo(parseProviders(await response.json()));
    if (providers.length === 0) return fallback;
    return { providers, usedFallback: false, note: '' };
  } catch {
    return fallback;
  }
}

export function selectPlaygroundProvider(providers: PlaygroundProvider[], id: string): PlaygroundProvider {
  return providers.find((provider) => provider.id === id) ?? providers[0] ?? DEMO_PROVIDER;
}

function moneyString(value: number): string | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const trimmed = value.toFixed(7).replace(/\.?0+$/, '');
  return trimmed.length === 0 ? '0' : trimmed;
}

function readReceipt(value: unknown): PlaygroundReceipt | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<PlaygroundReceipt>;
  if (typeof record.receiptId !== 'string' || typeof record.requestHash !== 'string') return null;
  if (typeof record.cost !== 'number' || typeof record.issuedAt !== 'string') return null;
  if (typeof record.providerSignature !== 'string') return null;
  return {
    receiptId: record.receiptId,
    requestHash: record.requestHash,
    cost: record.cost,
    unitName: typeof record.unitName === 'string' ? record.unitName : undefined,
    units: typeof record.units === 'number' ? record.units : undefined,
    fallbackUsed: typeof record.fallbackUsed === 'boolean' ? record.fallbackUsed : undefined,
    issuedAt: record.issuedAt,
    providerSignature: record.providerSignature,
  };
}

function receiptsMatch(left: PlaygroundReceipt, right: PlaygroundReceipt): boolean {
  return left.receiptId === right.receiptId
    && left.requestHash === right.requestHash
    && left.cost === right.cost
    && left.issuedAt === right.issuedAt
    && left.providerSignature === right.providerSignature
    && left.unitName === right.unitName
    && left.units === right.units
    && left.fallbackUsed === right.fallbackUsed;
}

export function verifyPlaygroundReceipt(input: {
  body: unknown;
  paymentResponseHeader: string | null;
  quotedAmount: string;
  budget: string;
}): { ok: boolean; receipt: PlaygroundReceipt | null; failures: string[] } {
  const failures: string[] = [];
  const bodyReceipt = readReceipt(input.body && typeof input.body === 'object'
    ? (input.body as { receipt?: unknown }).receipt
    : undefined);
  if (!bodyReceipt) failures.push('The response body did not include a receipt.');

  let headerReceipt: PlaygroundReceipt | null = null;
  if (!input.paymentResponseHeader) {
    failures.push('The response did not include a PAYMENT-RESPONSE receipt.');
  } else {
    try {
      headerReceipt = readReceipt(decodeJsonHeader(input.paymentResponseHeader));
    } catch {
      headerReceipt = null;
    }
    if (!headerReceipt) failures.push('The PAYMENT-RESPONSE header could not be read.');
  }

  if (bodyReceipt && headerReceipt && !receiptsMatch(bodyReceipt, headerReceipt)) {
    failures.push('The PAYMENT-RESPONSE header does not match the receipt in the body.');
  }

  const receipt = bodyReceipt ?? headerReceipt;
  if (receipt) {
    if (!receipt.receiptId) failures.push('The receipt is missing an id.');
    if (!/^[0-9a-f]{64}$/i.test(receipt.requestHash)) failures.push('The receipt request hash is not a sha256 digest.');
    if (!receipt.providerSignature) failures.push('The receipt is missing a provider signature.');
    if (Number.isNaN(Date.parse(receipt.issuedAt))) failures.push('The receipt issue time is not a date.');
    const rendered = moneyString(receipt.cost);
    if (!rendered || !/^\d{1,12}(\.\d{1,7})?$/.test(rendered)) {
      failures.push('The receipt cost is not a settlement amount.');
    } else if (decimalExceeds(rendered, input.quotedAmount)) {
      failures.push('The receipt cost is above the quoted amount.');
    } else if (decimalExceeds(rendered, input.budget)) {
      failures.push('The receipt cost is above the selected budget.');
    }
  }

  return { ok: failures.length === 0, receipt, failures };
}

async function callApi(
  fetchImpl: typeof fetch,
  url: URL,
  init: { method?: string; token?: string; body?: unknown },
): Promise<ApiResult> {
  const response = await fetchImpl(url, {
    method: init.method ?? 'POST',
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const record = payload && typeof payload === 'object'
    ? payload as { data?: unknown; message?: unknown; error?: unknown }
    : {};
  const message = typeof record.message === 'string' && record.message.trim()
    ? record.message.trim()
    : typeof record.error === 'string' && record.error.trim()
      ? record.error.trim()
      : '';
  return { status: response.status, ok: response.ok, data: record.data, message };
}

function failureDetail(result: ApiResult): string {
  return result.message || `The agent API returned HTTP ${result.status}.`;
}

function agentUrl(apiOrigin: string, path = ''): URL {
  const url = new URL('/api/v3/agents', apiOrigin);
  if (path) url.pathname = `${url.pathname}/${path}`;
  return url;
}

async function admitTestnetAgent(input: {
  apiOrigin: string;
  signer: PlaygroundSigner;
  amount: number;
  fetchImpl: typeof fetch;
}): Promise<{ granted: boolean; detail: string }> {
  try {
    return await grantSpendCap(input);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'The agent API could not be reached.';
    return { granted: false, detail: message };
  }
}

async function grantSpendCap(input: {
  apiOrigin: string;
  signer: PlaygroundSigner;
  amount: number;
  fetchImpl: typeof fetch;
}): Promise<{ granted: boolean; detail: string }> {
  const post = (path: string, body?: unknown, token?: string) => callApi(
    input.fetchImpl,
    agentUrl(input.apiOrigin, path),
    { body, token },
  );

  const challenge = await post('session/challenge', { publicKey: input.signer.publicKey });
  if (challenge.status === 404 || challenge.status === 405) {
    return {
      granted: false,
      detail: 'The agent API is not available yet, so this testnet key was not granted a spend cap.',
    };
  }
  if (!challenge.ok) return { granted: false, detail: failureDetail(challenge) };

  const challengeData = challenge.data as { challengeId?: unknown; message?: unknown } | null;
  if (!challengeData || typeof challengeData.challengeId !== 'string' || typeof challengeData.message !== 'string') {
    return { granted: false, detail: 'The agent API returned an unreadable sign-in challenge.' };
  }
  const sessionSignature = await input.signer.sign(challengeData.message);
  const session = await post('session', {
    challengeId: challengeData.challengeId,
    publicKey: input.signer.publicKey,
    signature: sessionSignature,
  });
  if (!session.ok) return { granted: false, detail: failureDetail(session) };
  const token = (session.data as { token?: unknown } | null)?.token;
  if (typeof token !== 'string' || token.length === 0) {
    return { granted: false, detail: 'The agent API did not open a session.' };
  }

  const registered = await post('', {
    publicKey: input.signer.publicKey,
    label: 'Playground testnet agent',
  }, token);
  let agentId = (registered.data as { agentId?: unknown } | null)?.agentId;
  if (registered.status === 409) {
    const listed = await callApi(input.fetchImpl, agentUrl(input.apiOrigin), { method: 'GET', token });
    const agents = (listed.data as { agents?: unknown } | null)?.agents;
    const existing = Array.isArray(agents)
      ? agents.find((agent) => agent && typeof agent === 'object'
        && (agent as { publicKey?: unknown }).publicKey === input.signer.publicKey)
      : undefined;
    agentId = existing && typeof existing === 'object' ? (existing as { agentId?: unknown }).agentId : undefined;
  } else if (!registered.ok) {
    return { granted: false, detail: failureDetail(registered) };
  }
  if (typeof agentId !== 'string' || agentId.length === 0) {
    return { granted: false, detail: 'The agent API did not return an agent id.' };
  }

  const authority = {
    scopeIds: ['llm:call'],
    amount: input.amount,
    period: 'day' as const,
  };
  const preview = await post(`${agentId}/authority/preview`, authority, token);
  if (!preview.ok) return { granted: false, detail: failureDetail(preview) };
  const previewData = preview.data as { statement?: unknown; requiresReauthentication?: unknown } | null;
  if (!previewData || typeof previewData.statement !== 'string') {
    return { granted: false, detail: 'The agent API did not return a spending statement to sign.' };
  }

  let reauthToken: string | undefined;
  if (previewData.requiresReauthentication) {
    const reauthChallenge = await post('reauth/challenge', {}, token);
    if (!reauthChallenge.ok) return { granted: false, detail: failureDetail(reauthChallenge) };
    const reauthData = reauthChallenge.data as { challengeId?: unknown; message?: unknown } | null;
    if (!reauthData || typeof reauthData.challengeId !== 'string' || typeof reauthData.message !== 'string') {
      return { granted: false, detail: 'The agent API returned an unreadable confirmation challenge.' };
    }
    const confirmed = await post('reauth', {
      challengeId: reauthData.challengeId,
      signature: await input.signer.sign(reauthData.message),
      statement: previewData.statement,
    }, token);
    if (!confirmed.ok) return { granted: false, detail: failureDetail(confirmed) };
    const tokenValue = (confirmed.data as { reauthToken?: unknown } | null)?.reauthToken;
    if (typeof tokenValue !== 'string') {
      return { granted: false, detail: 'The agent API did not confirm the spending change.' };
    }
    reauthToken = tokenValue;
  }

  const applied = await post(`${agentId}/authority`, {
    ...authority,
    statement: previewData.statement,
    signature: await input.signer.sign(previewData.statement),
    reauthToken,
  }, token);
  if (!applied.ok) return { granted: false, detail: failureDetail(applied) };
  return {
    granted: true,
    detail: `Granted a spend cap of ${input.amount} for language model calls today.`,
  };
}

function responseMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const record = body as { message?: unknown; error?: unknown; reason?: unknown };
  if (typeof record.reason === 'string' && record.reason.trim()) return record.reason.trim();
  if (typeof record.message === 'string' && record.message.trim()) return record.message.trim();
  if (typeof record.error === 'string' && record.error.trim()) return record.error.trim();
  return fallback;
}

export function buildPlaygroundSnippet(input: {
  origin: string;
  budget: string;
  provider: PlaygroundProvider;
  prompt: string;
  payerAddress: string;
  sequenceNumber: number;
  userBalance: number;
}): string {
  return [
    '// Same paid call the playground just ran.',
    '// testnetAgent.sign returns a base64 Ed25519 signature from the testnet agent key.',
    `const origin = ${JSON.stringify(input.origin)};`,
    `const budget = ${JSON.stringify(input.budget)};`,
    `const providerRoute = ${JSON.stringify(input.provider.route)};`,
    `const prompt = ${JSON.stringify(input.prompt)};`,
    `const payerAddress = ${JSON.stringify(input.payerAddress)};`,
    '',
    'const challengeResponse = await fetch(`${origin}/api/v3/gateway/challenge?routeId=proxy`, {',
    "  credentials: 'omit',",
    "  cache: 'no-store',",
    '});',
    'if (challengeResponse.status === 503) {',
    "  throw new Error('The gateway returned 503.');",
    '}',
    'const { challenge } = await challengeResponse.json();',
    '// Refuse the call when the quoted amount is above `budget`.',
    '',
    `const sequenceNumber = ${input.sequenceNumber};`,
    `const userBalance = ${input.userBalance};`,
    'const message = [',
    '  challenge.channelAddress,',
    '  sequenceNumber,',
    '  userBalance,',
    '  0,',
    '  challenge.nonce,',
    '  payerAddress,',
    '].join(":");',
    'const signature = await testnetAgent.sign(message);',
    'const proof = {',
    '  channelId: challenge.channelAddress,',
    '  sequenceNumber,',
    '  userBalance,',
    '  executorBalance: 0,',
    '  totalDeposited: userBalance,',
    '  nonce: challenge.nonce,',
    '  payerAddress,',
    '  signature,',
    '};',
    '',
    'const response = await fetch(`${origin}/api/v3/gateway/proxy`, {',
    "  method: 'POST',",
    "  credentials: 'omit',",
    '  headers: {',
    '    authorization: `Bearer ${payerAddress}`,',
    "    'content-type': 'application/json',",
    "    'payment-signature': btoa(JSON.stringify(proof)),",
    '  },',
    '  body: JSON.stringify({ route: providerRoute, input: prompt }),',
    '});',
  ].join('\n');
}

function challengeFields(challenge: unknown): { channelAddress: string; nonce: string } {
  if (!challenge || typeof challenge !== 'object') {
    throw new Error('The demo gateway returned an unsupported challenge.');
  }
  const record = challenge as { channelAddress?: unknown; nonce?: unknown };
  if (typeof record.channelAddress !== 'string' || record.channelAddress.length === 0
      || typeof record.nonce !== 'string' || record.nonce.length === 0) {
    throw new Error('The demo gateway returned an unsupported challenge.');
  }
  return { channelAddress: record.channelAddress, nonce: record.nonce };
}

export async function runPlaygroundCall(input: {
  apiOrigin: string;
  budget: string;
  provider: PlaygroundProvider;
  signer: PlaygroundSigner;
  prompt?: string;
  fetchImpl?: typeof fetch;
  sequenceNumber?: number;
}): Promise<PlaygroundRun> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const prompt = input.prompt ?? 'hello';
  const quote = await getPlaygroundQuote(input.apiOrigin, input.budget, fetchImpl);
  const fields = challengeFields(quote.challenge);
  const sequenceNumber = input.sequenceNumber ?? Date.now();
  const userBalance = channelBalanceForQuote(quote.amount);
  const unsigned = {
    channelId: fields.channelAddress,
    sequenceNumber,
    userBalance,
    executorBalance: 0,
    totalDeposited: userBalance,
    nonce: fields.nonce,
    payerAddress: input.signer.publicKey,
  };
  const message = channelStateProofMessage(unsigned);
  const proof: PlaygroundProof = { ...unsigned, signature: await input.signer.sign(message) };
  const header = encodeJsonHeader(proof);
  const spendAmount = playgroundSpendAmount(quote.amount, input.budget);
  const admission = await admitTestnetAgent({
    apiOrigin: input.apiOrigin,
    signer: input.signer,
    amount: spendAmount,
    fetchImpl,
  });

  let responseStatus = 0;
  let responseBody: unknown = null;
  let paymentResponseHeader: string | null = null;
  let transportError = '';
  try {
    const response = await fetchImpl(new URL('/api/v3/gateway/proxy', input.apiOrigin), {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      headers: {
        authorization: `Bearer ${input.signer.publicKey}`,
        'content-type': 'application/json',
        'payment-signature': header,
      },
      body: JSON.stringify({ route: input.provider.route, input: prompt }),
    });
    responseStatus = response.status;
    paymentResponseHeader = response.headers.get('payment-response');
    const text = await response.text();
    if (text) {
      try {
        responseBody = JSON.parse(text);
      } catch {
        responseBody = { error: text };
      }
    }
  } catch (cause) {
    transportError = cause instanceof Error ? cause.message : 'The gateway could not be reached.';
  }

  const unavailable = responseStatus === 503 ? describeGatewayUnavailable(responseBody) : null;
  const verification = responseStatus === 200
    ? verifyPlaygroundReceipt({
      body: responseBody,
      paymentResponseHeader,
      quotedAmount: quote.amount,
      budget: input.budget,
    })
    : {
      ok: false,
      receipt: null,
      failures: [unavailable ?? (transportError || responseMessage(responseBody, 'The gateway did not return a receipt.'))],
    };

  const responseDetail = transportError
    ? transportError
    : responseStatus === 200
      ? 'The gateway accepted the signed payment.'
      : `HTTP ${responseStatus}. ${responseMessage(responseBody, 'The paid call was not accepted.')}`;

  const steps: PlaygroundStep[] = [
    {
      id: 'challenge',
      title: '402 challenge',
      status: 'complete',
      detail: `Quoted ${quote.amount} ${quote.asset} on stellar:testnet.`,
    },
    {
      id: 'signed',
      title: 'Signed state',
      status: 'complete',
      detail: `Testnet agent ${input.signer.publicKey} signed the channel state. ${admission.detail}`,
    },
    {
      id: 'response',
      title: 'Gateway response',
      status: responseStatus === 200 ? 'complete' : 'failed',
      detail: unavailable ?? responseDetail,
    },
    {
      id: 'receipt',
      title: 'Verified receipt',
      status: verification.ok ? 'complete' : 'failed',
      detail: verification.ok
        ? 'The PAYMENT-RESPONSE receipt matches the body and is within the quote and budget.'
        : verification.failures.join(' '),
    },
  ];

  return {
    provider: input.provider,
    budget: input.budget,
    prompt,
    payerAddress: input.signer.publicKey,
    amount: quote.amount,
    asset: quote.asset,
    challenge: quote.challenge,
    signed: { message, header, proof },
    admission,
    responseStatus,
    responseBody,
    receipt: verification.receipt,
    verification: { ok: verification.ok, failures: verification.failures },
    unavailable,
    steps,
    sdkSnippet: buildPlaygroundSnippet({
      origin: input.apiOrigin,
      budget: input.budget,
      provider: input.provider,
      prompt,
      payerAddress: input.signer.publicKey,
      sequenceNumber,
      userBalance,
    }),
  };
}
