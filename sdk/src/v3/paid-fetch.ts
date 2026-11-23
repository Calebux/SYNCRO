// ─────────────────────────────────────────────────────────────────────────────
// x402 protocol types (derived from backend openapi/x402-docs.ts)
// ─────────────────────────────────────────────────────────────────────────────

export interface X402PaymentRequirement {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
}

/**
 * SYNCRO's native channel-state challenge, embedded in an x402
 * `PaymentRequired` under the `syncro` extension when the gateway runs in
 * x402 compatibility mode (#1822).
 */
export interface SyncroChallenge {
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

export interface X402PaymentRequired {
  x402Version: number;
  signature?: string;
  error?: string;
  resource?: {
    url: string;
    description?: string;
    mimeType?: string;
  };
  accepts?: X402PaymentRequirement[];
  /**
   * SYNCRO extension carrying the original signed challenge. When present a
   * SYNCRO-aware consumer builds a channel-state proof from it, while stock
   * x402 clients continue to read `accepts`.
   */
  syncro?: SyncroChallenge;
}

export interface X402PaymentPayload {
  x402Version: number;
  accepted: X402PaymentRequirement;
  payload: Record<string, unknown>;
}

interface X402SettlementResponse {
  success: boolean;
  transaction?: string;
  network?: string;
}

/**
 * Local channel state a consumer needs to build a SYNCRO channel-state proof
 * for an x402-compatible challenge.
 */
export interface SyncroChannelContext {
  channelId: string;
  payerAddress: string;
  sequenceNumber: number;
  userBalance: number;
  executorBalance: number;
  totalDeposited: number;
}

/** Signs a message and resolves to the signature string. */
export type X402Signer = (message: string) => Promise<string>;

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
   * Accepts the message to sign and returns a signature string (hex- or
   * base64-encoded). In the generic x402 flow the message is the canonicalized
   * JSON `PaymentPayload`; when a `syncroChannel` is configured and the
   * challenge carries the `syncro` extension, the message is the SYNCRO
   * channel-state string (`channelId:seq:userBalance:executorBalance:nonce:
   * payerAddress`). Use this in browser environments where raw spending keys
   * should not be stored.
   */
  sign?: (payload: string) => Promise<string> | string;
  /** Optional provider public key for receipt verification. */
  providerPublicKey?: string;
  /**
   * Trusted PEM-encoded Ed25519 gateway public key used to verify every
   * PAYMENT-REQUIRED challenge before any payment proof is signed.
   */
  gatewayPublicKey?: string;
  /**
   * Local channel state enabling the x402 compatibility flow. When a
   * PAYMENT-REQUIRED challenge carries the `syncro` extension, the wrapper
   * builds a SYNCRO channel-state proof from this context instead of the
   * generic x402 payload.
   */
  syncroChannel?: SyncroChannelContext;
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
  const {
    spendingKey,
    sign,
    providerPublicKey,
    gatewayPublicKey,
    syncroChannel,
    fetchImpl = fetch,
  } = config;

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
    if (!accepted) {
      return response as PaidResponse;
    }

    const s = await getSigner();

    let signedPayload: X402PaymentPayload;
    if (paymentRequired.syncro) {
      // x402 compatibility mode: build a SYNCRO channel-state proof from the
      // embedded challenge. Without local channel state we cannot pay.
      if (!syncroChannel) {
        return response as PaidResponse;
      }
      signedPayload = await buildSyncroX402Payload(paymentRequired, syncroChannel, s);
    } else {
      const paymentProof: X402PaymentPayload = {
        x402Version: 2,
        accepted,
        payload: {},
      };
      const canonicalProof = canonicalizeJson(paymentProof);
      const signature = await s(canonicalProof);
      signedPayload = {
        ...paymentProof,
        payload: { signature },
      };
    }

    const retryHeaders = new Headers(init.headers);
    retryHeaders.set("PAYMENT-SIGNATURE", btoa(JSON.stringify(signedPayload)));

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

/**
 * Parse the base64-encoded `PAYMENT-REQUIRED` header from a 402 response into
 * an x402 `PaymentRequired` object. Returns `null` when the header is absent or
 * malformed.
 */
export function parsePaymentRequiredHeader(
  response: Response,
): X402PaymentRequired | null {
  const header = response.headers.get("PAYMENT-REQUIRED");
  if (!header) return null;
  try {
    return JSON.parse(atob(header)) as X402PaymentRequired;
  } catch {
    return null;
  }
}

/**
 * Build an x402 `PaymentPayload` for a SYNCRO-compatible challenge: the
 * channel-state proof is signed over the SYNCRO canonical string and carried
 * under `payload`, so the gateway can unwrap and settle it (#1822).
 */
export async function buildSyncroX402Payload(
  paymentRequired: X402PaymentRequired,
  channel: SyncroChannelContext,
  sign: X402Signer,
): Promise<X402PaymentPayload> {
  const challenge = paymentRequired.syncro;
  const accepted = paymentRequired.accepts?.[0];
  if (!challenge || !accepted) {
    throw new Error(
      "Cannot build a SYNCRO x402 payload without a challenge extension and an accepts entry.",
    );
  }

  const proof = {
    channelId: channel.channelId,
    sequenceNumber: channel.sequenceNumber,
    userBalance: channel.userBalance,
    executorBalance: channel.executorBalance,
    totalDeposited: channel.totalDeposited,
    nonce: challenge.nonce,
    payerAddress: channel.payerAddress,
    expiresAt: challenge.expiresAt,
  };

  const message = `${proof.channelId}:${proof.sequenceNumber}:${proof.userBalance}:${proof.executorBalance}:${proof.nonce}:${proof.payerAddress}`;
  const signature = await sign(message);

  return {
    x402Version: 2,
    accepted,
    payload: { ...proof, signature },
  };
}

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
  providerPublicKey?: string,
): PaymentReceipt | undefined {
  const header = response.headers.get("PAYMENT-RESPONSE");
  if (!header) return undefined;
  try {
    const settlement = JSON.parse(atob(header)) as X402SettlementResponse;
    return {
      success: settlement.success,
      transaction: settlement.transaction,
      network: settlement.network,
    };
  } catch {
    return undefined;
  }
}

function canonicalizeJson(value: unknown): string {
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
