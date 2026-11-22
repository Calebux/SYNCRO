// ─────────────────────────────────────────────────────────────────────────────
// x402 & Gateway v3 protocol types
// ─────────────────────────────────────────────────────────────────────────────

export interface X402PaymentRequirement {
  scheme: string;
  network?: string;
  amount?: string;
  asset?: string;
  payTo?: string;
  maxTimeoutSeconds?: number;
}

export interface X402ResourceDescriptor {
  url: string;
  description?: string;
  mimeType?: string;
}

export interface X402PaymentRequired {
  x402Version?: number;
  challengeId?: string;
  scheme?: "channel-state" | "exact";
  chain?: string;
  contract?: string;
  channelAddress?: string;
  settlementAsset?: string;
  amount?: string;
  rate?: string;
  nonce?: string;
  expiresAt?: string;
  signature?: string;
  error?: string;
  resource?: X402ResourceDescriptor;
  accepts?: X402PaymentRequirement[];
}

export interface X402PaymentPayload {
  x402Version: number;
  accepted: X402PaymentRequirement;
  payload: Record<string, unknown>;
}

export interface X402SignedPaymentPayload {
  x402Version: number;
  accepted: X402PaymentRequirement;
  payload: {
    signature: string;
  };
}

export interface X402SettlementResponse {
  success: boolean;
  transaction?: string;
  network?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface PaidFetchConfig {
  /**
   * PEM-encoded Ed25519 private key for signing payment proofs.
   * Only for Node environments — storing raw spending keys in the browser
   * is a security risk. In browser environments, provide a `sign` function
   * instead.
   */
  spendingKey?: string;
  /**
   * Custom signing function for payment proofs.
   * Accepts a canonicalized JSON payload string and returns a signature
   * string (hex-encoded or base64-encoded). Use this in browser environments
   * where raw spending keys should not be stored.
   */
  sign?: (payload: string) => Promise<string> | string;
  /** Optional provider public key for receipt verification. */
  providerPublicKey?: string;
  /**
   * Trusted PEM-encoded Ed25519 gateway public key used to verify every
   * PAYMENT-REQUIRED challenge before any payment proof is signed.
   */
  gatewayPublicKey?: string;
  /** Custom fetch implementation (defaults to global fetch). */
  fetchImpl?: typeof fetch;
}

export interface PaymentReceipt {
  success: boolean;
  transaction?: string;
  network?: string;
}

export interface PaidResponse extends Response {
  /** Payment receipt from the x402 PAYMENT-RESPONSE header, present when
   *  a 402 challenge was handled and the retry succeeded. */
  receipt?: PaymentReceipt;
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a drop-in `fetch`-compatible wrapper that automatically handles
 * HTTP 402 (payment required) challenges.
 *
 * On the happy path the caller receives a normal `Response`. When the
 * server returns 402 the wrapper:
 *  1. Parses the `PAYMENT-REQUIRED` header,
 *  2. Constructs a payment proof,
 *  3. Signs it with the configured spending key (or `sign` callback),
 *  4. Retries the original request with the `PAYMENT-SIGNATURE` header,
 *  5. Returns the response with an attached `receipt` when settlement
 *     succeeds.
 *
 * @example
 * ```ts
 * import { createPaidFetch } from '@syncro/sdk/v3';
 *
 * const fetch = createPaidFetch({
 *   spendingKey: '...',
 *   gatewayPublicKey: '-----BEGIN PUBLIC KEY-----...',
 * });
 * const res = await fetch('https://api.example.com/endpoint');
 * if (res.receipt) {
 *   console.log('Payment settled:', res.receipt.transaction);
 * }
 * ```
 */
export function createPaidFetch(config: PaidFetchConfig): typeof fetch {
  const { spendingKey, sign, providerPublicKey, gatewayPublicKey, fetchImpl = fetch } = config;

  if (!sign && !spendingKey) {
    throw new Error(
      "Either `spendingKey` or `sign` must be provided to createPaidFetch.",
    );
  }

  if (typeof window !== "undefined" && spendingKey) {
    throw new Error(
      "Spending keys should not be stored in the browser. " +
        "Provide a `sign` function instead of a raw `spendingKey`.",
    );
  }

  let signer: ((payload: string) => Promise<string>) | undefined;

  async function getSigner(): Promise<(payload: string) => Promise<string>> {
    if (signer) return signer;
    if (sign) {
      signer = sign;
      return signer;
    }
    // Node: use node:crypto for Ed25519 signing
    const nodeCrypto = await import("node:crypto");
    const privateKey = spendingKey!;
    signer = (payload: string): string => {
      return nodeCrypto
        .sign(null, Buffer.from(payload, "utf8"), privateKey)
        .toString("hex");
    };
    return signer;
  }

  return async function paidFetch(
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<PaidResponse> {
    const response = await fetchImpl(input, init);

    if (response.status !== 402) {
      return response as PaidResponse;
    }

    const paymentRequired = parsePaymentRequiredHeader(response);
    if (!paymentRequired) {
      return response as PaidResponse;
    }

    if (!gatewayPublicKey || !(await verifyPaymentRequired(paymentRequired, gatewayPublicKey))) {
      return response as PaidResponse;
    }

    const accepted = paymentRequired.accepts?.[0];
    if (!accepted || !isCompletePaymentRequirement(accepted)) {
      return response as PaidResponse;
    }

    const paymentProof: X402PaymentPayload = {
      x402Version: 2,
      accepted,
      payload: {},
    };

    const canonicalProof = canonicalizeJson(paymentProof);
    const s = await getSigner();
    const signature = await s(canonicalProof);

    const signedPayload: X402SignedPaymentPayload = {
      ...paymentProof,
      payload: { signature },
    };

    const retryHeaders = new Headers(init.headers);
    retryHeaders.set("PAYMENT-SIGNATURE", serialisePaymentSignatureHeader(signedPayload));

    const retryResponse = await fetchImpl(input, {
      ...init,
      headers: retryHeaders,
    });

    // Prevent infinite loop if retry also returns 402
    if (retryResponse.status === 402) {
      return retryResponse as PaidResponse;
    }

    const receipt = extractReceipt(retryResponse, providerPublicKey);

    return Object.assign(retryResponse, { receipt }) as PaidResponse;
  };
}

const MAX_HEADER_LENGTH = 16_384;
const MAX_JSON_DEPTH = 16;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const DECIMAL_AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const X402_CHALLENGE_KEYS = new Set([
  "x402Version",
  "signature",
  "error",
  "resource",
  "accepts",
]);

const GATEWAY_CHALLENGE_KEYS = new Set([
  "challengeId",
  "scheme",
  "chain",
  "contract",
  "channelAddress",
  "settlementAsset",
  "amount",
  "rate",
  "nonce",
  "expiresAt",
  "signature",
]);

const REQUIREMENT_KEYS = new Set([
  "scheme",
  "network",
  "amount",
  "asset",
  "payTo",
  "maxTimeoutSeconds",
]);

const RESOURCE_KEYS = new Set(["url", "description", "mimeType"]);
const SIGNED_PAYLOAD_KEYS = new Set(["x402Version", "accepted", "payload"]);
const RECEIPT_KEYS = new Set(["success", "transaction", "network"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim().length > 0;
}

function isPositiveDecimalString(value: unknown): value is string {
  if (typeof value !== "string" || !DECIMAL_AMOUNT_PATTERN.test(value)) return false;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
}

function exceedsJsonDepth(value: unknown, depth: number = 0): boolean {
  if (depth > MAX_JSON_DEPTH) return true;
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((item) => exceedsJsonDepth(item, depth + 1));
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_KEYS.has(key)) return true;
    if (exceedsJsonDepth(record[key], depth + 1)) return true;
  }
  return false;
}

function encodeUtf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeCanonicalBase64Json(headerValue: string): Record<string, unknown> | null {
  if (
    typeof headerValue !== "string" ||
    headerValue.length === 0 ||
    headerValue.length > MAX_HEADER_LENGTH ||
    headerValue.length % 4 !== 0 ||
    !BASE64_PATTERN.test(headerValue)
  ) {
    return null;
  }
  try {
    const bytes = decodeBase64(headerValue);
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (encodeUtf8Base64(raw) !== headerValue) {
      return null;
    }
    if (raw.includes('"__proto__"') || raw.includes('"constructor"') || raw.includes('"prototype"')) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed) || exceedsJsonDepth(parsed)) {
      return null;
    }
    if (JSON.stringify(parsed) !== raw) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function isValidPaymentRequirement(value: unknown): value is X402PaymentRequirement {
  if (!isPlainObject(value) || exceedsJsonDepth(value)) return false;
  const keys = Object.keys(value);
  for (const key of keys) {
    if (!REQUIREMENT_KEYS.has(key) || FORBIDDEN_KEYS.has(key)) return false;
  }
  if (!isNonEmptyString(value.scheme)) return false;
  if (Object.prototype.hasOwnProperty.call(value, "network") && !isNonEmptyString(value.network)) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(value, "amount") && !isPositiveDecimalString(value.amount)) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(value, "asset") && !isNonEmptyString(value.asset)) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(value, "payTo") && !isNonEmptyString(value.payTo)) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(value, "maxTimeoutSeconds")) {
    if (
      typeof value.maxTimeoutSeconds !== "number" ||
      !Number.isFinite(value.maxTimeoutSeconds) ||
      value.maxTimeoutSeconds <= 0 ||
      Object.is(value.maxTimeoutSeconds, -0)
    ) {
      return false;
    }
  }
  return true;
}

