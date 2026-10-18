import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as edSign, verify as edVerify } from 'node:crypto';
import { PaidReceipt, PaidReceiptPayload } from './types';

export interface ReceiptIssueInput {
  receiptId: string;
  route: string;
  unit: string;
  quantity: number;
  amount: number;
  rateCardVersion: string;
  exchangeRate: number | null;
  channelId: string;
  stateNonce: number;
  requestMethod: string;
  requestPath: string;
  requestQuery: Record<string, unknown>;
}

interface KeyMaterial {
  keyId: string;
  privateKeyPem: string;
  publicKeyPem: string;
}

export interface ReceiptPublicKeyEntry {
  keyId: string;
  status: 'current' | 'previous';
  publicKeyPem: string;
}

export type ReceiptVerifyReason = 'ok' | 'unknown_key' | 'revoked_key' | 'bad_signature';

/**
 * Persistence contract for receipts. Implementations must durably store the
 * signed payload, hashes, and channel state reference so receipts survive
 * restarts and are readable from any instance.
 */
export interface ReceiptStore {
  save(receipt: PaidReceipt): Promise<void>;
  get(receiptId: string): Promise<PaidReceipt | null>;
}

/**
 * Minimal Postgres client surface used by the receipt store. Kept structural so
 * any pg-compatible pool/query function can be injected without a hard dep.
 */
export interface ReceiptPgClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

const RECEIPT_TABLE = 'v3_receipts';

/**
 * Postgres-backed receipt store. Persists the full signed receipt (payload +
 * signature) plus denormalized columns for indexing by receipt id, agent,
 * provider, and channel. Write failures reject so the paid call fails rather
 * than returning an unrecorded receipt.
 */
export class PostgresReceiptStore implements ReceiptStore {
  constructor(private readonly client: ReceiptPgClient) {}

  async save(receipt: PaidReceipt): Promise<void> {
    await this.client.query(
      `INSERT INTO ${RECEIPT_TABLE}
         (receipt_id, agent_id, provider_id, channel_id, state_nonce,
          request_hash, route, unit, quantity, amount, rate_card_version,
          exchange_rate, key_id, signer_public_key, signature, payload, issued_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (receipt_id) DO NOTHING`,
      [
        receipt.receiptId,
        (receipt as { agentId?: string }).agentId ?? null,
        (receipt as { providerId?: string }).providerId ?? null,
        receipt.channelId,
        receipt.stateNonce,
        receipt.requestHash,
        receipt.route,
        receipt.unit,
        receipt.quantity,
        receipt.amount,
        receipt.rateCardVersion,
        receipt.exchangeRate,
        receipt.keyId,
        receipt.signerPublicKey,
        receipt.signature,
        JSON.stringify(receipt),
        receipt.timestamp,
      ],
    );
  }

