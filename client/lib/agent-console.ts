import { identifyKey, signMessage, type LocalKeypair } from './agent-keys';

export interface CallType {
  id: string;
  label: string;
  detail: string;
}

export interface SpendAndLimit {
  spentPlain: string;
  limitPlain: string;
  together: string;
}

export interface AgentSummary {
  agentId: string;
  label: string | null;
  publicKey: string;
  status: 'active' | 'revoked';
  revokedAt: string | null;
  inFlightCalls: number;
  allowedCalls: string[];
  scopeIds: string[];
  spendAndLimit: SpendAndLimit;
  revocation: {
    stops: string;
    continues: string;
  };
}

export interface AuthorityPreview {
  statement: string;
  before: string;
  after: string;
  requiresReauthentication: boolean;
  confirmation: string;
  agentPublicKey: string;
}

export interface PrincipalSession {
  token: string;
  publicKey: string;
}

export type SpendPeriod = 'day' | 'week' | 'month';

export interface AuthorityDraft {
  scopeIds: string[];
  amount: number;
  period: SpendPeriod;
}

export interface AnchorInfo {
  id: string;
  name: string;
  homeDomain: string;
  assetCode: string;
  assetIssuer: string | null;
  minAmount: string;
  maxAmount: string;
  fee: string;
  network: 'testnet' | 'mainnet';
}

export interface FiatDeposit {
  depositId: string;
  anchorId: string;
  interactiveUrl: string;
  status: 'pending' | 'completed' | 'failed' | 'expired';
  amount: string;
  channelId: string;
  topUpId: string | null;
  channelBalance: string | null;
}

export interface ChannelBalance {
  channelId: string;
  balance: string;
  assetCode: string;
}

const SESSION_STORAGE_KEY = 'syncro.principal.session';

export function agentApiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
}

export function readStoredSession(): PrincipalSession | null {
  if (typeof sessionStorage === 'undefined') return null;
  const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PrincipalSession;
    if (!parsed.token || !parsed.publicKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function storeSession(session: PrincipalSession): void {
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredSession(): void {
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

async function request<T>(base: string, path: string, options: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await response.json().catch(() => ({})) as { data?: T; message?: string; error?: string };
  if (!response.ok) {
    throw new Error(payload.message || 'The request failed.');
  }
  return payload.data as T;
}

export async function openPrincipalSession(base: string, keypair: LocalKeypair): Promise<PrincipalSession> {
  const challenge = await request<{ challengeId: string; message: string }>(base, '/api/v3/agents/session/challenge', {
    method: 'POST',
    body: { publicKey: keypair.publicKey },
  });
  const signature = await signMessage(keypair.secretKey, challenge.message);
  const session = await request<{ token: string; publicKey: string }>(base, '/api/v3/agents/session', {
    method: 'POST',
    body: { challengeId: challenge.challengeId, publicKey: keypair.publicKey, signature },
  });
  storeSession(session);
  return session;
}

export async function loadAgents(base: string, token: string): Promise<{ callTypes: CallType[]; agents: AgentSummary[] }> {
  return request(base, '/api/v3/agents', { token });
}

export async function registerAgent(base: string, token: string, input: { publicKey: string; label?: string }): Promise<AgentSummary> {
  return request(base, '/api/v3/agents', {
    method: 'POST',
    token,
    body: { publicKey: input.publicKey, label: input.label || null },
  });
}

export async function previewAuthority(base: string, token: string, agentId: string, draft: AuthorityDraft): Promise<AuthorityPreview> {
  return request(base, `/api/v3/agents/${agentId}/authority/preview`, {
    method: 'POST',
    token,
    body: draft,
  });
}

export async function applyAuthority(
  base: string,
  token: string,
  agentId: string,
  draft: AuthorityDraft,
  preview: AuthorityPreview,
  principalSecret: string,
): Promise<AgentSummary> {
  let reauthToken: string | undefined;
  if (preview.requiresReauthentication) {
    const challenge = await request<{ challengeId: string; message: string }>(base, '/api/v3/agents/reauth/challenge', {
      method: 'POST',
      token,
    });
    const confirmation = await signMessage(principalSecret, challenge.message);
    const confirmed = await request<{ reauthToken: string }>(base, '/api/v3/agents/reauth', {
      method: 'POST',
      token,
      body: { challengeId: challenge.challengeId, signature: confirmation, statement: preview.statement },
    });
    reauthToken = confirmed.reauthToken;
  }
  const signature = await signMessage(principalSecret, preview.statement);
  return request(base, `/api/v3/agents/${agentId}/authority`, {
    method: 'POST',
    token,
    body: { ...draft, statement: preview.statement, signature, reauthToken },
  });
}

export async function revokeAgent(base: string, token: string, agentId: string): Promise<AgentSummary> {
  return request(base, `/api/v3/agents/${agentId}/revoke`, { method: 'POST', token });
}

export async function inspectImportedKey(value: string): Promise<{ publicKey: string; secretKey: string | null }> {
  return identifyKey(value);
}

export async function loadAnchors(base: string, token: string): Promise<AnchorInfo[]> {
  return request(base, '/api/v3/anchors', { token });
}

export async function startFiatDeposit(
  base: string,
  token: string,
  input: { anchorId: string; channelId: string; amount: string },
): Promise<FiatDeposit> {
  return request(base, '/api/v3/anchors/deposits', {
    method: 'POST',
    token,
    body: input,
  });
}

export async function loadFiatDeposit(base: string, token: string, depositId: string): Promise<FiatDeposit> {
  return request(base, `/api/v3/anchors/deposits/${depositId}`, { token });
}

export async function loadChannelBalance(base: string, token: string, channelId: string): Promise<ChannelBalance> {
  return request(base, `/api/v3/channels/${channelId}/balance`, { token });
}

export interface FiatDepositFlowOptions {
  base: string;
  token: string;
  anchorId: string;
  channelId: string;
  amount: string;
  openInteractive: (url: string) => void;
  pollIntervalMs?: number;
  timeoutMs?: number;
  onUpdate?: (deposit: FiatDeposit) => void;
}

export interface FiatDepositFlowResult {
  deposit: FiatDeposit;
  channelBalance: ChannelBalance;
}

export async function runFiatDepositFlow(options: FiatDepositFlowOptions): Promise<FiatDepositFlowResult> {
  const pollIntervalMs = options.pollIntervalMs ?? 3000;
  const timeoutMs = options.timeoutMs ?? 15 * 60 * 1000;
  const startedAt = Date.now();

  let deposit = await startFiatDeposit(options.base, options.token, {
    anchorId: options.anchorId,
    channelId: options.channelId,
    amount: options.amount,
  });
  options.onUpdate?.(deposit);
  options.openInteractive(deposit.interactiveUrl);

  while (deposit.status === 'pending') {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('The deposit did not complete in time. Please try again.');
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    deposit = await loadFiatDeposit(options.base, options.token, deposit.depositId);
    options.onUpdate?.(deposit);
  }

  if (deposit.status !== 'completed') {
    throw new Error(`The deposit ${deposit.status}. No funds were added to the channel.`);
  }

  const channelBalance = await loadChannelBalance(options.base, options.token, options.channelId);
  return { deposit, channelBalance };
}