export function isCompletePaymentRequirement(value: unknown): value is Required<
  Pick<X402PaymentRequirement, "scheme" | "network" | "amount" | "asset" | "payTo">
> &
  X402PaymentRequirement {
  if (!isValidPaymentRequirement(value)) return false;
  return (
    isNonEmptyString(value.scheme) &&
    isNonEmptyString(value.network) &&
    isPositiveDecimalString(value.amount) &&
    isNonEmptyString(value.asset) &&
    isNonEmptyString(value.payTo)
  );
}

function isValidResourceDescriptor(value: unknown): value is X402ResourceDescriptor {
  if (!isPlainObject(value) || exceedsJsonDepth(value)) return false;
  for (const key of Object.keys(value)) {
    if (!RESOURCE_KEYS.has(key) || FORBIDDEN_KEYS.has(key)) return false;
  }
  if (!isNonEmptyString(value.url)) return false;
  if (Object.prototype.hasOwnProperty.call(value, "description") && typeof value.description !== "string") {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(value, "mimeType") && !isNonEmptyString(value.mimeType)) {
    return false;
  }
  return true;
}

export function isValidPaymentRequired(value: unknown): value is X402PaymentRequired {
  if (!isPlainObject(value) || exceedsJsonDepth(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 0) return false;

  // Variant A: x402Version challenge
  if (Object.prototype.hasOwnProperty.call(value, "x402Version")) {
    for (const key of keys) {
      if (!X402_CHALLENGE_KEYS.has(key) || FORBIDDEN_KEYS.has(key)) return false;
    }
    if (
      typeof value.x402Version !== "number" ||
      !Number.isSafeInteger(value.x402Version) ||
      value.x402Version <= 0
    ) {
      return false;
    }
    if (Object.prototype.hasOwnProperty.call(value, "signature") && !isNonEmptyString(value.signature)) {
      return false;
    }
    if (Object.prototype.hasOwnProperty.call(value, "error") && !isNonEmptyString(value.error)) {
      return false;
    }
    if (Object.prototype.hasOwnProperty.call(value, "resource") && !isValidResourceDescriptor(value.resource)) {
      return false;
    }
    if (Object.prototype.hasOwnProperty.call(value, "accepts")) {
      if (!Array.isArray(value.accepts) || !value.accepts.every(isValidPaymentRequirement)) {
        return false;
      }
    }
    return true;
  }

  // Variant B: Gateway v3 channel-state / exact ChallengeDetails
  if (Object.prototype.hasOwnProperty.call(value, "challengeId")) {
    for (const key of keys) {
      if (!GATEWAY_CHALLENGE_KEYS.has(key) || FORBIDDEN_KEYS.has(key)) return false;
    }
    const expiresTime = typeof value.expiresAt === "string" ? Date.parse(value.expiresAt) : NaN;
    if (
      !isNonEmptyString(value.challengeId) ||
      (value.scheme !== "channel-state" && value.scheme !== "exact") ||
      !isNonEmptyString(value.chain) ||
      !isNonEmptyString(value.contract) ||
      !isNonEmptyString(value.channelAddress) ||
      !isNonEmptyString(value.settlementAsset) ||
      !isPositiveDecimalString(value.amount) ||
      !isPositiveDecimalString(value.rate) ||
      !isNonEmptyString(value.nonce) ||
      !isNonEmptyString(value.expiresAt) ||
      !Number.isFinite(expiresTime)
    ) {
      return false;
    }
    if (Object.prototype.hasOwnProperty.call(value, "signature") && !isNonEmptyString(value.signature)) {
      return false;
    }
    return true;
  }

  return false;
}

export function isValidSignedPaymentPayload(value: unknown): value is X402SignedPaymentPayload {
  if (!isPlainObject(value) || exceedsJsonDepth(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== SIGNED_PAYLOAD_KEYS.size) return false;
  for (const key of keys) {
    if (!SIGNED_PAYLOAD_KEYS.has(key) || FORBIDDEN_KEYS.has(key)) return false;
  }
  if (
    typeof value.x402Version !== "number" ||
    !Number.isSafeInteger(value.x402Version) ||
    value.x402Version <= 0
  ) {
    return false;
  }
  if (!isCompletePaymentRequirement(value.accepted)) return false;
  if (!isPlainObject(value.payload)) return false;
  const payloadKeys = Object.keys(value.payload);
  if (payloadKeys.length !== 1 || payloadKeys[0] !== "signature") return false;
  return isNonEmptyString(value.payload.signature);
}

export function isValidPaymentReceipt(value: unknown): value is PaymentReceipt {
  if (!isPlainObject(value) || exceedsJsonDepth(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 0) return false;
  for (const key of keys) {
    if (!RECEIPT_KEYS.has(key) || FORBIDDEN_KEYS.has(key)) return false;
  }
  if (typeof value.success !== "boolean") return false;
  if (Object.prototype.hasOwnProperty.call(value, "transaction") && !isNonEmptyString(value.transaction)) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(value, "network") && !isNonEmptyString(value.network)) {
    return false;
  }
  return true;
}

export function parsePaymentRequiredHeader(
  input: Response | Headers | string,
): X402PaymentRequired | null {
  const header =
    typeof input === "string"
      ? input
      : "headers" in input
        ? input.headers.get("PAYMENT-REQUIRED")
        : input.get("PAYMENT-REQUIRED");
  if (!header) return null;
  const parsed = decodeCanonicalBase64Json(header);
  if (!parsed || !isValidPaymentRequired(parsed)) {
    return null;
  }
  return parsed;
}

export function serialisePaymentRequiredHeader(challenge: X402PaymentRequired): string {
  if (!isValidPaymentRequired(challenge)) {
    throw new TypeError("Invalid X402PaymentRequired challenge object");
  }
  return encodeUtf8Base64(JSON.stringify(challenge));
}

export const serializePaymentRequiredHeader = serialisePaymentRequiredHeader;

export function parsePaymentSignatureHeader(headerValue: string): X402SignedPaymentPayload | null {
  const parsed = decodeCanonicalBase64Json(headerValue);
  if (!parsed || !isValidSignedPaymentPayload(parsed)) {
    return null;
  }
  return parsed;
}

export function serialisePaymentSignatureHeader(payload: X402SignedPaymentPayload): string {
  if (!isValidSignedPaymentPayload(payload)) {
    throw new TypeError("Invalid X402SignedPaymentPayload object");
  }
  return encodeUtf8Base64(JSON.stringify(payload));
}

export const serializePaymentSignatureHeader = serialisePaymentSignatureHeader;

export function parsePaymentResponseHeader(
  input: Response | Headers | string,
): PaymentReceipt | null {
  const header =
    typeof input === "string"
      ? input
      : "headers" in input
        ? input.headers.get("PAYMENT-RESPONSE")
        : input.get("PAYMENT-RESPONSE");
  if (!header) return null;
  const parsed = decodeCanonicalBase64Json(header);
  if (!parsed || !isValidPaymentReceipt(parsed)) {
    return null;
  }
  return parsed;
}

export function serialisePaymentResponseHeader(receipt: PaymentReceipt): string {
  if (!isValidPaymentReceipt(receipt)) {
    throw new TypeError("Invalid PaymentReceipt object");
  }
  return encodeUtf8Base64(JSON.stringify(receipt));
}

export const serializePaymentResponseHeader = serialisePaymentResponseHeader;

async function verifyPaymentRequired(
  paymentRequired: X402PaymentRequired,
  publicKeyPem: string,
): Promise<boolean> {
  if (typeof paymentRequired.signature !== "string") return false;
  const { signature, ...unsignedChallenge } = paymentRequired;
  try {
    const publicKey = await globalThis.crypto.subtle.importKey(
      "spki",
      decodePem(publicKeyPem),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await globalThis.crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      decodeBase64(signature),
      new TextEncoder().encode(canonicalizeJson(unsignedChallenge)),
    );
  } catch {
    return false;
  }
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodePem(value: string): Uint8Array {
  const encoded = value.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, "");
  return decodeBase64(encoded);
}

function extractReceipt(
  response: Response,
  _providerPublicKey?: string,
): PaymentReceipt | undefined {
  const parsed = parsePaymentResponseHeader(response);
  if (!parsed) return undefined;
  return {
    success: parsed.success,
    ...(parsed.transaction !== undefined ? { transaction: parsed.transaction } : {}),
    ...(parsed.network !== undefined ? { network: parsed.network } : {}),
  };
}

export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalizeJson(obj[k])}`)
    .join(",")}}`;
}
