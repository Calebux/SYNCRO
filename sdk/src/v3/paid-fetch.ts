// ─────────────────────────────────────────────────────────────────────────────
// x402 protocol types (derived from backend openapi/x402-docs.ts)
// ─────────────────────────────────────────────────────────────────────────────

interface X402PaymentRequirement {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds?: number;
}

interface X402PaymentRequired {
  x402Version: number;
  error?: string;
  resource?: {
    url: string;
    description?: string;
    mimeType?: string;
  };
  accepts: X402PaymentRequirement[];
}

interface X402PaymentPayload {
  x402Version: number;
  accepted: X402PaymentRequirement;
  payload: Record<string, unknown>;
}

interface X402SettlementResponse {
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
 * const fetch = createPaidFetch({ spendingKey: '...' });
 * const res = await fetch('https://api.example.com/endpoint');
 * if (res.receipt) {
 *   console.log('Payment settled:', res.receipt.transaction);
 * }
 * ```
 */
export function createPaidFetch(config: PaidFetchConfig): typeof fetch {
  const { spendingKey, sign, providerPublicKey, fetchImpl = fetch } = config;

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

    const accepted = paymentRequired.accepts[0];
    if (!accepted) {
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

    const signedPayload: X402PaymentPayload & { signature: string } = {
      ...paymentProof,
      payload: { signature },
    };

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

function parsePaymentRequiredHeader(
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
