import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { spendCapService } from '../services/v3/spend-cap-service';

export type SpendPeriod = 'day' | 'week' | 'month';

export interface CallType {
  id: string;
  label: string;
  detail: string;
}

export const CALL_TYPES: CallType[] = [
  {
    id: 'llm:call',
    label: 'Language model calls',
    detail: 'Requests that ask a model to generate or transform text.',
  },
  {
    id: 'compute:run',
    label: 'Compute jobs',
    detail: 'Requests that run a job and return a result.',
  },
  {
    id: 'data:read',
    label: 'Data lookups',
    detail: 'Requests that read data without changing it.',
  },
];

export const REVOKE_STOPS = 'New paid calls are refused immediately.';
export const REVOKE_CONTINUES =
  'Calls already in progress still finish. Money already spent stays spent.';

const CALL_TYPE_IDS = new Set(CALL_TYPES.map((callType) => callType.id));
const PERIOD_DAYS: Record<SpendPeriod, number> = { day: 1, week: 7, month: 30 };
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const REAUTH_TTL_MS = 2 * 60 * 1000;
const DEV_TOKEN_SECRET = 'syncro-agent-console-dev-only';

export class AgentConsoleError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface SpendAndLimitView {
  spentPlain: string;
  limitPlain: string;
  together: string;
}

export interface AgentView {
  agentId: string;
  label: string | null;
  publicKey: string;
  status: 'active' | 'revoked';
  revokedAt: string | null;
  inFlightCalls: number;
  allowedCalls: string[];
  scopeIds: string[];
  spendAndLimit: SpendAndLimitView;
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

export interface AgentAdmission {
  status: 'active' | 'revoked';
  scopeIds: string[];
}

interface AgentRecord {
  agentId: string;
  principalPublicKey: string;
  label: string | null;
  publicKey: string;
  status: 'active' | 'revoked';
  revokedAt: string | null;
  createdAt: string;
  scopeIds: string[];
  amountCents: number | null;
  period: SpendPeriod | null;
  spentCents: number;
  periodStartedAt: number | null;
}

interface ChallengeRecord {
  id: string;
  purpose: 'session' | 'reauth';
  publicKey: string;
  message: string;
  expiresAt: number;
  used: boolean;
}

interface SessionClaims {
  typ: 'session';
  sub: string;
  exp: number;
}

interface ReauthClaims {
  typ: 'reauth';
  sub: string;
  exp: number;
  statementHash: string;
  jti: string;
}

export interface AuthorityInput {
  scopeIds: string[];
  amount: number;
  period: SpendPeriod;
}

function tokenSecret(): string {
  return process.env.AGENT_CONSOLE_TOKEN_SECRET || DEV_TOKEN_SECRET;
}

function assertPublicKey(value: string): string {
  try {
    return Keypair.fromPublicKey(value).publicKey();
  } catch {
    throw new AgentConsoleError(400, 'invalid_public_key', 'Enter a Stellar public key. It starts with G.');
  }
}

function labelFor(scopeId: string): string {
  return CALL_TYPES.find((callType) => callType.id === scopeId)?.label ?? scopeId;
}

function formatUsdcFromCents(cents: number): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, '0');
  return `${cents < 0 ? '-' : ''}${whole}.${fraction} USDC`;
}

function periodNoun(period: SpendPeriod): string {
  if (period === 'day') return 'day';
  if (period === 'week') return 'week';
  return 'month';
}

function spentWindow(period: SpendPeriod): string {
  if (period === 'day') return 'today';
  if (period === 'week') return 'this week';
  return 'this month';
}

export function currentPeriodStart(period: SpendPeriod, nowMs: number): number {
  const date = new Date(nowMs);
  if (period === 'day') {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }
  if (period === 'month') {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  }
  const weekday = date.getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday);
}

function authorityPlain(scopeIds: string[], amountCents: number, period: SpendPeriod): string {
  const calls = scopeIds.map(labelFor).join(', ');
  return `${calls}, up to ${formatUsdcFromCents(amountCents)} every ${periodNoun(period)}`;
}

function dailyRate(amountCents: number, period: SpendPeriod): number {
  return amountCents / PERIOD_DAYS[period];
}

