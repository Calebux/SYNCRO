import {
  ChallengeDetails,
  PaymentProof,
  generatePaymentChallenge,
} from './payment-challenge-service';

/**
 * x402 protocol compatibility layer (#1822).
 *
 * SYNCRO's native challenge is a signed channel-state instruction. x402 clients
 * expect a `PaymentRequired` object carrying an `accepts[]` array of
 * `PaymentRequirements`. This module maps one onto the other so a gateway can
 * advertise an x402-shaped challenge while still settling with SYNCRO's
 * channel-state proof.
 *
 * Design decisions (see docs/x402-compatibility.md for the full matrix):
 *  - Only the `exact` scheme is advertised on Stellar. SYNCRO's per-call,
 *    off-chain-batched channel model is exposed to x402 as a one-shot `exact`
 *    payment for the reserved amount; the multi-call channel semantics remain
 *    a SYNCRO-native concept.
 *  - The original signed SYNCRO challenge is embedded in the request as a
 *    `syncro` extension so SYNCRO-aware clients can still settle with a
 *    channel-state proof, while stock x402 clients can read `accepts[]`.
 */

export const X402_VERSION = 2;

/** The single scheme advertised for Stellar addresses. */
export const X402_STELLAR_SCHEME = 'exact';

export interface X402PaymentRequirement {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface X402Resource {
  url: string;
  description?: string;
  mimeType?: string;
}

export interface X402PaymentRequired {
  x402Version: number;
  error?: string;
  resource?: X402Resource;
  accepts: X402PaymentRequirement[];
  /** SYNCRO extension: the original signed challenge (channel-state scheme). */
  syncro: ChallengeDetails;
  /** Ed25519 signature over the canonicalized object above (minus this field). */
  signature: string;
}

export interface X402PaymentPayload {
  x402Version: number;
  accepted: X402PaymentRequirement;
  payload: Record<string, unknown>;
}

export interface X402SettlementResponse {
  success: boolean;
  transaction?: string;
  network?: string;
}

export interface IssueChallengeOptions {
  settlementAsset: string;
  amount: string;
  rate: string;
  contract: string;
  chain: string;
  /** Human-readable reason returned in the `error` field of the challenge. */
  error: string;
  resource?: X402Resource;
  channelAddress?: string;
  ttlSeconds?: number;
  nowMs?: number;
}

export interface IssuedChallenge {
  challenge: ChallengeDetails;
  /** Value for the `PAYMENT-REQUIRED` header (native or x402-shaped). */
  headerValue: string;
  /** Whether the header is an x402 `PaymentRequired` object. */
  x402: boolean;
}

/**
 * Whether the gateway should emit x402-shaped challenges and settlement
 * headers. Opt-in per deployment so existing SYNCRO-only clients are
 * unaffected when it is off.
 */
export function isX402CompatibilityEnabled(): boolean {
  return (process.env.X402_COMPATIBILITY_ENABLED ?? '').trim().toLowerCase() === 'true';
}

/** Canonical JSON: object keys sorted at every level, array order preserved. */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
    .join(',')}}`;
}

/**
 * Map a SYNCRO challenge onto an x402 `PaymentRequirements` entry.
 *
 * Field mapping:
 *   scheme            → 'exact'                (channel-state collapses to a one-shot payment)
 *   chain             → network                (already CAIP-2-shaped, e.g. `stellar:testnet`)
 *   amount            → amount
 *   settlementAsset   → asset
 *   channelAddress    → payTo                  (SYNCRO pays the provider channel, not an EOA)
 *   expiresAt         → maxTimeoutSeconds       (seconds remaining)
 *   (remaining SYNCRO-only fields are preserved under `extra`)
 */
export function challengeToPaymentRequirements(
  challenge: ChallengeDetails,
  nowMs: number = Date.now(),
): X402PaymentRequirement {
  const expiresMs = Date.parse(challenge.expiresAt);
  const maxTimeoutSeconds = Number.isFinite(expiresMs)
    ? Math.max(0, Math.floor((expiresMs - nowMs) / 1000))
    : 0;

  return {
    scheme: X402_STELLAR_SCHEME,
    network: challenge.chain,
    amount: challenge.amount,
    asset: challenge.settlementAsset,
    payTo: challenge.channelAddress,
    maxTimeoutSeconds,
    extra: {
      syncroScheme: challenge.scheme,
      challengeId: challenge.challengeId,
      contract: challenge.contract,
      rate: challenge.rate,
      nonce: challenge.nonce,
      expiresAt: challenge.expiresAt,
    },
  };
}

/**
 * Build a signed x402 `PaymentRequired` object (and its base64 header value)
 * from a SYNCRO challenge. The object is signed with the same gateway key that
 * signs SYNCRO challenges; consumers verify it before signing any payment.
 */
export function buildX402PaymentRequired(
  challenge: ChallengeDetails,
  options: {
    sign: (message: string) => string;
    error?: string;
    resource?: X402Resource;
    nowMs?: number;
  },
): { paymentRequired: X402PaymentRequired; headerValue: string } {
  const unsigned = {
    x402Version: X402_VERSION,
    ...(options.error ? { error: options.error } : {}),
    ...(options.resource ? { resource: options.resource } : {}),
    accepts: [challengeToPaymentRequirements(challenge, options.nowMs)],
    syncro: challenge,
  };
  const signature = options.sign(canonicalize(unsigned));
  const paymentRequired: X402PaymentRequired = { ...unsigned, signature };
  const headerValue = Buffer.from(JSON.stringify(paymentRequired)).toString('base64');
  return { paymentRequired, headerValue };
}

/**
 * Generate a challenge and pick the header representation: the native SYNCRO
 * shape by default, or the x402 `PaymentRequired` shape when compatibility mode
 * is enabled. The response body always carries the native `challenge`.
 */
export function issuePaymentChallenge(
  options: IssueChallengeOptions,
  sign: (message: string) => string,
): IssuedChallenge {
  const { challenge, headerValue: nativeHeader } = generatePaymentChallenge(
    {
      settlementAsset: options.settlementAsset,
      amount: options.amount,
      rate: options.rate,
      channelAddress: options.channelAddress,
      contract: options.contract,
      chain: options.chain,
      ttlSeconds: options.ttlSeconds,
    },
    sign,
  );

  if (!isX402CompatibilityEnabled()) {
    return { challenge, headerValue: nativeHeader, x402: false };
  }

  const { headerValue } = buildX402PaymentRequired(challenge, {
    sign,
    error: options.error,
    resource: options.resource,
    nowMs: options.nowMs,
  });
  return { challenge, headerValue, x402: true };
}

/**
 * Unwrap an x402 `PaymentPayload` back into the SYNCRO channel-state proof it
 * carries under `payload`. Returns `null` when the header is not a well-formed
 * x402 payload with an embedded channel-state proof.
 */
export function extractSyncroProofFromX402(headerValue: string): PaymentProof | null {
  try {
    const raw = Buffer.from(headerValue, 'base64').toString('utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.x402Version !== 'number' || !parsed.accepted || !parsed.payload) {
      return null;
    }
    const proof = parsed.payload;
    if (
      !proof ||
      typeof proof !== 'object' ||
      !proof.channelId ||
      typeof proof.sequenceNumber !== 'number' ||
      !proof.nonce ||
      !proof.signature ||
      !proof.payerAddress
    ) {
      return null;
    }
    return proof as PaymentProof;
  } catch {
    return null;
  }
}

/**
 * Build the x402 settlement response for a committed receipt. Until the
 * channel batch settles on-chain, `transaction` references the SYNCRO receipt
 * id rather than a chain transaction hash.
 */
export function buildX402SettlementResponse(
  receipt: { receiptId: string },
  chain: string,
): X402SettlementResponse {
  return { success: true, transaction: receipt.receiptId, network: chain };
}
