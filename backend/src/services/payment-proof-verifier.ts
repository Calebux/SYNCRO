/**
 * payment-proof-verifier.ts
 *
 * Off-chain mirror of the on-chain PaymentProof security model.
 *
 * Security invariants enforced here match what the Soroban contract enforces
 * on-chain (see contracts/contracts/payment-channel/src/lib.rs):
 *
 *  1. Request binding  — the proof carries a SHA-256 `requestHash` computed
 *     over the canonical request bytes (method + path + body).  Replaying a
 *     captured proof against a *different* request fails because the
 *     requestHash does not match.
 *
 *  2. Freshness window — the proof `timestamp` must lie within
 *     ±PROOF_FRESHNESS_WINDOW_MS of `Date.now()`.  Proofs older than the
 *     window are rejected outright, which prevents arbitrarily old proofs
 *     from being accepted later.
 *
 *  3. Nonce dedup (seen-nonce set) — `(channelId, nonce)` pairs are stored
 *     with a TTL equal to 2× the freshness window.  Any proof replayed with
 *     the same nonce—even against a different requestHash—is rejected with
 *     `PROOF_ALREADY_USED`.  The TTL-sized window is sufficient because proofs
 *     outside it are already stale by rule (2).
 *
 *  4. Proxy integrity — because requestHash is verified before any state
 *     mutation, an intermediary cannot silently rewrite the request body and
 *     then replay the same proof; the hash would no longer match.
 *
 * Usage
 * -----
 * ```ts
 * import { paymentProofVerifier } from './payment-proof-verifier';
 *
 * const result = await paymentProofVerifier.verify({
 *   channelId: 'ch_abc',
 *   requestHash: computedHash,   // sha256(method+path+body), hex
 *   nonce: req.headers['x-syncro-nonce'],
 *   timestamp: Number(req.headers['x-syncro-ts']),
 *   amount: 100,
 *   signature: req.headers['x-syncro-sig'],
 * });
 * if (!result.ok) throw new ProofError(result.code);
 * ```
 */

import crypto from 'node:crypto';
import { env } from '../config/env';
import logger from '../config/logger';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Mirror of PROOF_FRESHNESS_WINDOW_SECS in the Soroban contract (300 s). */
export const PROOF_FRESHNESS_WINDOW_MS = 5 * 60 * 1_000; // 300 000 ms

/**
 * TTL for seen-nonce entries.  Must be ≥ 2× the freshness window so a nonce
 * cannot be evicted from the set while a proof containing it could still pass
 * the freshness check.
 */
const NONCE_TTL_MS = PROOF_FRESHNESS_WINDOW_MS * 2; // 600 000 ms

// ── Types ─────────────────────────────────────────────────────────────────────

/** A payment proof as produced by the SYNCRO gateway. */
export interface PaymentProof {
  /** Off-chain channel identifier (matches on-chain channel_id). */
  channelId: string;
  /**
   * Hex-encoded SHA-256 hash of the canonical request material:
   *   `METHOD\0PATH\0BODY_JSON`
   * The hash binds the proof to exactly one request so it cannot be reused
   * for a different call.
   */
  requestHash: string;
  /**
   * Cryptographically random nonce chosen by the gateway.  The verifier
   * records each `(channelId, nonce)` it has accepted and rejects duplicates.
   */
  nonce: string;
  /**
   * Unix milliseconds at which the gateway issued the proof.
   * Must be within ±PROOF_FRESHNESS_WINDOW_MS of the current wall-clock.
   */
  timestamp: number;
  /** Amount (smallest token unit) authorised by this proof. */
  amount: number;
  /**
   * HMAC-SHA-256 signature over the canonical signed material:
   *   `<channelId>:<requestHash>:<nonce>:<timestamp>:<amount>`
   * Signed with `env.CHANNEL_SIGNING_SECRET`.
   */
  signature: string;
}

/** Result discriminated union returned by `verify()`. */
export type ProofResult =
  | { ok: true }
  | { ok: false; code: ProofErrorCode; message: string };

export type ProofErrorCode =
  | 'PROOF_INVALID_STRUCTURE'
  | 'PROOF_INVALID_REQUEST_HASH'
  | 'PROOF_INVALID_AMOUNT'
  | 'PROOF_EXPIRED'
  | 'PROOF_ALREADY_USED'
  | 'PROOF_INVALID_SIGNATURE'
  | 'PROOF_CHANNEL_MISMATCH';

