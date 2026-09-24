import { randomBytes } from 'crypto';

/**
 * W3C Trace Context (https://www.w3.org/TR/trace-context/) helpers.
 *
 * First slice of #1516: a single trace context format that the gateway, the
 * meter call, and the settlement batch can all propagate, plus the sampling
 * policy the issue asks for (trace every failure and settlement, sample the
 * successful hot path).
 */

export interface TraceContext {
  /** 32 lowercase hex chars, never all zeros */
  traceId: string;
  /** 16 lowercase hex chars, never all zeros */
  spanId: string;
  sampled: boolean;
}

const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ZERO_TRACE_ID = '0'.repeat(32);
const ZERO_SPAN_ID = '0'.repeat(16);

/** Parses a `traceparent` header. Returns undefined for anything malformed. */
export function parseTraceparent(header: string | undefined): TraceContext | undefined {
  if (!header) return undefined;
  const match = TRACEPARENT_RE.exec(header.trim().toLowerCase());
  if (!match) return undefined;
  const [, traceId, spanId, flags] = match;
  if (traceId === ZERO_TRACE_ID || spanId === ZERO_SPAN_ID) return undefined;
  return { traceId, spanId, sampled: (parseInt(flags, 16) & 0x01) === 0x01 };
}

export function formatTraceparent(ctx: TraceContext): string {
  return `00-${ctx.traceId}-${ctx.spanId}-${ctx.sampled ? '01' : '00'}`;
}

/** Starts a new trace (no inbound context). */
export function newTraceContext(sampled: boolean): TraceContext {
  return { traceId: randomBytes(16).toString('hex'), spanId: randomBytes(8).toString('hex'), sampled };
}

/** Creates the context for the next hop: same trace, new span, same sampling decision. */
export function childTraceContext(parent: TraceContext): TraceContext {
  return { ...parent, spanId: randomBytes(8).toString('hex') };
}

export type TraceOutcome = 'success' | 'failure' | 'settlement';

/**
 * Sampling policy: failures and settlements are always traced; the successful
 * hot path is sampled at `hotPathRate` (0..1). An upstream sampled flag is
 * honoured so a trace is never cut in half mid-flight.
 */
export function shouldSample(
  outcome: TraceOutcome,
  hotPathRate: number,
  upstream?: TraceContext,
  random: () => number = Math.random,
): boolean {
  if (outcome !== 'success') return true;
  if (upstream?.sampled) return true;
  return random() < hotPathRate;
}
