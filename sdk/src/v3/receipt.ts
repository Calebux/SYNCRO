import { sign as signDetached, verify as verifySignature } from "node:crypto";

export type ReceiptUnit = "second" | "minute" | "hour" | "request";

export interface IndependentReceipt {
  providerId: string;
  channelId: string;
  nonce: string;
  unit: ReceiptUnit;
  quantity: number;
  exchangeRate: number;
  amountMinor: number;
  currency: string;
  rateCard: Record<ReceiptUnit, number>;
  issuedAt: string;
  signature: string;
}

export type ReceiptCheckName =
  | "signature"
  | "amount"
  | "channel"
  | "nonce"
  | "receipt-shape";

export interface ReceiptFailure {
  check: ReceiptCheckName;
  code:
    | "INVALID_SIGNATURE"
    | "AMOUNT_MISMATCH"
    | "CHANNEL_MISMATCH"
    | "NONCE_MISMATCH"
    | "MALFORMED_RECEIPT";
  message: string;
  expected?: string | number;
  actual?: string | number;
}

export interface VerifyReceiptInput {
  receipt: IndependentReceipt;
  providerPublicKeyPem: string;
  expectedChannelId: string;
  expectedNonce: string;
}

export interface VerifyReceiptResult {
  ok: boolean;
  derivedAmountMinor?: number;
  failures: ReceiptFailure[];
}

function canonicalizeReceiptForSigning(receipt: IndependentReceipt): string {
  const payload = {
    providerId: receipt.providerId,
    channelId: receipt.channelId,
    nonce: receipt.nonce,
    unit: receipt.unit,
    quantity: receipt.quantity,
    exchangeRate: receipt.exchangeRate,
    amountMinor: receipt.amountMinor,
    currency: receipt.currency,
    issuedAt: receipt.issuedAt,
    rateCard: Object.keys(receipt.rateCard)
      .sort()
      .reduce<Record<string, number>>((acc, key) => {
        acc[key] = receipt.rateCard[key as ReceiptUnit];
        return acc;
      }, {}),
  };
  return JSON.stringify(payload);
}

export function signReceiptForTests(
  receipt: IndependentReceipt,
  providerPrivateKeyPem: string,
): string {
  const payload = canonicalizeReceiptForSigning(receipt);
  return signDetached(null, Buffer.from(payload, "utf8"), providerPrivateKeyPem).toString("hex");
}

function verifyDetachedSignature(
  payload: string,
  signatureHex: string,
  providerPublicKeyPem: string,
): boolean {
  try {
    return verifySignature(
      null,
      Buffer.from(payload, "utf8"),
      providerPublicKeyPem,
      Buffer.from(signatureHex, "hex"),
    );
  } catch {
    return false;
  }
}

function deriveAmountMinor(receipt: IndependentReceipt): number | null {
  const rate = receipt.rateCard[receipt.unit];
  if (typeof rate !== "number" || Number.isNaN(rate)) {
    return null;
  }
  return Math.round(rate * receipt.quantity * receipt.exchangeRate);
}

export function verifyReceipt(input: VerifyReceiptInput): VerifyReceiptResult {
  const { receipt, providerPublicKeyPem, expectedChannelId, expectedNonce } = input;
  const failures: ReceiptFailure[] = [];

  const derivedAmountMinor = deriveAmountMinor(receipt);
  if (derivedAmountMinor === null) {
    failures.push({
      check: "receipt-shape",
      code: "MALFORMED_RECEIPT",
      message: `No rate card entry found for unit "${receipt.unit}".`,
    });
  }

  if (receipt.channelId !== expectedChannelId) {
    failures.push({
      check: "channel",
      code: "CHANNEL_MISMATCH",
      message: "Receipt channel does not match expected channel.",
      expected: expectedChannelId,
      actual: receipt.channelId,
    });
  }

  if (receipt.nonce !== expectedNonce) {
    failures.push({
      check: "nonce",
      code: "NONCE_MISMATCH",
      message: "Receipt nonce does not match expected nonce.",
      expected: expectedNonce,
      actual: receipt.nonce,
    });
  }

  if (derivedAmountMinor !== null && derivedAmountMinor !== receipt.amountMinor) {
    failures.push({
      check: "amount",
      code: "AMOUNT_MISMATCH",
      message: "Receipt amount does not match derived amount.",
      expected: derivedAmountMinor,
      actual: receipt.amountMinor,
    });
  }

  const payload = canonicalizeReceiptForSigning(receipt);
  const signatureOk = verifyDetachedSignature(payload, receipt.signature, providerPublicKeyPem);
  if (!signatureOk) {
    failures.push({
      check: "signature",
      code: "INVALID_SIGNATURE",
      message: "Receipt signature could not be verified against the provider key.",
    });
  }

  return {
    ok: failures.length === 0,
    derivedAmountMinor: derivedAmountMinor ?? undefined,
    failures,
  };
}
