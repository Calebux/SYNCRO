/**
 * Metering load test runner.
 *
 * Usage:
 *   tsx load/run.ts                       # plain run
 *   tsx load/run.ts --budget              # enforce p99 budget
 *   tsx load/run.ts --budget --report load/budget.json
 *   tsx load/run.ts --budget --report load/budget.json --ci
 *
 * Flags:
 *   --budget            Enforce p99 thresholds from the budget file.
 *   --report <path>     Path to the budget/report JSON file.
 *   --ci                CI mode: non-zero exit on budget breach, terse output.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { createMetering } from "../src/index";

interface Budget {
  p99Ms?: number;
  p50Ms?: number;
  iterations?: number;
  concurrency?: number;
}

interface Args {
  budget: boolean;
  ci: boolean;
  reportPath: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    budget: false,
    ci: false,
    reportPath: resolve(process.cwd(), "load/budget.json"),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--budget") args.budget = true;
    else if (arg === "--ci") args.ci = true;
    else if (arg === "--report") {
      const next = argv[i + 1];
      if (next) {
        args.reportPath = resolve(process.cwd(), next);
        i++;
      }
    }
  }
  return args;
}

function loadBudget(path: string): Budget {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Budget;
  } catch (err) {
    throw new Error(`Failed to read budget file at ${path}: ${(err as Error).message}`);
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const budget: Budget = args.budget ? loadBudget(args.reportPath) : {};

  const iterations = budget.iterations ?? 1000;
  const concurrency = budget.concurrency ?? 10;

  const metering = createMetering();
  const latencies: number[] = [];

  const runOne = async (): Promise<void> => {
    const start = performance.now();
    const reservation = await metering.reserve({ units: 1 });
    await metering.commit(reservation.id);
    latencies.push(performance.now() - start);
  };

  let inFlight = 0;
  let started = 0;
  await new Promise<void>((resolveDone, rejectDone) => {
    const pump = (): void => {
      if (started >= iterations && inFlight === 0) {
        resolveDone();
        return;
      }
      while (inFlight < concurrency && started < iterations) {
        started++;
        inFlight++;
        runOne()
          .then(() => {
            inFlight--;
            pump();
          })
          .catch(rejectDone);
      }
    };
    pump();
  });

  latencies.sort((a, b) => a - b);
  const p50 = percentile(latencies, 50);
  const p99 = percentile(latencies, 99);

  const summary = {
    iterations,
    concurrency,
    p50Ms: Number(p50.toFixed(2)),
    p99Ms: Number(p99.toFixed(2)),
  };

  if (!args.ci) {
    console.log("metering load test", summary);
  }

  if (args.budget) {
    const breaches: string[] = [];
    if (typeof budget.p99Ms === "number" && p99 > budget.p99Ms) {
      breaches.push(`p99 ${summary.p99Ms}ms exceeds budget ${budget.p99Ms}ms`);
    }
    if (typeof budget.p50Ms === "number" && p50 > budget.p50Ms) {
      breaches.push(`p50 ${summary.p50Ms}ms exceeds budget ${budget.p50Ms}ms`);
    }
    if (breaches.length > 0) {
      console.error(`Budget breach:\n  ${breaches.join("\n  ")}`);
      process.exit(1);
    }
    if (!args.ci) {
      console.log("budget ok");
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
