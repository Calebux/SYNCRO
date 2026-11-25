/**
 * Envoy ext_authz admission for SYNCRO (#1826).
 *
 * Lets a provider that already runs Envoy/Istio put SYNCRO admission in front
 * of its own upstream instead of adding the SYNCRO gateway as another proxy
 * hop. Two calls make up one paid request:
 *
 *   1. check  — Envoy's HTTP ext_authz filter forwards the inbound request.
 *               SYNCRO runs the paid-path admission (identity → route/price →
 *               scope → cap → payment proof → meter reservation). Allow is a
 *               200 carrying the reservation id for Envoy to inject upstream;
 *               any denial (402 with PAYMENT-REQUIRED, 403, 503, …) is passed
 *               back verbatim so clients see the same response as the gateway.
 *   2. settle — after the upstream responds, an Envoy Lua response filter
 *               posts the upstream status, metering headers and body. SYNCRO
 *               measures usage, commits the reservation and issues a signed
 *               receipt, which Envoy attaches to the client response as
 *               X-SYNCRO-RECEIPT / X-SYNCRO-RECEIPT-URL. A 5xx upstream
 *               releases the reservation instead and no receipt is issued.
 *
 * This module holds the decision and settlement logic with its side effects
 * injected, so it is testable without Express, Supabase or Envoy. The default
 * wiring onto the gateway lifecycle lives in `lifecycle-deps.ts`.
 */
import { timingSafeEqual } from 'node:crypto';

export const EXT_AUTHZ_HEADERS = {
  /** Shared secret Envoy adds to check and settle calls. Never forwarded upstream. */
  secret: 'x-syncro-ext-authz-secret',
  /** Injected upstream on allow (configure in `allowed_upstream_headers`). */
  agentId: 'x-syncro-agent-id',
  reservationId: 'x-syncro-reservation-id',
  route: 'x-syncro-route',
  /** Sent by the Lua filter on settle. */
  upstreamStatus: 'x-syncro-upstream-status',
  /** Upstream response headers relayed on settle are prefixed with this. */
  upstreamHeaderPrefix: 'x-upstream-',
  /** Returned by settle and copied onto the client response by Envoy. */
  receipt: 'x-syncro-receipt',
  receiptUrl: 'x-syncro-receipt-url',
} as const;

export interface CheckRequest {
  method: string;
  /** Original downstream path, without the ext_authz path prefix or query. */
  path: string;
  query: Record<string, string>;
  /** Lower-cased header names. */
  headers: Record<string, string | undefined>;
  body: unknown;
}

/** Everything settle needs about an admitted call, captured at check time. */
export interface AdmittedCall {
  agentId: string;
  reservationId: string;
  /** Registry path used for pricing, e.g. `/api/v3/gateway/inference`. */
  routePath: string;
  unitName: string;
  unitPrice: number;
  reservationBound: number;
  priceUpperBound: number;
  channelId: string;
  stateNonce: number;
  requestMethod: string;
  requestPath: string;
  requestQuery: Record<string, string>;
}

export type AdmitOutcome =
  | { admitted: true; call: AdmittedCall }
  | { admitted: false; status: number; headers: Record<string, string>; body: unknown };

export interface UpstreamOutcome {
  status: number;
  headers: Record<string, string | undefined>;
  body: unknown;
}

export interface Measurement {
  units: number;
  amount: number;
  fallbackUsed: boolean;
}

export interface IssuedReceipt {
  receiptId: string;
  /** Encoded receipt when it fits in a header, otherwise null (use the URL). */
  inlineHeader: string | null;
}

export interface ExtAuthzDeps {
  admit(req: CheckRequest): Promise<AdmitOutcome>;
  measure(call: AdmittedCall, upstream: UpstreamOutcome): Promise<Measurement>;
  commit(call: AdmittedCall, measurement: Measurement): Promise<void>;
  release(call: AdmittedCall, reason: string): Promise<void>;
  issueReceipt(call: AdmittedCall, measurement: Measurement): Promise<IssuedReceipt>;
  onError?(message: string, meta: Record<string, unknown>): void;
  now?(): number;
}

export interface ExtAuthzOptions {
  /** Shared secret Envoy presents. When unset, every call is refused (fail closed). */
  sharedSecret: string | undefined;
  /** How long an admitted call may wait for settle before its reservation is released. */
  pendingTtlMs?: number;
  /** Base for the receipt lookup URL. */
  receiptUrlBase?: string;
}

export interface ExtAuthzReply {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
}

const DEFAULT_PENDING_TTL_MS = 5 * 60 * 1000;

