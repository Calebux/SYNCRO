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
