/**
 * Meter load-test harness.
 *
 * Drives realistic traffic mixes against the metering durable path
 * (`reserve` + `commit`) and reports p50/p95/p99 latency plus the point at
 * which the durable path saturates. The first bottleneck (counter store, WAL
 * fsync, or database) is recorded from the measured stage timings rather than
 * guessed.
 *
 * Usage:
 *   tsx packages/metering/load-test.ts            # run all mixes
 *   tsx packages/metering/load-test.ts --json     # machine-readable output
 *   tsx packages/metering/load-test.ts --gate     # exit non-zero on budget regression
 *
 * The published numbers live in the architecture doc; this harness is the
 * source of truth and the CI gate compares against PERFORMANCE_BUDGET below.
 */

export interface MeterClient {
  reserve(input: { agentId: string; route: string; amount: number }): Promise<unknown>;
  commit(input: { agentId: string; route: string; amount: number }): Promise<unknown>;
}

/** Stage timings surfaced by the durable path, used to locate the bottleneck. */
export interface StageTimings {
  counterStoreMs: number;
  walFsyncMs: number;
  databaseMs: number;
}

export interface MeterClientWithTimings extends MeterClient {
  lastStageTimings?(): StageTimings | undefined;
}

export type MixName =
  | "many-agents-few-routes"
  | "few-agents-many-routes"
  | "single-agent-burst";

export interface MixSpec {
  name: MixName;
  agents: number;
  routes: number;
  /** Total reserve+commit pairs issued for this mix. */
  operations: number;
  /** Concurrent in-flight operations. */
  concurrency: number;
}

export interface LatencySummary {
  p50: number;
  p95: number;
  p99: number;
  max: number;
  count: number;
}

export interface MixResult {
  name: MixName;
  operations: number;
  concurrency: number;
  durationMs: number;
  throughputOpsPerSec: number;
  reserve: LatencySummary;
  commit: LatencySummary;
  bottleneck: Bottleneck;
}

export type Bottleneck = "counter-store" | "wal-fsync" | "database" | "none";

export interface LoadTestReport {
  generatedAt: string;
  mixes: MixResult[];
  saturation: {
    /** Highest throughput observed before p99 exceeded the budget. */
    throughputOpsPerSec: number;
    mix: MixName;
    bottleneck: Bottleneck;
  };
  budget: PerformanceBudget;
  passed: boolean;
  regressions: string[];
}

/**
 * Performance budget derived from measured results. CI fails when a run
 * regresses past these thresholds.
 */
export interface PerformanceBudget {
  /** Minimum sustained throughput (ops/sec) for the durable path. */
  minThroughputOpsPerSec: number;
  /** Maximum acceptable p99 latency (ms) for reserve. */
  maxReserveP99Ms: number;
  /** Maximum acceptable p99 latency (ms) for commit. */
  maxCommitP99Ms: number;
}

export const PERFORMANCE_BUDGET: PerformanceBudget = {
  minThroughputOpsPerSec: 500,
  maxReserveP99Ms: 50,
  maxCommitP99Ms: 75,
};

export const DEFAULT_MIXES: MixSpec[] = [
  { name: "many-agents-few-routes", agents: 500, routes: 4, operations: 5000, concurrency: 64 },
  { name: "few-agents-many-routes", agents: 4, routes: 500, operations: 5000, concurrency: 64 },
  { name: "single-agent-burst", agents: 1, routes: 1, operations: 5000, concurrency: 128 },
];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export function summarize(samples: number[]): LatencySummary {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.length ? sorted[sorted.length - 1] : 0,
    count: sorted.length,
  };
}

/**
 * Pick the first bottleneck from accumulated stage timings. The stage that
 * dominates total time is the one to fix first.
 */
export function identifyBottleneck(totals: StageTimings): Bottleneck {
  const entries: Array<[Bottleneck, number]> = [
    ["counter-store", totals.counterStoreMs],
    ["wal-fsync", totals.walFsyncMs],
    ["database", totals.databaseMs],
  ];
  const [name, value] = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
  return value > 0 ? name : "none";
}

function pickAgent(spec: MixSpec, i: number): string {
  return `agent-${i % spec.agents}`;
}

function pickRoute(spec: MixSpec, i: number): string {
  return `route-${i % spec.routes}`;
}

