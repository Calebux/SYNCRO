/**
 * Authoritative clock abstractions for the metering core (Issue #448).
 *
 * ## Policy (ADR-017)
 *
 * Each time-dependent decision names its authoritative clock:
 *
 * | Decision                   | Authoritative clock              |
 * |----------------------------|----------------------------------|
 * | Window boundary placement  | MeterClock (this module)         |
 * | Reservation expiry         | MeterClock                       |
 * | Cap period boundary        | MeterClock                       |
 * | Channel challenge timeout  | Ledger time (on-chain)           |
 * | Receipt meteredAt          | MeterClock                       |
 * | Settlement timestamp       | Settlement engine clock          |
 *
 * Client-supplied timestamps are stored for audit only and are NEVER used to
 * compute window boundaries. See `assertNoClientTimestamp()`.
 *
 * ## Skew bounds
 *
 * MAX_SKEW_MS  = 5 000 ms — log a structured warning when exceeded.
 * HARD_SKEW_MS = 60 000 ms — throw ClockSkewError when exceeded.
 */

// ---------------------------------------------------------------------------
// Clock source discriminant
// ---------------------------------------------------------------------------

/**
 * Identifies where a timestamp originated.
 *
 * - `'system'`  — `Date.now()` on the meter process.
 * - `'ledger'`  — Soroban ledger timestamp (authoritative for on-chain decisions).
 * - `'test'`    — injected in tests; deterministic, not a real wall-clock.
 */
export type ClockSource = 'system' | 'ledger' | 'test';

// ---------------------------------------------------------------------------
// MeterClock interface
// ---------------------------------------------------------------------------

/**
 * The single clock interface used throughout the metering core.
 *
 * Injecting a `MeterClock` (instead of calling `Date.now()` directly) makes
 * every time-dependent decision deterministically testable and lets operators
 * audit which clock produced each record via the `source` field.
 */
export interface MeterClock {
  /** Return the current time in epoch milliseconds. */
  now(): number;
  /** Which clock this value originated from. */
  readonly source: ClockSource;
}

// ---------------------------------------------------------------------------
// SystemClock — production implementation
// ---------------------------------------------------------------------------

/**
 * Production `MeterClock` backed by `Date.now()`.
 *
 * Use this in the production `InMemoryMeter` and wherever a real wall-clock is
 * needed. All other code should accept `MeterClock` and let callers inject.
 */
export class SystemClock implements MeterClock {
  readonly source: ClockSource = 'system';

  now(): number {
    return Date.now();
  }
}

/** Singleton for production use. */
export const systemClock: MeterClock = new SystemClock();

// ---------------------------------------------------------------------------
// TestClock — deterministic clock for unit tests
// ---------------------------------------------------------------------------

/**
 * Deterministic `MeterClock` for unit tests.
 *
 * Start at a fixed epoch, then call `advance(ms)` to move time forward.
 * Never reads the real wall clock, so tests are reproducible regardless of
 * machine speed or CI load.
 *
 * @example
 * ```ts
 * const clock = new TestClock(1_700_000_000_000);
 * clock.advance(59_999); // 1 ms before a 1-minute boundary
 * const before = clock.now(); // inside window N
 * clock.advance(2);           // cross the boundary
 * const after = clock.now();  // inside window N+1
 * ```
 */
export class TestClock implements MeterClock {
  readonly source: ClockSource = 'test';
  private _now: number;

  constructor(startMs = 0) {
    this._now = startMs;
  }

  now(): number {
    return this._now;
  }

  /** Move the clock forward by `ms` milliseconds. */
  advance(ms: number): void {
    if (ms < 0) throw new RangeError(`advance() requires a non-negative delta, got ${ms}`);
    this._now += ms;
  }

  /** Set the clock to an absolute epoch ms value. */
  set(ms: number): void {
    this._now = ms;
  }
}

// ---------------------------------------------------------------------------
// Skew bounds
// ---------------------------------------------------------------------------

/**
 * Maximum acceptable clock skew between a client-supplied timestamp and the
 * meter clock. Exceeding this triggers a structured warning log.
 *
 * 5 seconds is generous enough to cover NTP drift and network jitter but
 * tight enough to catch mis-configured or adversarial clients.
 */
export const MAX_SKEW_MS = 5_000;

/**
 * Hard limit on clock skew. Exceeding this causes `ClockSkewGuard.check()` to
 * throw `ClockSkewError`, rejecting the usage record rather than silently
 * misfiling it into a window it cannot belong to.
 *
 * 60 seconds is enough to catch system clock jumps, time zone bugs, or
 * replayed requests from a previous session.
 */
export const HARD_SKEW_MS = 60_000;

// ---------------------------------------------------------------------------
// ClockSkewError
// ---------------------------------------------------------------------------

/**
 * Thrown by `ClockSkewGuard.check()` when a client-supplied timestamp differs
 * from the meter clock by more than `HARD_SKEW_MS`.
 *
 * The usage record should be rejected — a 60-second drift is irreconcilable
 * with the window boundaries the meter is currently tracking.
 */
export class ClockSkewError extends Error {
  readonly clientTimestampMs: number;
  readonly meterTimestampMs: number;
  readonly driftMs: number;
  readonly context: string;

