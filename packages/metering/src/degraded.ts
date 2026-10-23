/**
 * Degraded-mode evaluator (Issue #1440).
 *
 * This is a faithful port of `quota_guard/degraded_mode.py` into TypeScript.
 * The Python implementation is retained as the canonical reference; this module
 * is the running implementation for the TypeScript metering core.
 *
 * ## Algorithm (mirrors Python DegradedMode.evaluate())
 *
 * Given a list of `TrackerSnapshot` objects (one per tracked service):
 *
 * 1. Collect per-service flags:
 *    - A service is flagged for individual degradation if it is >= 95% of its limit.
 *    - A service is flagged if its throttle count >= the configured threshold.
 *
 * 2. Compute a global degraded flag:
 *    - If the sum of used across all services / sum of limits >= globalPercentThreshold.
 *
 * 3. Return { degraded, servicesToLimit } where `servicesToLimit` is the union of
 *    individually flagged services.
 *
 * ## Integration with the Meter
 *
 * `InMemoryMeter` accepts an optional `DegradedModeEvaluator`. When present it is
 * called on every `reserve()` and `read()`. If `degraded` is true:
 *   - `reserve()` still returns a reservation tagged `degraded: true`.
 *   - The gateway surfaces `X-Meter-Degraded: 1` in the response.
 *   - The agent decides whether to proceed.
 */

// ---------------------------------------------------------------------------
// Tracker snapshot — the input to the evaluator
// ---------------------------------------------------------------------------

/**
 * Snapshot of a single tracked resource's quota state.
 *
 * This mirrors the dict returned by `QuotaTracker.get_status()` in Python.
 */
export interface TrackerSnapshot {
  /** Stable name for the service (e.g. 'gmail', 'openai'). */
  name: string;
  /** Configured limit (tokens / calls / bytes per window). */
  limit: number;
  /** Units consumed in the current window. */
  used: number;
  /** Number of upstream throttle responses recorded. */
  throttleCount: number;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface DegradedModeResult {
  /**
   * True when the global degraded mode should be activated.
   * Mirrors the first element of the Python tuple `(degraded, services)`.
   */
  degraded: boolean;
  /**
   * Names of services that should be individually rate-limited or degraded.
   * Mirrors the second element of the Python tuple `(degraded, services)`.
   */
  servicesToLimit: string[];
}

// ---------------------------------------------------------------------------
// DegradedModeEvaluator interface
// ---------------------------------------------------------------------------

/**
 * Pluggable evaluator so callers can swap in custom implementations
 * (e.g. backed by Redis counters instead of in-memory snapshots).
 */
export interface DegradedModeEvaluator {
  evaluate(): DegradedModeResult;
}

// ---------------------------------------------------------------------------
// DefaultDegradedModeEvaluator — direct port of Python DegradedMode
// ---------------------------------------------------------------------------

export interface DegradedModeOptions {
  /**
   * Number of upstream throttle responses that triggers service-level
   * degradation. Mirrors Python `throttle_threshold` (default: 3).
   */
  throttleThreshold?: number;
  /**
   * Fraction of combined limit at which global degraded mode activates.
   * Mirrors Python `global_percent_threshold` (default: 0.9).
   */
  globalPercentThreshold?: number;
  /**
   * Individual service usage fraction above which the service is individually
   * flagged. Fixed at 0.95 in the Python implementation; exposed here for tests.
   */
  individualServiceThreshold?: number;
}

/**
 * Snapshot provider. Implementations can pull snapshots from in-memory
 * counters, Redis, or any other source.
 */
export type SnapshotProvider = () => TrackerSnapshot[];

/**
 * TypeScript port of `quota_guard/degraded_mode.py::DegradedMode`.
 *
 * Instantiate once, inject a `SnapshotProvider` that reads from whatever
 * counter store backs the running meter, and attach it to `InMemoryMeter`
 * via the `degradedEvaluator` option.
 *
 * @example
 * ```ts
 * const evaluator = new DefaultDegradedModeEvaluator(
 *   () => myCounters.snapshots(),
 *   { throttleThreshold: 3, globalPercentThreshold: 0.9 },
 * );
 * const meter = new InMemoryMeter({ degradedEvaluator: evaluator });
 * ```
 */
export class DefaultDegradedModeEvaluator implements DegradedModeEvaluator {
  private readonly snapshotProvider: SnapshotProvider;
  private readonly throttleThreshold: number;
  private readonly globalPercentThreshold: number;
  private readonly individualServiceThreshold: number;

  constructor(snapshotProvider: SnapshotProvider, options: DegradedModeOptions = {}) {
    this.snapshotProvider = snapshotProvider;
    this.throttleThreshold = options.throttleThreshold ?? 3;
    this.globalPercentThreshold = options.globalPercentThreshold ?? 0.9;
    this.individualServiceThreshold = options.individualServiceThreshold ?? 0.95;
  }

  /**
   * Evaluate all tracked services and return the degraded posture.
   *
   * Algorithm is a direct port of `DegradedMode.evaluate()` in Python:
   *
   * ```python
   * def evaluate(self) -> Tuple[bool, List[str]]:
   *     services = []
   *     total_limit = 0
   *     total_used = 0
   *     high_throttle = []
   *
   *     for t in self.trackers:
   *         s = t.get_status()
   *         total_limit += s.get("limit", 0)
   *         total_used += s.get("used", 0)
   *         if s.get("throttle_count", 0) >= self.throttle_threshold:
   *             high_throttle.append(s.get("name"))
   *         if s.get("limit", 1) > 0 and s.get("used", 0) / float(s.get("limit")) >= 0.95:
   *             services.append(s.get("name"))
   *
   *     degraded = False
   *     if total_limit > 0 and (total_used / float(total_limit)) >= self.global_percent_threshold:
   *         degraded = True
   *
   *     services = list(set(services + high_throttle))
   *     return degraded, services
   * ```
   */
  evaluate(): DegradedModeResult {
    const snapshots = this.snapshotProvider();

    let totalLimit = 0;
    let totalUsed = 0;
    const individuallyDegraded: string[] = [];
    const highThrottle: string[] = [];

    for (const snap of snapshots) {
      totalLimit += snap.limit;
      totalUsed += snap.used;

      if (snap.throttleCount >= this.throttleThreshold) {
        highThrottle.push(snap.name);
      }

      // Individual service: >= 95% of its own limit
      if (snap.limit > 0 && snap.used / snap.limit >= this.individualServiceThreshold) {
        individuallyDegraded.push(snap.name);
      }
    }

    const degraded =
      totalLimit > 0 && totalUsed / totalLimit >= this.globalPercentThreshold;

    // Union of individually degraded services and high-throttle services.
    const servicesToLimit = [...new Set([...individuallyDegraded, ...highThrottle])];

    return { degraded, servicesToLimit };
  }
}

// ---------------------------------------------------------------------------
// StaticDegradedModeEvaluator — for tests / kill-switch
// ---------------------------------------------------------------------------

/**
 * Evaluator that returns a fixed result. Useful for forcing degraded mode in
 * tests or for a manual kill-switch that operators can toggle.
 */
export class StaticDegradedModeEvaluator implements DegradedModeEvaluator {
  constructor(private readonly result: DegradedModeResult) {}

  evaluate(): DegradedModeResult {
    return this.result;
  }
}