function verifyEd25519(publicKey: string, message: string, signatureBase64: string, failure: string): void {
  let signature: Buffer;
  try {
    signature = Buffer.from(signatureBase64, 'base64');
  } catch {
    throw new AgentConsoleError(400, 'invalid_signature', 'The signature could not be read.');
  }
  if (signature.length !== 64) {
    throw new AgentConsoleError(400, 'invalid_signature', 'The signature could not be read.');
  }
  const verified = Keypair.fromPublicKey(publicKey).verify(Buffer.from(message, 'utf8'), signature);
  if (!verified) {
    throw new AgentConsoleError(400, 'invalid_signature', failure);
  }
}

export class AgentConsoleService {
  private readonly agents = new Map<string, AgentRecord>();
  private readonly challenges = new Map<string, ChallengeRecord>();
  private readonly usedReauth = new Set<string>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  reset(): void {
    for (const agent of this.agents.values()) {
      spendCapService.deleteCap(agent.publicKey);
    }
    this.agents.clear();
    this.challenges.clear();
    this.usedReauth.clear();
  }

  createSessionChallenge(publicKeyInput: string): { challengeId: string; message: string; expiresAt: string } {
    const publicKey = assertPublicKey(publicKeyInput);
    return this.issueChallenge('session', publicKey);
  }

  openSession(input: { challengeId: string; publicKey: string; signature: string }): { token: string; publicKey: string } {
    const publicKey = assertPublicKey(input.publicKey);
    const challenge = this.consumeChallenge('session', input.challengeId, publicKey);
    verifyEd25519(publicKey, challenge.message, input.signature, 'The signature does not match this sign-in.');
    const token = this.signToken({
      typ: 'session',
      sub: publicKey,
      exp: this.now() + SESSION_TTL_MS,
    });
    return { token, publicKey };
  }

  verifySession(token: string): string {
    const claims = this.readToken(token);
    if (!claims || claims.typ !== 'session' || typeof claims.sub !== 'string' || typeof claims.exp !== 'number') {
      throw new AgentConsoleError(401, 'sign_in_required', 'Sign in again to manage agents.');
    }
    if (claims.exp <= this.now()) {
      throw new AgentConsoleError(401, 'sign_in_required', 'Sign in again to manage agents.');
    }
    return claims.sub;
  }

  listAgents(principalPublicKey: string, inFlightCount: (publicKey: string) => number): AgentView[] {
    return [...this.agents.values()]
      .filter((agent) => agent.principalPublicKey === principalPublicKey)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((agent) => this.toView(agent, inFlightCount(agent.publicKey)));
  }

  registerAgent(principalPublicKey: string, input: { publicKey: string; label?: string | null }): AgentView {
    const publicKey = assertPublicKey(input.publicKey);
    if ([...this.agents.values()].some((agent) => agent.publicKey === publicKey)) {
      throw new AgentConsoleError(
        409,
        'agent_exists',
        'An agent with this public identity is already registered.',
      );
    }
    const label = normalizeLabel(input.label);
    const record: AgentRecord = {
      agentId: randomUUID(),
      principalPublicKey,
      label,
      publicKey,
      status: 'active',
      revokedAt: null,
      createdAt: new Date(this.now()).toISOString(),
      scopeIds: [],
      amountCents: null,
      period: null,
      spentCents: 0,
      periodStartedAt: null,
    };
    this.agents.set(record.agentId, record);
    return this.toView(record, 0);
  }

  previewAuthority(principalPublicKey: string, agentId: string, input: AuthorityInput): AuthorityPreview {
    const agent = this.requireOwned(principalPublicKey, agentId);
    this.assertCanChangeAuthority(agent);
    const next = this.normalizeAuthority(input);
    const requiresReauthentication = this.authorityIncreases(agent, next);
    const before = this.previousPlain(agent);
    const after = authorityPlain(next.scopeIds, next.amountCents, next.period);
    return {
      statement: this.buildStatement(agent.publicKey, before, next),
      before,
      after,
      requiresReauthentication,
      confirmation: requiresReauthentication
        ? 'This allows more spending or a new kind of call. Confirm it is you, then sign.'
        : 'This does not raise spending. Sign to apply it.',
      agentPublicKey: agent.publicKey,
    };
  }