// ── Seen-nonce set ────────────────────────────────────────────────────────────

/**
 * In-process seen-nonce store.  Entries expire after NONCE_TTL_MS so the
 * set is bounded to ≈(rate × NONCE_TTL_MS) entries under steady load.
 *
 * In a multi-replica deployment this must be replaced with a shared Redis
 * store using `SET NX PX <ttl>` atomics so no replica can accept a nonce
 * that another already consumed.
 */
class SeenNonceSet {
  // Map<compositeKey, expiresAtMs>
  private readonly store = new Map<string, number>();

  private key(channelId: string, nonce: string): string {
    return `${channelId}:${nonce}`;
  }

  /** Returns `true` if the nonce has already been recorded. */
  has(channelId: string, nonce: string): boolean {
    const k = this.key(channelId, nonce);
    const exp = this.store.get(k);
    if (exp === undefined) return false;
    if (Date.now() > exp) {
      // Lazily evict expired entry.
      this.store.delete(k);
      return false;
    }
    return true;
  }

  /**
   * Record the nonce.  Returns `true` if the nonce was fresh and has now been
   * recorded, `false` if it was already present (replay).
   */
  record(channelId: string, nonce: string): boolean {
    if (this.has(channelId, nonce)) return false;
    this.store.set(this.key(channelId, nonce), Date.now() + NONCE_TTL_MS);
    return true;
  }

  /** Purge all expired entries.  Call periodically to bound memory. */
  purgeExpired(): void {
    const now = Date.now();
    for (const [k, exp] of this.store) {
      if (now > exp) this.store.delete(k);
    }
  }
}

// ── Canonical request hash helper ─────────────────────────────────────────────

/**
 * Compute the SHA-256 hex digest that binds a proof to a specific HTTP request.
 *
 * The canonical material is:
 *   `<METHOD>\0<PATH>\0<BODY_STRING>`
 *
 * where `\0` is the ASCII NUL byte used as an unambiguous delimiter (it cannot
 * appear in a valid HTTP method or URL path).  This is identical to the
 * canonical form the gateway uses when producing the proof.
 */
