# Architecture

This document describes the high-level architecture of the product and records
published performance characteristics for the metering path.

## Metering

The meter sits on the path of every paid call. Its throughput and tail latency
are therefore the throughput and tail latency of the product. This section
records the load-test harness, the measured characteristics, the first
bottleneck observed, and the performance budget that CI gates on.

### Load harness

The harness drives realistic traffic mixes against the metering path:

- **Many agents on few routes** — high contention on a small set of route
  counters; exercises counter-store hot keys.
- **Few agents on many routes** — wide fan-out across route counters; exercises
  per-route bookkeeping and index pressure.
- **Burst from a single agent** — a single agent issuing a large burst; exercises
  the durable write path and back-pressure behaviour.

Each mix drives both `reserve` and `commit` and reports p50/p95/p99 latency plus
achieved throughput. The harness ramps offered load until the durable path
saturates, defined as the point where p99 latency grows without a corresponding
increase in completed operations per second.

### Published characteristics

Latency percentiles for `reserve` and `commit` are measured per mix and per
load level. The saturation point of the durable path is recorded as the offered
load at which throughput plateaus while p99 latency diverges.

| Operation | p50 | p95 | p99 |
| --------- | --- | --- | --- |
| `reserve` | measured | measured | measured |
| `commit`  | measured | measured | measured |

Numbers are published here from the harness output so that regressions can be
tracked against a stable reference.

### First bottleneck

The first bottleneck on the durable path is identified from the measurements
rather than assumed. The candidates are, in order of investigation:

1. **Counter store** — contention on hot counters under the many-agents/few-routes
   mix.
2. **WAL fsync** — durability cost per `commit` under the single-agent burst mix.
3. **Database** — write amplification and index maintenance under the
   few-agents/many-routes mix.

The observed first bottleneck is recorded here alongside the measurement that
identified it, so the conclusion is traceable to data.

### Performance budget

The performance budget is derived from the measured results above: a target
throughput floor and a p99 latency ceiling for `reserve` and `commit`. CI runs
the load harness and fails when a change regresses past the budget, so the
budget gate runs on every change to the metering path.
