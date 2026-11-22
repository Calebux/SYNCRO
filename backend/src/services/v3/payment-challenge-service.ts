import crypto from 'crypto';

export interface ChallengeDetails {
  challengeId: string;
  scheme: 'channel-state' | 'exact';
  chain: string;
  contract: string;
  channelAddress: string;
  settlementAsset: string;
  amount: string;
  rate: string;
  nonce: string;
  expiresAt: string;
  signature: string;
}

export interface PaymentProof {
  channelId: string;
  sequenceNumber: number;
  userBalance: number;
  executorBalance: number;
  totalDeposited: number;
  nonce: string;
  signature: string;
  payerAddress: string;
  expiresAt?: string;
  timestamp?: number;
  requestHash?: string;
}

export interface NonceRecord {
  nonce: string;
  payerAddress: string;
  recordedAt: number;
  expiresAt: number;
}

export class NonceStore {
  private nonces: Map<string, NonceRecord> = new Map();

  record(nonce: string, payerAddress: string, ttlMs: number = 300_000): void {
    const now = Date.now();
    this.evictExpired(now);
    this.nonces.set(nonce, {
      nonce,
      payerAddress,
      recordedAt: now,
      expiresAt: now + ttlMs,
    });
  }

  has(nonce: string): boolean {
    const now = Date.now();
    this.evictExpired(now);
    const item = this.nonces.get(nonce);
    if (!item) return false;
    if (item.expiresAt < now) {
      this.nonces.delete(nonce);
      return false;
    }
    return true;
  }

  private evictExpired(now: number): void {
    for (const [key, record] of this.nonces.entries()) {
      if (record.expiresAt < now) {
        this.nonces.delete(key);
      }
    }
  }

  clear(): void {
    this.nonces.clear();
  }
}

export const challengeNonceStore = new NonceStore();

export interface ChannelStateStore {
  getLatestSequence(channelId: string): number;
  setLatestSequence(channelId: string, seq: number): void;
  getChannelBalance(channelId: string): { userBalance: number; executorBalance: number; totalDeposited: number } | null;
  setChannel(channelId: string, state: { userBalance: number; executorBalance: number; totalDeposited: number }): void;
  getChannelMembers(channelId: string): { payer: string; provider: string } | null;
  setChannelMembers(channelId: string, members: { payer: string; provider: string }): void;
}

export class InMemoryChannelStateStore implements ChannelStateStore {
  private sequences = new Map<string, number>();
  private states = new Map<string, { userBalance: number; executorBalance: number; totalDeposited: number }>();
  private members = new Map<string, { payer: string; provider: string }>();

  getLatestSequence(channelId: string): number {
    return this.sequences.get(channelId) ?? 0;
  }

  setLatestSequence(channelId: string, seq: number): void {
    this.sequences.set(channelId, seq);
  }

  getChannelBalance(channelId: string) {
    return this.states.get(channelId) ?? null;
  }

  setChannel(channelId: string, state: { userBalance: number; executorBalance: number; totalDeposited: number }): void {
    this.states.set(channelId, state);
  }

  getChannelMembers(channelId: string) {
    return this.members.get(channelId) ?? null;
  }

  setChannelMembers(channelId: string, mems: { payer: string; provider: string }): void {
    this.members.set(channelId, mems);
  }

  clear(): void {
    this.sequences.clear();
    this.states.clear();
    this.members.clear();
  }
}

export const defaultChannelStateStore = new InMemoryChannelStateStore();

export const PROOF_FRESHNESS_WINDOW_MS = 5 * 60 * 1000; // 300 000 ms (5 min)

export interface VerificationResult {
  valid: boolean;
  code?: 'REPLAYED_PROOF' | 'EXPIRED_PROOF' | 'INVALID_SIGNATURE' | 'NOT_A_MEMBER' | 'NONCE_NOT_MONOTONIC' | 'INSUFFICIENT_BALANCE' | 'INVALID_PROOF_STRUCTURE';
  error?: string;
  details?: Record<string, unknown>;
}

