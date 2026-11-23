# Architecture

This document describes the high-level architecture of the product and records
published performance characteristics for the metering path.

## Contract set

The on-chain footprint is exactly the set of crates in the `contracts/` Cargo
workspace. A crate is a member only if a v3 flow depends on it; retired crates
are removed from the workspace and their reserved error ranges recorded in
[`contracts/docs/retired-contracts.md`](../contracts/docs/retired-contracts.md).

| Crate | Role |
| --- | --- |
| `common` (`syncro-contract-common`) | Shared versioning and global error-code helpers (rlib; no WASM) |
| `virtual-card` | Non-custodial virtual card with scoped spend caps |
| `escrow` | Fund holding with arbiter-mediated dispute resolution |
| `payment-channel` | Off-chain payment channels with unilateral/cooperative close and watchtower |
| `agent-registry` | Authorized execution agents and their permission scopes |
| `resolver-registry` | Quorum-voting dispute arbitration for escrow cases |
| `payment-splitter` | Split a payment across N payers |
| `fee-collector` | Protocol fee collection |
| `fx-oracle` | Multi-signer FX rate oracle |
| `attestation` | Hashed KYC/compliance attestations |
| `guardian` | Protocol-wide emergency pause controls |
| `contract-upgrade` | Governance-gated contract upgrades |
| `zk-payment-verifier` | ZK payment-proof verifier (off every v3 settlement path; see ADR-017) |

`allowance`, `payment-adapter` and `stealth-announcement` are not members: they
have no v3 consumer and were retired in issue #1837. Spend caps live off-chain
(`backend/src/services/v3/spend-cap-service.ts`, `packages/metering`) and v3
privacy is off-chain, so neither needs a contract.

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

## Money-protecting flows

The happy path is drawn in the README. The flows that protect funds —
cooperative close, unilateral close, dispute with newer state, the escrowed
disputed window via `admit_disputed_window`, and the watchtower response — are
documented as Mermaid sequence diagrams under [`docs/sequences/`](sequences/):

- [Cooperative close](sequences/cooperative-close.md)
- [Unilateral close](sequences/unilateral-close.md)
- [Dispute with newer state](sequences/dispute-newer-state.md)
- [Escrowed disputed window (`admit_disputed_window`)](sequences/admit-disputed-window.md)
- [Watchtower response](sequences/watchtower-response.md)