  createReauthChallenge(principalPublicKey: string): { challengeId: string; message: string; expiresAt: string } {
    return this.issueChallenge('reauth', principalPublicKey);
  }

  completeReauth(principalPublicKey: string, input: { challengeId: string; signature: string; statement: string }): { reauthToken: string; expiresAt: string } {
    const challenge = this.consumeChallenge('reauth', input.challengeId, principalPublicKey);
    verifyEd25519(
      principalPublicKey,
      challenge.message,
      input.signature,
      'The signature does not match this confirmation.',
    );
    const exp = this.now() + REAUTH_TTL_MS;
    const reauthToken = this.signToken({
      typ: 'reauth',
      sub: principalPublicKey,
      exp,
      statementHash: hashStatement(input.statement),
      jti: randomUUID(),
    });
    return { reauthToken, expiresAt: new Date(exp).toISOString() };
  }

  applyAuthority(
    principalPublicKey: string,
    agentId: string,
    input: AuthorityInput & { statement: string; signature: string; reauthToken?: string | null },
    inFlightCount: (publicKey: string) => number,
  ): AgentView {
    const agent = this.requireOwned(principalPublicKey, agentId);
    this.assertCanChangeAuthority(agent);
    const next = this.normalizeAuthority(input);
    const before = this.previousPlain(agent);
    const statement = this.buildStatement(agent.publicKey, before, next);
    if (input.statement !== statement) {
      throw new AgentConsoleError(
        409,
        'statement_mismatch',
        'The signed words do not match this change. Review it again before signing.',
      );
    }
    verifyEd25519(principalPublicKey, statement, input.signature, 'The signature does not match this change.');
    if (this.authorityIncreases(agent, next)) {
      this.consumeReauth(principalPublicKey, input.reauthToken, statement);
    }

    const periodChanged = agent.period !== null && agent.period !== next.period;
    agent.scopeIds = next.scopeIds;
    agent.amountCents = next.amountCents;
    agent.period = next.period;
    if (periodChanged || agent.periodStartedAt === null) {
      agent.spentCents = 0;
      agent.periodStartedAt = this.now();
    }
    this.writeSpendCap(agent);
    return this.toView(agent, inFlightCount(agent.publicKey));
  }

  revokeAgent(principalPublicKey: string, agentId: string, inFlightCount: (publicKey: string) => number): AgentView {
    const agent = this.requireOwned(principalPublicKey, agentId);
    if (agent.status === 'revoked') {
      return this.toView(agent, inFlightCount(agent.publicKey));
    }
    agent.status = 'revoked';
    agent.revokedAt = new Date(this.now()).toISOString();
    const cap = spendCapService.getCap(agent.publicKey);
    if (cap) {
      spendCapService.setCap({ ...cap, status: 'closed' });
    }
    return this.toView(agent, inFlightCount(agent.publicKey));
  }

  findAdmission(presentedId: string): AgentAdmission | null {
    const agent = this.findByPresentedId(presentedId);
    if (!agent) return null;
    return { status: agent.status, scopeIds: [...agent.scopeIds] };
  }

  recordPresentedSpend(presentedId: string, amount: number): void {
    const agent = this.findByPresentedId(presentedId);
    if (!agent || agent.status !== 'active' || agent.amountCents === null || !agent.period) return;
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.rollSpendWindow(agent);
    agent.spentCents += Math.round(amount * 100);
  }

  private toView(agent: AgentRecord, inFlightCalls: number): AgentView {
    this.rollSpendWindow(agent);
    return {
      agentId: agent.agentId,
      label: agent.label,
      publicKey: agent.publicKey,
      status: agent.status,
      revokedAt: agent.revokedAt,
      inFlightCalls,
      allowedCalls: agent.scopeIds.map(labelFor),
      scopeIds: [...agent.scopeIds],
      spendAndLimit: this.spendAndLimit(agent),
      revocation: {
        stops: REVOKE_STOPS,
        continues: REVOKE_CONTINUES,
      },
    };
  }

