// ─────────────────────────────────────────────────────────────────────────────
// x402 protocol types (derived from backend openapi/x402-docs.ts)
// ─────────────────────────────────────────────────────────────────────────────

import type { SyncroProviderManifest, ManifestRouteDescriptor } from "./manifest-client.js";

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
  signature?: string;
  error?: string;
  resource?: {
    url: string;
    description?: string;
    mimeType?: string;
  };
  accepts?: X402PaymentRequirement[];
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
  /**
   * Trusted PEM-encoded Ed25519 gateway public key used to verify every
   * PAYMENT-REQUIRED challenge before any payment proof is signed.
   *
   * When `manifest` is provided this is derived automatically from the
   * manifest's current receipt key, so you do not need to supply it
   * separately — but an explicitly supplied value always takes precedence.
   */
  gatewayPublicKey?: string;
  /** Custom fetch implementation (defaults to global fetch). */
  fetchImpl?: typeof fetch;
  /**
   * Pre-fetched provider manifest (issue #1828).
   *
   * When present `createPaidFetch` uses the manifest for:
   *   - Gateway public key lookup (the `'current'` receipt key's PEM) when
   *     `gatewayPublicKey` is not explicitly provided.
   *   - Quote pre-check: the route price from the manifest is verified
   *     against the price in the 402 challenge; if they differ by more than
   *     `manifestPriceTolerance` (default 0) the payment is rejected.
   *
   * Pass a `SyncroProviderManifest` object or a zero-argument async factory.
   * The factory is called at most once and the result is cached for the
   * lifetime of the returned fetch function.
   */
  manifest?: SyncroProviderManifest | (() => Promise<SyncroProviderManifest> | SyncroProviderManifest);
  /**
   * Maximum fraction by which the 402 challenge price may exceed the
   * manifest price before the payment is refused (default: 0 = exact match).
   *
   * Example: set to 0.05 to allow up to 5% variance (useful when prices are
   * expressed as floating-point XLM and micro-rounding differs from stroops).
   */
  manifestPriceTolerance?: number;
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

  // ── Manifest handling (issue #1828) ───────────────────────────────────────
  // Resolve the manifest once and cache it for the lifetime of this fetch fn.
  let resolvedManifest: SyncroProviderManifest | null = null;
  let manifestPromise: Promise<SyncroProviderManifest | null> | null = null;

  async function getManifest(): Promise<SyncroProviderManifest | null> {
    if (resolvedManifest) return resolvedManifest;
    if (!config.manifest) return null;
    if (!manifestPromise) {
      manifestPromise =
        typeof config.manifest === 'function'
          ? Promise.resolve(config.manifest()).then((m) => { resolvedManifest = m; return m; }).catch(() => null)
          : Promise.resolve(config.manifest).then((m) => { resolvedManifest = m; return m; });
    }
    return manifestPromise;
  }

  /**
   * Resolve the gateway public key: explicit config value takes precedence,
   * then the manifest's current receipt key, then undefined (payment
   * challenge verification is skipped when no key is known).
   */
  async function resolveGatewayPublicKey(): Promise<string | undefined> {
    if (config.gatewayPublicKey) return config.gatewayPublicKey;
    const manifest = await getManifest();
    if (!manifest) return undefined;
    const current = manifest.receiptKeys.find((k) => k.status === 'current');
    return current?.publicKeyPem;
  }

  /**
   * Check the challenge price against the manifest's route price.
   * Returns true (allow) when no manifest is loaded, when the route is not
   * found in the manifest, or when the price is within tolerance.
   * Returns false (reject) when the challenge price exceeds the manifest price
   * beyond the configured tolerance — indicating a potential price-tamper attack.
   */
  async function checkManifestPrice(
    requestUrl: string,
    requestMethod: string,
    challengeAmount: string,
  ): Promise<boolean> {
    const manifest = await getManifest();
    if (!manifest) return true;

    // Parse the request path from the URL
    let path = '/';
    try {
      path = new URL(requestUrl as string).pathname;
    } catch {
      // If we can't parse the URL, allow the payment
      return true;
    }

    const route = findManifestRoute(manifest, requestMethod, path);
    if (!route) return true; // Unknown route — allow

    const manifestPriceStroops = route.priceStroops;
    if (manifestPriceStroops === undefined) return true;

    const challengeAmountNumber = parseFloat(challengeAmount);
    if (!Number.isFinite(challengeAmountNumber)) return true;

    // Convert challenge amount (which may be in XLM) to stroops for comparison
    // 1 XLM = 10_000_000 stroops
    const challengeStroops = challengeAmountNumber * 10_000_000;
    const tolerance = config.manifestPriceTolerance ?? 0;
    const maxAllowed = manifestPriceStroops * (1 + tolerance);

    return challengeStroops <= maxAllowed;
  }
  // ── End manifest handling ──────────────────────────────────────────────────

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

    const gatewayPublicKey = await resolveGatewayPublicKey();
    if (!gatewayPublicKey || !(await verifyPaymentRequired(paymentRequired, gatewayPublicKey))) {
      return response as PaidResponse;
    }

    const accepted = paymentRequired.accepts?.[0];
    if (!accepted) {
      return response as PaidResponse;
    }

    // Manifest price check (issue #1828): refuse if challenge price exceeds
    // the manifest price beyond the configured tolerance.
    const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const requestMethod = init.method ?? (input instanceof Request ? (input as Request).method : 'GET');
    const priceAllowed = await checkManifestPrice(requestUrl, requestMethod, accepted.amount);
    if (!priceAllowed) {
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

// ── Manifest route matcher (issue #1828) ─────────────────────────────────────

/**
 * Find the best matching route descriptor in a manifest for a given method +
 * path. Uses the same simple wildcard rule as the backend: `*` matches any
 * suffix. Longer (more-specific) patterns win over shorter ones.
 */
function findManifestRoute(
  manifest: SyncroProviderManifest,
  method: string,
  path: string,
): ManifestRouteDescriptor | undefined {
  const upperMethod = method.toUpperCase();
  const sorted = [...manifest.routes].sort(
    (a, b) => b.pathPattern.length - a.pathPattern.length,
  );
  return sorted.find(
    (r) =>
      r.method.toUpperCase() === upperMethod &&
      manifestPatternMatches(r.pathPattern, path),
  );
}

function manifestPatternMatches(pattern: string, path: string): boolean {
  if (pattern === path) return true;
  if (pattern.endsWith('*')) {
    return path.startsWith(pattern.slice(0, -1));
  }
  return false;
}