  constructor(
    clientTimestampMs: number,
    meterTimestampMs: number,
    context: string,
  ) {
    const driftMs = Math.abs(clientTimestampMs - meterTimestampMs);
    super(
      `Clock skew exceeds hard limit: client=${clientTimestampMs} meter=${meterTimestampMs} ` +
        `drift=${driftMs}ms (limit=${HARD_SKEW_MS}ms) context=${context}`,
    );
    this.name = 'ClockSkewError';
    this.clientTimestampMs = clientTimestampMs;
    this.meterTimestampMs = meterTimestampMs;
    this.driftMs = driftMs;
    this.context = context;
  }
}

// ---------------------------------------------------------------------------
// ClockSkewGuard
// ---------------------------------------------------------------------------

export interface SkewWarning {
  clientTimestampMs: number;
  meterTimestampMs: number;
  driftMs: number;
  context: string;
}

export type SkewAlertCallback = (warning: SkewWarning) => void;

/**
 * Guards a `MeterClock` against client-supplied timestamps that drift too far.
 *
 * ## Usage
 *
 * Instantiate once per `InMemoryMeter` (or share a singleton). Call
 * `check(clientTimestampMs, context)` whenever a client-supplied timestamp is
 * received. The guard:
 *
 * - Does nothing if |drift| <= MAX_SKEW_MS.
 * - Calls `onAlert` (default: `console.warn`) if MAX_SKEW_MS < |drift| <= HARD_SKEW_MS.
 * - Throws `ClockSkewError` if |drift| > HARD_SKEW_MS.
 *
 * In all cases the meter clock value — not the client value — is what must be
 * used for window placement.
 */
export class ClockSkewGuard {
  private readonly clock: MeterClock;
  private readonly maxSkewMs: number;
  private readonly hardSkewMs: number;
  private readonly onAlert: SkewAlertCallback;

  constructor(
    clock: MeterClock,
    opts: {
      maxSkewMs?: number;
      hardSkewMs?: number;
      onAlert?: SkewAlertCallback;
    } = {},
  ) {
    this.clock = clock;
    this.maxSkewMs = opts.maxSkewMs ?? MAX_SKEW_MS;
    this.hardSkewMs = opts.hardSkewMs ?? HARD_SKEW_MS;
    this.onAlert = opts.onAlert ?? defaultSkewAlert;
  }

  /**
   * Check a client-supplied timestamp against the meter clock.
   *
   * @param clientTimestampMs - Timestamp from the client (header, payload, etc.).
   * @param context           - Human-readable label for log / error messages.
   *
   * @throws ClockSkewError when |drift| > hardSkewMs.
   */
  check(clientTimestampMs: number, context: string): void {
    const meterNow = this.clock.now();
    const driftMs = Math.abs(clientTimestampMs - meterNow);

    if (driftMs <= this.maxSkewMs) return;

    const warning: SkewWarning = {
      clientTimestampMs,
      meterTimestampMs: meterNow,
      driftMs,
      context,
    };

    if (driftMs > this.hardSkewMs) {
      throw new ClockSkewError(clientTimestampMs, meterNow, context);
    }

    this.onAlert(warning);
  }

  /**
   * Convenience: check and return the meter's current time so callers can use
   * it for window placement in one call.
   *
   * ```ts
   * const meterNow = guard.checkAndGetMeterTime(clientTs, 'commit');
   * windowStore.recordUsage(principal, meterNow, amount);
   * ```
   */
  checkAndGetMeterTime(clientTimestampMs: number, context: string): number {
    this.check(clientTimestampMs, context);
    return this.clock.now();
  }
}

// ---------------------------------------------------------------------------
// assertNoClientTimestamp — compile-time guard helper
// ---------------------------------------------------------------------------

/**
 * Runtime assertion that no client-supplied timestamp is being used for window
 * placement. Call this at the top of any function that receives a client
 * timestamp and must not use it for billing.
 *
 * In production this is a no-op if `clientTimestampMs` is not passed.
 * In tests, passing a client timestamp to a function that calls this helper
 * will trigger a visible error immediately rather than silent mis-billing.
 *
 * @example
 * ```ts
 * function recordFromGateway(principal: string, clientTs: number, amount: number) {
 *   assertNoClientTimestamp(clientTs, 'recordFromGateway');
 *   // Use meter clock for placement:
 *   windowStore.recordUsage(principal, meterClock.now(), amount);
 * }
 * ```
 */
export function assertNoClientTimestamp(
  clientTimestampMs: number,
  callerName: string,
): never {
  throw new Error(
    `[metering] Client-supplied timestamp (${clientTimestampMs}) must never be used ` +
      `for window placement in ${callerName}. ` +
      `Use the meter clock (meterClock.now()) instead. ` +
      `Store clientTimestampMs for audit only. (ADR-017)`,
  );
}

// ---------------------------------------------------------------------------
// Default alert callback
// ---------------------------------------------------------------------------

function defaultSkewAlert(warning: SkewWarning): void {
  // Uses console.warn so it works in both Node and test environments without
  // importing the backend logger (which has side-effects and env dependencies).
  console.warn(
    `[metering] Clock skew warning: ` +
      `client=${warning.clientTimestampMs} meter=${warning.meterTimestampMs} ` +
      `drift=${warning.driftMs}ms context=${warning.context}`,
  );
}
