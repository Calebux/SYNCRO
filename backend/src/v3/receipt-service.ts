import { createHash, createPrivateKey, generateKeyPairSync, sign as edSign } from 'node:crypto';
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
  privateKeyPem: string;
  publicKeyPem: string;
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

function loadKeyMaterial(): KeyMaterial {
  const envPrivate = process.env.SYNCRO_RECEIPT_PRIVATE_KEY_PEM;
  const envPublic = process.env.SYNCRO_RECEIPT_PUBLIC_KEY_PEM;
  if (envPrivate && envPublic) {
    return { privateKeyPem: envPrivate, publicKeyPem: envPublic };
  }

  const pair = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

export class ReceiptService {
  private readonly keys = loadKeyMaterial();
  private readonly receipts = new Map<string, PaidReceipt>();

  issueReceipt(input: ReceiptIssueInput): PaidReceipt {
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
    this.receipts.set(receipt.receiptId, receipt);
    return receipt;
  }

  getReceipt(receiptId: string): PaidReceipt | null {
    return this.receipts.get(receiptId) ?? null;
  }

  encodeHeaderValue(receipt: PaidReceipt): string {
    return Buffer.from(JSON.stringify(receipt)).toString('base64url');
  }

  headerFitsInline(receipt: PaidReceipt, maxBytes = 1024): boolean {
    return this.encodeHeaderValue(receipt).length <= maxBytes;
  }
}

export { payloadMessage };

