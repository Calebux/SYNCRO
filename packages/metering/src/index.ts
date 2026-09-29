/**
 * @handsoff/metering — public exports
 *
 * Issue #1440: quota_guard promoted from Python sidecar to metering core.
 *
 * ## Quick start
 *
 * ```ts
 * import { InMemoryMeter } from '@handsoff/metering';
 *
 * const meter = new InMemoryMeter({ limits: { 'agent-1': 1000 } });
 *
 * // Before upstream call:
 * const rsv = meter.reserve('agent-1', 'llm:call', 10);
 *
 * // After success:
 * const { charged, warnings } = meter.commit(rsv.id, 7);
 *
 * // After failure:
 * meter.release(rsv.id);
 *
 * // Any time:
 * const reading = meter.read('agent-1');
 * ```
 *
 * ## Degraded mode
 *
 * ```ts
 * import { InMemoryMeter, DefaultDegradedModeEvaluator } from '@handsoff/metering';
 *
 * const evaluator = new DefaultDegradedModeEvaluator(() => myCounters.snapshots());
 * const meter = new InMemoryMeter({ degradedEvaluator: evaluator });
 * const rsv = meter.reserve('agent-1', 'llm:call', 10);
 * if (rsv.degraded) res.setHeader('X-Meter-Degraded', '1');
 * ```
 */

// Core Meter interface and implementations
export type { Meter, MeterReservation, MeterCommitResult, MeterReading } from './meter';
export {
  InMemoryMeter,
  InMemoryAllowanceStore,
  type InMemoryMeterOptions,
} from './meter';

// Clock abstractions (ADR-017)
export {
  SystemClock,
  TestClock,
  ClockSkewGuard,
  ClockSkewError,
  assertNoClientTimestamp,
  systemClock,
  MAX_SKEW_MS,
  HARD_SKEW_MS,
  type MeterClock,
  type ClockSource,
  type SkewWarning,
  type SkewAlertCallback,
} from './clock';

// Degraded-mode evaluator (port of quota_guard/degraded_mode.py)
export type {
  DegradedModeEvaluator,
  DegradedModeResult,
  DegradedModeOptions,
  TrackerSnapshot,
  SnapshotProvider,
} from './degraded';
export { DefaultDegradedModeEvaluator, StaticDegradedModeEvaluator } from './degraded';

// Window / aggregation primitives
export {
  WindowStore,
  CurrentWindowCounter,
  ClosedWindowStore,
  LateArrivalError,
  WindowAlreadySealedError,
  windowBoundary,
  windowLabel,
  MINUTE_MS,
  HOUR_MS,
  DAY_MS,
  defaultClock,
  type WindowStoreOptions,
  type ClosedWindowRecord,
  type LateArrivalPolicy,
  type LateRecord,
  type WindowClock,
} from './window';

// Usage read helpers
export {
  readCurrentWindow,
  readWindowSeries,
  readSettledWindow,
  aggregateClosedUsage,
  admissionRead,
  type CurrentWindowResult,
  type WindowSeriesOptions,
  type SettlementReadResult,
  type AggregateUsageOptions,
  type AdmissionResult,
} from './usage-read';

// Reservation ledger
export {
  ReservationLedger,
  DEFAULT_RESERVATION_TIMEOUT_MS,
  type Reservation,
  type ReservationState,
  type AllowanceStore,
} from './reservation';

// Overage policy
export {
  createOverageState,
  evaluateOverage,
  recordUsage,
  availableGrace,
  authorizeGrace,
  DEFAULT_OVERAGE_POLICY,
  type OveragePolicy,
  type OverageState,
  type OverageWarning,
  type OverageDecision,
  type GraceGrant,
} from './overage';

// Policy / grace ledger
export {
  GraceLedger,
  evaluateOverage as evaluatePolicyOverage,
  DEFAULT_WARNING_THRESHOLDS,
  type Principal,
  type WarningThreshold,
  type GraceAllowance,
  type PolicyDecision,
  type Rejection,
  type EvaluateOptions,
} from './policy';

// WAL / durability
export {
  DurableMeter,
  recover,
  measureDurableThroughput,
  type WriteAheadLog,
  type PrimaryStore,
  type UsageRecord,
  type WalEntry,
  type MeterDurabilityOptions,
} from './recovery';
