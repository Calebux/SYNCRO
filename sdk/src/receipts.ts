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
  };

  return verify(
    null,
    Buffer.from(receiptPayloadMessage(payload)),
    createPublicKey(receipt.signerPublicKey),
    Buffer.from(receipt.signature, "base64"),
  );
}