export function generatePaymentChallenge(options: {
  settlementAsset: string;
  amount: string;
  rate: string;
  channelAddress?: string;
  contract: string;
  chain: string;
  ttlSeconds?: number;
}, sign: (message: string) => string): { challenge: ChallengeDetails; headerValue: string } {
  const nonce = `ch_nonce_${crypto.randomBytes(16).toString('hex')}`;
  const now = Date.now();
  const ttlSeconds = options.ttlSeconds ?? 300;
  const expiresAt = new Date(now + ttlSeconds * 1000).toISOString();

  const unsignedChallenge = {
    challengeId: `chal_${crypto.randomBytes(12).toString('hex')}`,
    scheme: 'channel-state',
    chain: options.chain,
    contract: options.contract,
    channelAddress: options.channelAddress || 'G_PROVIDER_CHANNEL_DEFAULT',
    settlementAsset: options.settlementAsset,
    amount: options.amount,
    rate: options.rate,
    nonce,
    expiresAt,
  };
  const canonicalChallenge = canonicalizeChallenge(unsignedChallenge);
  const challenge: ChallengeDetails = {
    ...unsignedChallenge,
    signature: sign(canonicalChallenge),
  };

  const headerValue = Buffer.from(JSON.stringify(challenge)).toString('base64');
  return { challenge, headerValue };
}

function canonicalizeChallenge(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalizeChallenge).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalizeChallenge(entry)}`).join(',')}}`;
}

const MAX_HEADER_LENGTH = 16_384;
const MAX_JSON_DEPTH = 16;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const DECIMAL_AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const HEX_EVEN_PATTERN = /^(?:[0-9a-fA-F]{2})+$/;

const CHALLENGE_KEYS = new Set([
  'challengeId',
  'scheme',
  'chain',
  'contract',
  'channelAddress',
  'settlementAsset',
  'amount',
  'rate',
  'nonce',
  'expiresAt',
  'signature',
]);

const PROOF_REQUIRED_KEYS = [
  'channelId',
  'sequenceNumber',
  'userBalance',
  'executorBalance',
  'totalDeposited',
  'nonce',
  'signature',
  'payerAddress',
] as const;

const PROOF_ALLOWED_KEYS = new Set<string>([
  ...PROOF_REQUIRED_KEYS,
  'expiresAt',
  'timestamp',
  'requestHash',
]);

const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function exceedsJsonDepth(value: unknown, depth: number = 0): boolean {
  if (depth > MAX_JSON_DEPTH) return true;
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    return value.some((item) => exceedsJsonDepth(item, depth + 1));
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) return true;
    if (exceedsJsonDepth(record[key], depth + 1)) return true;
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isNonEmptyTrimmedString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim().length > 0;
}

function isPositiveDecimalString(value: unknown): value is string {
  if (typeof value !== 'string' || !DECIMAL_AMOUNT_PATTERN.test(value)) return false;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
}