function internalError(message: string): ExtAuthzReply {
  return {
    status: 500,
    headers: { 'retry-after': '5' },
    body: { code: 'GATEWAY_INTERNAL', message, action: 'retry', retryable: true, retryAfterSeconds: 5 },
  };
}

export class EnvoyExtAuthzService {
  private readonly pending = new Map<string, { call: AdmittedCall; admittedAt: number }>();
  private readonly ttlMs: number;
  private readonly receiptUrlBase: string;

  constructor(private readonly deps: ExtAuthzDeps, private readonly options: ExtAuthzOptions) {
    this.ttlMs = options.pendingTtlMs ?? DEFAULT_PENDING_TTL_MS;
    this.receiptUrlBase = options.receiptUrlBase ?? '/api/v3/receipts';
  }

  isConfigured(): boolean {
    return Boolean(this.options.sharedSecret);
  }

  /** Constant-time comparison of the presented secret. False when no secret is configured. */
  authenticate(presented: string | undefined): boolean {
    const expected = this.options.sharedSecret;
    if (!expected || !presented) return false;
    const a = Buffer.from(presented);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  pendingCount(): number {
    return this.pending.size;
  }

  async check(req: CheckRequest): Promise<ExtAuthzReply> {
    this.sweepExpired();

    let outcome: AdmitOutcome;
    try {
      outcome = await this.deps.admit(req);
    } catch (error) {
      this.deps.onError?.('ext_authz admission threw', { error: String(error), path: req.path });
      return internalError('Admission check failed');
    }

    if (!outcome.admitted) {
      return { status: outcome.status, headers: outcome.headers, body: outcome.body };
    }

    const { call } = outcome;
    this.pending.set(call.reservationId, { call, admittedAt: this.now() });
    return {
      status: 200,
      headers: {
        [EXT_AUTHZ_HEADERS.agentId]: call.agentId,
        [EXT_AUTHZ_HEADERS.reservationId]: call.reservationId,
        [EXT_AUTHZ_HEADERS.route]: call.routePath,
      },
    };
  }

  async settle(reservationId: string | undefined, upstream: UpstreamOutcome): Promise<ExtAuthzReply> {
    const entry = reservationId ? this.pending.get(reservationId) : undefined;
    if (!entry) {
      return { status: 404, headers: {}, body: { error: 'unknown_reservation' } };
    }
    // Single use: a replayed settle must not commit or receipt twice.
    this.pending.delete(entry.call.reservationId);
    const { call } = entry;

    if (!Number.isInteger(upstream.status) || upstream.status < 100 || upstream.status >= 500) {
      await this.safeRelease(call, `Upstream failed behind Envoy (status ${upstream.status})`);
      return { status: 200, headers: {}, body: { released: true } };
    }

    let measurement: Measurement;
    try {
      measurement = await this.deps.measure(call, upstream);
    } catch (error) {
      // Extraction should already fall back internally; if it still throws,
      // charge the reservation bound the caller authorized rather than nothing.
      this.deps.onError?.('ext_authz measurement threw', { error: String(error), reservationId });
      measurement = { units: call.reservationBound, amount: call.priceUpperBound, fallbackUsed: true };
    }

    // The payment proof only authorized the reservation's upper bound.
    if (measurement.amount > call.priceUpperBound) {
      measurement = { units: call.reservationBound, amount: call.priceUpperBound, fallbackUsed: measurement.fallbackUsed };
    }

    try {
      await this.deps.commit(call, measurement);
      const receipt = await this.deps.issueReceipt(call, measurement);
      const headers: Record<string, string> = {
        [EXT_AUTHZ_HEADERS.receiptUrl]: `${this.receiptUrlBase}/${receipt.receiptId}`,
      };
      if (receipt.inlineHeader) headers[EXT_AUTHZ_HEADERS.receipt] = receipt.inlineHeader;
      return {
        status: 200,
        headers,
        body: { receiptId: receipt.receiptId, units: measurement.units, amount: measurement.amount },
      };
    } catch (error) {
      this.deps.onError?.('ext_authz settle failed', { error: String(error), reservationId });
      return internalError('Settlement failed');
    }
  }

  /** Release reservations whose settle never arrived (Envoy crash, Lua error, client reset). */
  sweepExpired(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, entry] of this.pending) {
      if (entry.admittedAt > cutoff) continue;
      this.pending.delete(id);
      void this.safeRelease(entry.call, 'No ext_authz settle received before TTL');
    }
  }

  private async safeRelease(call: AdmittedCall, reason: string): Promise<void> {
    try {
      await this.deps.release(call, reason);
    } catch (error) {
      this.deps.onError?.('ext_authz release failed', { error: String(error), reservationId: call.reservationId });
    }
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }
}