export function computeRequestHash(
  method: string,
  path: string,
  body: string,
): string {
  const canonical = `${method.toUpperCase()}\0${path}\0${body}`;
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

// ── Signature helpers ──────────────────────────────────────────────────────────

function buildSignedMaterial(proof: PaymentProof): string {
  // Field order must match the gateway's signing code exactly.
  return [
    proof.channelId,
    proof.requestHash,
    proof.nonce,
    proof.timestamp.toString(),
    proof.amount.toString(),
  ].join(':');
}

function computeExpectedSig(material: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(material, 'utf8')
    .digest('hex');
}

// ── PaymentProofVerifier ──────────────────────────────────────────────────────

export class PaymentProofVerifier {
  private readonly seenNonces: SeenNonceSet;

  constructor() {
    this.seenNonces = new SeenNonceSet();

    // Periodically purge expired nonces to bound memory usage.
    const interval = setInterval(
      () => this.seenNonces.purgeExpired(),
      NONCE_TTL_MS,
    );
    // Allow the Node process to exit even with a live verifier instance.
    if (interval.unref) interval.unref();
  }

  /**
   * Verify a PaymentProof and record its nonce on success.
   *
   * The method is intentionally **synchronous in its security-critical path**:
   * nonce recording uses the in-process SeenNonceSet atomically; no async gap
   * exists between the has() check and the record() write.
   *
   * @param proof        The proof to verify.
   * @param expectedChannelId  The channel the *current request* targets.
   *                           Must match `proof.channelId`.
   * @param expectedRequestHash  The request hash computed fresh from the
   *                              *current* request bytes.  Must match
   *                              `proof.requestHash`.
   */
  verify(
    proof: PaymentProof,
    expectedChannelId: string,
    expectedRequestHash: string,
  ): ProofResult {
    // ── 0. Structural validation ──────────────────────────────────────────────
    if (
      !proof.channelId ||
      !proof.requestHash ||
      !proof.nonce ||
      !proof.timestamp ||
      !proof.signature
    ) {
      return {
        ok: false,
        code: 'PROOF_INVALID_STRUCTURE',
        message: 'Proof is missing required fields.',
      };
    }

    if (typeof proof.amount !== 'number' || proof.amount <= 0) {
      return {
        ok: false,
        code: 'PROOF_INVALID_AMOUNT',
        message: `Proof amount must be a positive number, got: ${proof.amount}`,
      };
    }

    if (!/^[0-9a-f]{64}$/i.test(proof.requestHash)) {
      return {
        ok: false,
        code: 'PROOF_INVALID_REQUEST_HASH',
        message: 'Proof requestHash must be a 64-char hex SHA-256 digest.',
      };
    }

    // ── 1. Channel binding ────────────────────────────────────────────────────
    // The proof must target exactly the channel the caller claims.  An
    // intermediary cannot swap channel IDs because the signature covers
    // channelId and requestHash together.
    if (proof.channelId !== expectedChannelId) {
      logger.warn('PaymentProof channel mismatch', {
        proofChannel: proof.channelId,
        expectedChannel: expectedChannelId,
      });
      return {
        ok: false,
        code: 'PROOF_CHANNEL_MISMATCH',
        message: 'Proof channelId does not match the target channel.',
      };
    }

    // ── 2. Request binding ────────────────────────────────────────────────────
    // Compare using a timing-safe equality check.  A mismatch means the proof
    // was captured for a different request body and is being replayed here.
    const rhA = Buffer.from(proof.requestHash.toLowerCase(), 'hex');
    const rhB = Buffer.from(expectedRequestHash.toLowerCase(), 'hex');
    const hashesMatch =
      rhA.length === rhB.length && crypto.timingSafeEqual(rhA, rhB);
    if (!hashesMatch) {
      logger.warn('PaymentProof request-hash mismatch — cross-request replay attempt', {
        channelId: proof.channelId,
        nonce: proof.nonce,
      });
      return {
        ok: false,
        code: 'PROOF_CHANNEL_MISMATCH',
        message: 'Proof requestHash does not match the current request.',
      };
    }

    // ── 3. Freshness window ───────────────────────────────────────────────────
    const now = Date.now();
    const age = Math.abs(now - proof.timestamp);
    if (age > PROOF_FRESHNESS_WINDOW_MS) {
      logger.warn('PaymentProof outside freshness window', {
        channelId: proof.channelId,
        nonce: proof.nonce,
        age,
        windowMs: PROOF_FRESHNESS_WINDOW_MS,
      });
      return {
        ok: false,
        code: 'PROOF_EXPIRED',
        message: `Proof is ${age}ms old; maximum is ${PROOF_FRESHNESS_WINDOW_MS}ms.`,
      };
    }

    // ── 4. Signature verification ─────────────────────────────────────────────
    const material = buildSignedMaterial(proof);
    const expected = computeExpectedSig(material, env.CHANNEL_SIGNING_SECRET);
    const sigA = Buffer.from(proof.signature, 'hex');
    const sigB = Buffer.from(expected, 'hex');
    const sigValid =
      sigA.length === sigB.length && crypto.timingSafeEqual(sigA, sigB);
    if (!sigValid) {
      logger.warn('PaymentProof invalid signature', {
        channelId: proof.channelId,
        nonce: proof.nonce,
      });
      return {
        ok: false,
        code: 'PROOF_INVALID_SIGNATURE',
        message: 'Proof signature verification failed.',
      };
    }

    // ── 5. Nonce dedup ────────────────────────────────────────────────────────
    // Record atomically — has() + record() are synchronous so no race window.
    const fresh = this.seenNonces.record(proof.channelId, proof.nonce);
    if (!fresh) {
      logger.warn('PaymentProof replay detected — nonce already consumed', {
        channelId: proof.channelId,
        nonce: proof.nonce,
      });
      return {
        ok: false,
        code: 'PROOF_ALREADY_USED',
        message: 'This proof nonce has already been consumed.',
      };
    }

    logger.info('PaymentProof verified', {
      channelId: proof.channelId,
      nonce: proof.nonce,
      amount: proof.amount,
    });

    return { ok: true };
  }
}

// Singleton — one shared SeenNonceSet per process.
export const paymentProofVerifier = new PaymentProofVerifier();