  private spendAndLimit(agent: AgentRecord): SpendAndLimitView {
    if (agent.amountCents === null || !agent.period) {
      return {
        spentPlain: 'Nothing spent yet',
        limitPlain: 'No spending limit yet',
        together: 'No spending limit yet, so spend has nothing to sit beside.',
      };
    }
    const spentPlain = `${formatUsdcFromCents(agent.spentCents)} ${spentWindow(agent.period)}`;
    const limitPlain = `${formatUsdcFromCents(agent.amountCents)} every ${periodNoun(agent.period)}`;
    return {
      spentPlain,
      limitPlain,
      together: `${formatUsdcFromCents(agent.spentCents)} spent toward a ${formatUsdcFromCents(agent.amountCents)} limit every ${periodNoun(agent.period)}.`,
    };
  }

  private previousPlain(agent: AgentRecord): string {
    if (agent.amountCents === null || !agent.period || agent.scopeIds.length === 0) {
      return 'No spending authority';
    }
    return authorityPlain(agent.scopeIds, agent.amountCents, agent.period);
  }

  private buildStatement(publicKey: string, before: string, next: { scopeIds: string[]; amountCents: number; period: SpendPeriod }): string {
    return [
      'SYNCRO agent spending authority',
      `Agent: ${publicKey}`,
      `Allowed calls: ${next.scopeIds.map(labelFor).join(', ')}`,
      `Limit: ${formatUsdcFromCents(next.amountCents)} every ${periodNoun(next.period)}`,
      `Previously: ${before}`,
    ].join('\n');
  }

  private authorityIncreases(agent: AgentRecord, next: { scopeIds: string[]; amountCents: number; period: SpendPeriod }): boolean {
    if (agent.amountCents === null || !agent.period || agent.scopeIds.length === 0) return true;
    if (next.scopeIds.some((scopeId) => !agent.scopeIds.includes(scopeId))) return true;
    return dailyRate(next.amountCents, next.period) > dailyRate(agent.amountCents, agent.period) + 1e-9;
  }

