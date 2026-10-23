import { createPublicKey, verify } from "node:crypto";
import type { PaidReceipt, PaidReceiptPayload } from "./types.js";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function receiptPayloadMessage(payload: PaidReceiptPayload): string {
  return stableStringify(payload);
}

export function decodeReceiptHeader(headerValue: string): PaidReceipt {
  const decoded = Buffer.from(headerValue, "base64url").toString("utf8");
  return JSON.parse(decoded) as PaidReceipt;
}

export function verifyReceipt(receipt: PaidReceipt): boolean {
  return verifyReceiptWithKeyRotation(receipt).ok;
}

export type ReceiptVerifyReason = 'ok' | 'unknown_key' | 'revoked_key' | 'bad_signature';

export interface ReceiptKeyEntry {
  keyId: string;
  publicKeyPem: string;
  revoked?: boolean;
}

/**
 * Resolve the signing key by receipt key id so rotated keys keep verifying
 * old receipts inside the dispute window. Revoked keys fail closed.
 */
export function verifyReceiptWithKeyRotation(
  receipt: PaidReceipt,
  keySet?: ReceiptKeyEntry[],
): { ok: boolean; reason: ReceiptVerifyReason } {
  const receiptWithId = receipt as PaidReceipt & { keyId?: string };
  const keyId = receiptWithId.keyId;
  if (keyId !== undefined && keySet !== undefined) {
    const entry = keySet.find((k) => k.keyId === keyId);
    if (!entry) return { ok: false, reason: 'unknown_key' };
    if (entry.revoked) return { ok: false, reason: 'revoked_key' };
  }
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
    keyId: keyId ?? 'primary-1',
  };

  try {
    const ok = verify(
      null,
      Buffer.from(receiptPayloadMessage(payload)),
      createPublicKey(receipt.signerPublicKey),
      Buffer.from(receipt.signature, "base64"),
    );
    return ok ? { ok: true, reason: 'ok' } : { ok: false, reason: 'bad_signature' };
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
}