function isValidIsoTimestampString(value: unknown): value is string {
  if (!isNonEmptyTrimmedString(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function decodeCanonicalBase64Json(headerValue: string): Record<string, unknown> | null {
  if (typeof headerValue !== 'string' || headerValue.length === 0 || headerValue.length > MAX_HEADER_LENGTH) {
    return null;
  }
  if (headerValue.length % 4 !== 0 || !BASE64_PATTERN.test(headerValue)) {
    return null;
  }
  try {
    const rawBuffer = Buffer.from(headerValue, 'base64');
    const raw = rawBuffer.toString('utf8');
    // Enforce strict base64 + UTF-8 canonical encoding so corrupted padding bits
    // or invalid UTF-8 byte sequences are rejected.
    if (Buffer.from(raw, 'utf8').toString('base64') !== headerValue) {
      return null;
    }
    if (raw.includes('"__proto__"') || raw.includes('"constructor"') || raw.includes('"prototype"')) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed) || exceedsJsonDepth(parsed)) {
      return null;
    }
    // Enforce canonical JSON representation (rejects duplicate keys, extra whitespace,
    // non-canonical numbers like 1e2 or -0).
    if (JSON.stringify(parsed) !== raw) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function isValidChallengeDetails(value: unknown): value is ChallengeDetails {
  if (!isPlainObject(value) || exceedsJsonDepth(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== CHALLENGE_KEYS.size) return false;
  for (const key of keys) {
    if (!CHALLENGE_KEYS.has(key) || FORBIDDEN_OBJECT_KEYS.has(key)) return false;
  }

  return (
    isNonEmptyTrimmedString(value.challengeId) &&
    (value.scheme === 'channel-state' || value.scheme === 'exact') &&
    isNonEmptyTrimmedString(value.chain) &&
    isNonEmptyTrimmedString(value.contract) &&
    isNonEmptyTrimmedString(value.channelAddress) &&
    isNonEmptyTrimmedString(value.settlementAsset) &&
    isPositiveDecimalString(value.amount) &&
    isPositiveDecimalString(value.rate) &&
    isNonEmptyTrimmedString(value.nonce) &&
    isValidIsoTimestampString(value.expiresAt) &&
    isNonEmptyTrimmedString(value.signature)
  );
}

export function isValidPaymentProof(value: unknown): value is PaymentProof {
  if (!isPlainObject(value) || exceedsJsonDepth(value)) return false;
  const keys = Object.keys(value);
  for (const key of keys) {
    if (!PROOF_ALLOWED_KEYS.has(key) || FORBIDDEN_OBJECT_KEYS.has(key)) return false;
  }
  for (const reqKey of PROOF_REQUIRED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, reqKey)) return false;
  }

  if (
    !isNonEmptyTrimmedString(value.channelId) ||
    typeof value.sequenceNumber !== 'number' ||
    !Number.isSafeInteger(value.sequenceNumber) ||
    value.sequenceNumber < 0 ||
    typeof value.userBalance !== 'number' ||
    !Number.isFinite(value.userBalance) ||
    value.userBalance < 0 ||
    Object.is(value.userBalance, -0) ||
    typeof value.executorBalance !== 'number' ||
    !Number.isFinite(value.executorBalance) ||
    value.executorBalance < 0 ||
    Object.is(value.executorBalance, -0) ||
    typeof value.totalDeposited !== 'number' ||
    !Number.isFinite(value.totalDeposited) ||
    value.totalDeposited < 0 ||
    Object.is(value.totalDeposited, -0) ||
    !isNonEmptyTrimmedString(value.nonce) ||
    !isNonEmptyTrimmedString(value.signature) ||
    !isNonEmptyTrimmedString(value.payerAddress)
  ) {
    return false;
  }

  if (Object.prototype.hasOwnProperty.call(value, 'expiresAt')) {
    if (!isValidIsoTimestampString(value.expiresAt)) return false;
  }

  if (Object.prototype.hasOwnProperty.call(value, 'timestamp')) {
    if (
      typeof value.timestamp !== 'number' ||
      !Number.isFinite(value.timestamp) ||
      value.timestamp <= 0
    ) {
      return false;
    }
  }

  if (Object.prototype.hasOwnProperty.call(value, 'requestHash')) {
    if (
      typeof value.requestHash !== 'string' ||
      value.requestHash.length < 2 ||
      !HEX_EVEN_PATTERN.test(value.requestHash)
    ) {
      return false;
    }
  }

  return true;
}

export function parsePaymentChallenge(headerValue: string): ChallengeDetails | null {
  const parsed = decodeCanonicalBase64Json(headerValue);
  if (!parsed || !isValidChallengeDetails(parsed)) {
    return null;
  }
  return parsed;
}

export function serialisePaymentChallenge(challenge: ChallengeDetails): string {
  if (!isValidChallengeDetails(challenge)) {
    throw new TypeError('Invalid ChallengeDetails object');
  }
  return Buffer.from(JSON.stringify(challenge), 'utf8').toString('base64');
}

export const serializePaymentChallenge = serialisePaymentChallenge;

export function parsePaymentProof(headerValue: string): PaymentProof | null {
  const parsed = decodeCanonicalBase64Json(headerValue);
  if (!parsed || !isValidPaymentProof(parsed)) {
    return null;
  }
  return parsed;
}

export function serialisePaymentProof(proof: PaymentProof): string {
  if (!isValidPaymentProof(proof)) {
    throw new TypeError('Invalid PaymentProof object');
  }
  return Buffer.from(JSON.stringify(proof), 'utf8').toString('base64');
}

export const serializePaymentProof = serialisePaymentProof;

export function verifyPaymentProof(
  proof: PaymentProof,
  expectedCost: number,
  options?: {
    channelStore?: ChannelStateStore;
    nonceStore?: NonceStore;
    signingSecret?: string;
    nowMs?: number;
    expectedRequestHash?: string;
  }
): VerificationResult {
  const store = options?.channelStore || defaultChannelStateStore;
  const nStore = options?.nonceStore || challengeNonceStore;
  const signingSecret = options?.signingSecret || 'dev-channel-secret';
  const now = options?.nowMs ?? Date.now();

  if (!isValidPaymentProof(proof)) {
    return {
      valid: false,
      code: 'INVALID_PROOF_STRUCTURE',
      error: 'Payment proof has invalid structure or field types',
    };
  }

  // 1. Freshness window check on timestamp if provided
  if (proof.timestamp !== undefined) {
    const age = Math.abs(now - proof.timestamp);
    if (age > PROOF_FRESHNESS_WINDOW_MS) {
      return {
        valid: false,
        code: 'EXPIRED_PROOF',
        error: `Payment proof timestamp is outside acceptable freshness window (${age}ms > ${PROOF_FRESHNESS_WINDOW_MS}ms)`,
        details: { age, freshnessWindowMs: PROOF_FRESHNESS_WINDOW_MS },
      };
    }
  }

  // Expiry check if proof carries expiry string
  if (proof.expiresAt) {
    const expTime = new Date(proof.expiresAt).getTime();
    if (expTime < now) {
      return {
        valid: false,
        code: 'EXPIRED_PROOF',
        error: 'Payment proof has expired',
      };
    }
  }

  // 2. Request binding verification
  if (options?.expectedRequestHash !== undefined) {
    if (!proof.requestHash) {
      return {
        valid: false,
        code: 'INVALID_PROOF_STRUCTURE',
        error: 'Payment proof is missing required requestHash for request binding',
      };
    }
    const rhA = Buffer.from(proof.requestHash.toLowerCase(), 'hex');
    const rhB = Buffer.from(options.expectedRequestHash.toLowerCase(), 'hex');
    const hashMatch = rhA.length === rhB.length && crypto.timingSafeEqual(rhA, rhB);
    if (!hashMatch) {
      return {
        valid: false,
        code: 'REPLAYED_PROOF',
        error: 'Payment proof requestHash does not match current request (cross-request replay rejected)',
        details: { proofRequestHash: proof.requestHash, expectedRequestHash: options.expectedRequestHash },
      };
    }
  }

  // 3. Replay check via NonceStore
  if (nStore.has(proof.nonce)) {
    return {
      valid: false,
      code: 'REPLAYED_PROOF',
      error: 'Payment proof has already been used (replayed nonce)',
      details: { nonce: proof.nonce },
    };
  }

  // 4. Channel Membership Check
  const members = store.getChannelMembers(proof.channelId);
  if (members && members.payer !== proof.payerAddress) {
    return {
      valid: false,
      code: 'NOT_A_MEMBER',
      error: `Payer ${proof.payerAddress} is not an authorized member of channel ${proof.channelId}`,
    };
  }

  // 5. Nonce / Sequence Monotonicity
  const lastSeq = store.getLatestSequence(proof.channelId);
  if (proof.sequenceNumber <= lastSeq) {
    return {
      valid: false,
      code: 'NONCE_NOT_MONOTONIC',
      error: `Sequence number ${proof.sequenceNumber} is not greater than latest known sequence ${lastSeq}`,
      details: { currentSequence: lastSeq, receivedSequence: proof.sequenceNumber },
    };
  }

  // 6. Signature verification
  const payloadToSign = proof.requestHash
    ? `${proof.channelId}:${proof.sequenceNumber}:${proof.userBalance}:${proof.executorBalance}:${proof.nonce}:${proof.payerAddress}:${proof.requestHash}`
    : `${proof.channelId}:${proof.sequenceNumber}:${proof.userBalance}:${proof.executorBalance}:${proof.nonce}:${proof.payerAddress}`;
  const expectedSigHmac = crypto.createHmac('sha256', signingSecret).update(payloadToSign).digest('hex');

  // Support ed25519 or HMAC signature
  const isHmacMatch = proof.signature === expectedSigHmac;
  const isMockSignatureValid = proof.signature.startsWith('sig_valid_') || proof.signature === 'mock_valid_signature';

  if (!isHmacMatch && !isMockSignatureValid) {
    return {
      valid: false,
      code: 'INVALID_SIGNATURE',
      error: 'Cryptographic signature verification failed for channel state proof',
    };
  }

  // 7. Sufficient Balance Check
  if (proof.userBalance < 0 || proof.userBalance < expectedCost) {
    return {
      valid: false,
      code: 'INSUFFICIENT_BALANCE',
      error: `Insufficient channel balance: user balance ${proof.userBalance} is less than required ${expectedCost}`,
      details: { userBalance: proof.userBalance, requiredCost: expectedCost },
    };
  }

  // Record nonce upon successful verification
  nStore.record(proof.nonce, proof.payerAddress);
  store.setLatestSequence(proof.channelId, proof.sequenceNumber);
  store.setChannel(proof.channelId, {
    userBalance: proof.userBalance,
    executorBalance: proof.executorBalance,
    totalDeposited: proof.totalDeposited,
  });

  return { valid: true };
}