  async get(receiptId: string): Promise<PaidReceipt | null> {
    const result = await this.client.query(
      `SELECT payload FROM ${RECEIPT_TABLE} WHERE receipt_id = $1 LIMIT 1`,
      [receiptId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    const payload = row.payload;
    if (typeof payload === 'string') {
      return JSON.parse(payload) as PaidReceipt;
    }
    return (payload as PaidReceipt) ?? null;
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const sortedEntries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${sortedEntries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(',')}}`;
}

function requestHash(method: string, path: string, query: Record<string, unknown>): string {
  const canonical = stableStringify({
    method: method.toUpperCase(),
    path,
    query,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function payloadMessage(payload: PaidReceiptPayload): string {
  return stableStringify(payload);
}

function revokedKeyIds(): Set<string> {
  const raw = process.env.SYNCRO_RECEIPT_REVOKED_KEY_IDS ?? '';
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

function loadKeyMaterial(): KeyMaterial {
  const keyId = process.env.SYNCRO_RECEIPT_KEY_ID?.trim() || 'primary-1';
  const envPrivate = process.env.SYNCRO_RECEIPT_PRIVATE_KEY_PEM;
  const envPublic = process.env.SYNCRO_RECEIPT_PUBLIC_KEY_PEM;
  if (envPrivate && envPublic) {
    return { keyId, privateKeyPem: envPrivate, publicKeyPem: envPublic };
  }

  const pair = generateKeyPairSync('ed25519');
  return {
    keyId,
    privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

export class ReceiptService {
  private readonly keys = loadKeyMaterial();

  constructor(private readonly store: ReceiptStore) {}

  async issueReceipt(input: ReceiptIssueInput): Promise<PaidReceipt> {
    const payload: PaidReceiptPayload = {
      receiptId: input.receiptId,
      requestHash: requestHash(input.requestMethod, input.requestPath, input.requestQuery),
      route: input.route,
      unit: input.unit,
      quantity: input.quantity,
      amount: input.amount,
      rateCardVersion: input.rateCardVersion,
      exchangeRate: input.exchangeRate,
      channelId: input.channelId,
      stateNonce: input.stateNonce,
      timestamp: new Date().toISOString(),
      signerPublicKey: this.keys.publicKeyPem,
      keyId: this.keys.keyId,
    };

    const message = payloadMessage(payload);
    const signature = edSign(
      null,
      Buffer.from(message),
      createPrivateKey(this.keys.privateKeyPem),
    ).toString('base64');

    const receipt: PaidReceipt = {
      ...payload,
      signature,
    };
    // Persist before returning: a write failure must fail the paid call rather
    // than hand back a receipt that cannot be recovered after a restart.
    await this.store.save(receipt);
    return receipt;
  }

  /** Current + previous public keys for the well-known endpoint. Previous stays valid during the dispute window. */
  getReceiptPublicKeys(): ReceiptPublicKeyEntry[] {
    const entries: ReceiptPublicKeyEntry[] = [
      { keyId: this.keys.keyId, status: 'current', publicKeyPem: this.keys.publicKeyPem },
    ];
    const prevPem = process.env.SYNCRO_RECEIPT_PREVIOUS_PUBLIC_KEY_PEM;
    const prevId = process.env.SYNCRO_RECEIPT_PREVIOUS_KEY_ID?.trim();
    if (prevPem && prevId && prevId !== this.keys.keyId && !revokedKeyIds().has(prevId)) {
      entries.push({ keyId: prevId, status: 'previous', publicKeyPem: prevPem });
    }
    return entries;
  }

  /** Resolve the signing key by receipt key id; revoked keys fail with a specific reason. */
  verifyReceipt(receipt: PaidReceipt): { ok: boolean; reason: ReceiptVerifyReason } {
    const keyId = (receipt as { keyId?: string }).keyId ?? this.keys.keyId;
    if (revokedKeyIds().has(keyId)) {
      return { ok: false, reason: 'revoked_key' };
    }
    const candidates = new Map<string, string>();
    for (const entry of this.getReceiptPublicKeys()) {
      candidates.set(entry.keyId, entry.publicKeyPem);
    }
    // Self-contained receipts carry their own PEM; trust it only when the key id is known and not revoked.
    if (!candidates.has(keyId)) {
      if (keyId === this.keys.keyId || (receipt.signerPublicKey && keyId && receipt.signerPublicKey === this.keys.publicKeyPem)) {
        candidates.set(keyId, receipt.signerPublicKey);
      } else {
        return { ok: false, reason: 'unknown_key' };
      }
    }
    const publicPem = candidates.get(keyId)!;
    const payload: PaidReceiptPayload = {
      receiptId: receipt.receiptId,
      requestHash: receipt.requestHash,
      route: receipt.route,
      unit: receipt.unit,
      quantity: receipt.quantity,
      amount: receipt.amount,
      rateCardVersion: receipt.rateCardVersion,
      exchangeRate: receipt.exchangeRate,
      channelId: receipt.channelId,
      stateNonce: receipt.stateNonce,
      timestamp: receipt.timestamp,
      signerPublicKey: receipt.signerPublicKey,
      keyId,
    };
    try {
      const ok = edVerify(
        null,
        Buffer.from(payloadMessage(payload)),
        createPublicKey(publicPem),
        Buffer.from(receipt.signature, 'base64'),
      );
      return ok ? { ok: true, reason: 'ok' } : { ok: false, reason: 'bad_signature' };
    } catch {
      return { ok: false, reason: 'bad_signature' };
    }
  }

  async getReceipt(receiptId: string): Promise<PaidReceipt | null> {
    return this.store.get(receiptId);
  }

  encodeHeaderValue(receipt: PaidReceipt): string {
    return Buffer.from(JSON.stringify(receipt)).toString('base64url');
  }

  headerFitsInline(receipt: PaidReceipt, maxBytes = 1024): boolean {
    return this.encodeHeaderValue(receipt).length <= maxBytes;
  }
}

export { payloadMessage };