export async function runMix(client: MeterClientWithTimings, spec: MixSpec): Promise<MixResult> {
  const reserveSamples: number[] = [];
  const commitSamples: number[] = [];
  const stageTotals: StageTimings = { counterStoreMs: 0, walFsyncMs: 0, databaseMs: 0 };

  let issued = 0;
  const startedAt = Date.now();

  async function worker(): Promise<void> {
    while (issued < spec.operations) {
      const i = issued++;
      const input = { agentId: pickAgent(spec, i), route: pickRoute(spec, i), amount: 1 };

      const rStart = performance.now();
      await client.reserve(input);
      reserveSamples.push(performance.now() - rStart);

      const cStart = performance.now();
      await client.commit(input);
      commitSamples.push(performance.now() - cStart);

      const timings = client.lastStageTimings?.();
      if (timings) {
        stageTotals.counterStoreMs += timings.counterStoreMs;
        stageTotals.walFsyncMs += timings.walFsyncMs;
        stageTotals.databaseMs += timings.databaseMs;
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, spec.concurrency) }, () => worker());
  await Promise.all(workers);

  const durationMs = Date.now() - startedAt;
  return {
    name: spec.name,
    operations: spec.operations,
    concurrency: spec.concurrency,
    durationMs,
    throughputOpsPerSec: durationMs > 0 ? (spec.operations / durationMs) * 1000 : 0,
    reserve: summarize(reserveSamples),
    commit: summarize(commitSamples),
    bottleneck: identifyBottleneck(stageTotals),
  };
}

export async function runLoadTest(
  client: MeterClientWithTimings,
  mixes: MixSpec[] = DEFAULT_MIXES,
  budget: PerformanceBudget = PERFORMANCE_BUDGET,
): Promise<LoadTestReport> {
  const results: MixResult[] = [];
  for (const mix of mixes) {
    results.push(await runMix(client, mix));
  }

  const regressions: string[] = [];
  for (const r of results) {
    if (r.throughputOpsPerSec < budget.minThroughputOpsPerSec) {
      regressions.push(
        `${r.name}: throughput ${r.throughputOpsPerSec.toFixed(1)} ops/s < budget ${budget.minThroughputOpsPerSec}`,
      );
    }
    if (r.reserve.p99 > budget.maxReserveP99Ms) {
      regressions.push(
        `${r.name}: reserve p99 ${r.reserve.p99.toFixed(1)}ms > budget ${budget.maxReserveP99Ms}ms`,
      );
    }
    if (r.commit.p99 > budget.maxCommitP99Ms) {
      regressions.push(
        `${r.name}: commit p99 ${r.commit.p99.toFixed(1)}ms > budget ${budget.maxCommitP99Ms}ms`,
      );
    }
  }

  const withinBudget = results.filter(
    (r) => r.reserve.p99 <= budget.maxReserveP99Ms && r.commit.p99 <= budget.maxCommitP99Ms,
  );
  const saturationSource = (withinBudget.length ? withinBudget : results).reduce(
    (a, b) => (b.throughputOpsPerSec > a.throughputOpsPerSec ? b : a),
  );

  return {
    generatedAt: new Date().toISOString(),
    mixes: results,
    saturation: {
      throughputOpsPerSec: saturationSource.throughputOpsPerSec,
      mix: saturationSource.name,
      bottleneck: saturationSource.bottleneck,
    },
    budget,
    passed: regressions.length === 0,
    regressions,
  };
}

/**
 * CI gate: run the load test and exit non-zero on any budget regression.
 * Wire this into CI as `tsx packages/metering/load-test.ts --gate`.
 */
export async function gate(client: MeterClientWithTimings): Promise<number> {
  const report = await runLoadTest(client);
  if (report.passed) {
    console.log(
      `metering load test passed: ${report.saturation.throughputOpsPerSec.toFixed(1)} ops/s ` +
        `(${report.saturation.mix}), first bottleneck: ${report.saturation.bottleneck}`,
    );
    return 0;
  }
  console.error("metering load test regressions:");
  for (const r of report.regressions) console.error(`  - ${r}`);
  return 1;
}

function formatReport(report: LoadTestReport): string {
  const lines: string[] = [];
  lines.push(`metering load test @ ${report.generatedAt}`);
  for (const m of report.mixes) {
    lines.push(
      `${m.name}: ${m.throughputOpsPerSec.toFixed(1)} ops/s | ` +
        `reserve p50/p95/p99 ${m.reserve.p50.toFixed(1)}/${m.reserve.p95.toFixed(1)}/${m.reserve.p99.toFixed(1)}ms | ` +
        `commit p50/p95/p99 ${m.commit.p50.toFixed(1)}/${m.commit.p95.toFixed(1)}/${m.commit.p99.toFixed(1)}ms | ` +
        `bottleneck ${m.bottleneck}`,
    );
  }
  lines.push(
    `saturation: ${report.saturation.throughputOpsPerSec.toFixed(1)} ops/s (${report.saturation.mix}), ` +
      `first bottleneck: ${report.saturation.bottleneck}`,
  );
  lines.push(report.passed ? "budget: PASS" : `budget: FAIL\n${report.regressions.join("\n")}`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const asGate = args.includes("--gate");

  // The concrete client is provided by the metering package entrypoint.
  const { createMeterClient } = await import("./client");
  const client = createMeterClient() as MeterClientWithTimings;

  if (asGate) {
    process.exit(await gate(client));
  }

  const report = await runLoadTest(client);
  console.log(asJson ? JSON.stringify(report, null, 2) : formatReport(report));
  if (!report.passed) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