  private normalizeAuthority(input: AuthorityInput): { scopeIds: string[]; amountCents: number; period: SpendPeriod } {
    const scopeIds = [...new Set(input.scopeIds)];
    if (scopeIds.length === 0 || scopeIds.some((scopeId) => !CALL_TYPE_IDS.has(scopeId))) {
      throw new AgentConsoleError(400, 'invalid_calls', 'Choose at least one kind of call this agent may make.');
    }
    if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 1_000_000) {
      throw new AgentConsoleError(400, 'invalid_amount', 'Enter an amount greater than zero.');
    }
    const amountCents = Math.round(input.amount * 100);
    if (Math.abs(input.amount * 100 - amountCents) > 1e-6) {
      throw new AgentConsoleError(400, 'invalid_amount', 'Use at most two decimal places.');
    }
    if (input.period !== 'day' && input.period !== 'week' && input.period !== 'month') {
      throw new AgentConsoleError(400, 'invalid_period', 'Choose how often the limit resets: every day, every week, or every month.');
    }
    return { scopeIds, amountCents, period: input.period };
  }

  private assertCanChangeAuthority(agent: AgentRecord): void {
    if (agent.status === 'revoked') {
      throw new AgentConsoleError(
        409,
        'agent_revoked',
        'This agent is revoked. Register a new key before granting spending authority again.',
      );
    }
  }

  private requireOwned(principalPublicKey: string, agentId: string): AgentRecord {
    const agent = this.agents.get(agentId);
    if (!agent || agent.principalPublicKey !== principalPublicKey) {
      throw new AgentConsoleError(404, 'agent_not_found', 'Agent not found.');
    }
    return agent;
  }

  private findByPresentedId(presentedId: string): AgentRecord | null {
    for (const agent of this.agents.values()) {
      if (agent.publicKey === presentedId || agent.agentId === presentedId) return agent;
    }
    return null;
  }

  private rollSpendWindow(agent: AgentRecord): void {
    if (!agent.period || agent.periodStartedAt === null) return;
    const windowStart = currentPeriodStart(agent.period, this.now());
    if (agent.periodStartedAt < windowStart) {
      agent.spentCents = 0;
      agent.periodStartedAt = windowStart;
    }
  }

  private writeSpendCap(agent: AgentRecord): void {
    if (agent.amountCents === null || !agent.period) return;
    const amount = agent.amountCents / 100;
    spendCapService.setCap({
      cardId: agent.publicKey,
      agentId: agent.publicKey,
      onChainCap: amount,
      consumedLocal: agent.spentCents / 100,
      lastSettledOnChainCap: amount,
      dailyLimit: agent.period === 'day' ? amount : 0,
      monthlyLimit: agent.period === 'month' ? amount : 0,
      status: 'active',
      expiresAt: 0,
    });
  }

  private issueChallenge(purpose: ChallengeRecord['purpose'], publicKey: string): { challengeId: string; message: string; expiresAt: string } {
    const challengeId = randomUUID();
    const nonce = randomBytes(16).toString('hex');
    const message = purpose === 'session'
      ? `SYNCRO principal sign-in\nPublic key: ${publicKey}\nChallenge: ${nonce}`
      : `SYNCRO confirm it is you\nPublic key: ${publicKey}\nChallenge: ${nonce}\nThis confirmation can be used once.`;
    const expiresAt = this.now() + REAUTH_TTL_MS;
    this.challenges.set(challengeId, {
      id: challengeId,
      purpose,
      publicKey,
      message,
      expiresAt,
      used: false,
    });
    return { challengeId, message, expiresAt: new Date(expiresAt).toISOString() };
  }

  private consumeChallenge(purpose: ChallengeRecord['purpose'], challengeId: string, publicKey: string): ChallengeRecord {
    const challenge = this.challenges.get(challengeId);
    if (!challenge || challenge.purpose !== purpose || challenge.publicKey !== publicKey) {
      throw new AgentConsoleError(400, 'challenge_invalid', 'This confirmation is not valid. Start again.');
    }
    if (challenge.used || challenge.expiresAt <= this.now()) {
      throw new AgentConsoleError(400, 'challenge_expired', 'This confirmation expired. Start again.');
    }
    challenge.used = true;
    return challenge;
  }

  private consumeReauth(principalPublicKey: string, token: string | null | undefined, statement: string): void {
    if (!token) {
      throw new AgentConsoleError(
        403,
        'reauthentication_required',
        'Confirm it is you before granting or raising spending authority.',
      );
    }
    const claims = this.readToken(token);
    if (!claims || claims.typ !== 'reauth' || claims.sub !== principalPublicKey) {
      throw new AgentConsoleError(
        403,
        'reauthentication_required',
        'Confirm it is you before granting or raising spending authority.',
      );
    }
    if (typeof claims.exp !== 'number' || claims.exp <= this.now()) {
      throw new AgentConsoleError(403, 'reauthentication_expired', 'That confirmation expired. Confirm it is you again.');
    }
    if (claims.statementHash !== hashStatement(statement)) {
      throw new AgentConsoleError(
        403,
        'reauthentication_mismatch',
        'That confirmation was for a different change. Review this change and confirm it is you again.',
      );
    }
    if (typeof claims.jti !== 'string' || this.usedReauth.has(claims.jti)) {
      throw new AgentConsoleError(403, 'reauthentication_used', 'That confirmation was already used. Confirm it is you again.');
    }
    this.usedReauth.add(claims.jti);
  }

  private signToken(claims: SessionClaims | ReauthClaims): string {
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = createHmac('sha256', tokenSecret()).update(body).digest('base64url');
    return `${body}.${signature}`;
  }

  private readToken(token: string): (SessionClaims | ReauthClaims) | null {
    const [body, signature] = token.split('.');
    if (!body || !signature) return null;
    const expected = createHmac('sha256', tokenSecret()).update(body).digest('base64url');
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
    try {
      return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionClaims | ReauthClaims;
    } catch {
      return null;
    }
  }
}

function hashStatement(statement: string): string {
  return createHash('sha256').update(statement, 'utf8').digest('hex');
}

function normalizeLabel(label: string | null | undefined): string | null {
  if (label === undefined || label === null) return null;
  const trimmed = label.trim();
  if (!trimmed) return null;
  if (trimmed.length > 40) {
    throw new AgentConsoleError(400, 'invalid_label', 'Use a name of 40 characters or fewer.');
  }
  return trimmed;
}

export const agentConsoleService = new AgentConsoleService();
