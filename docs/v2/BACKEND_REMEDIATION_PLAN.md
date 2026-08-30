# v2 Backend Remediation Plan — #1267, #1268, #1279, #1284

Implementation plan for four `v2-rewrite` / `priority:p1` backend issues. This
document is design-only: no behaviour changes ship with it. Each section states
what the code does **today** (with file references verified against `main` at
`b90f04f`), the target design, the migration order, and the tests that map
one-to-one onto the acceptance criteria in the issue.

| Issue | Title | Epic |
|-------|-------|------|
| [#1267](https://github.com/Calebux/SYNCRO/issues/1267) | Unified cache abstraction with Redis and in-process tiers | D — Backend architecture |
| [#1268](https://github.com/Calebux/SYNCRO/issues/1268) | Consolidate job files into one queue and scheduler abstraction | D — Backend architecture |
| [#1279](https://github.com/Calebux/SYNCRO/issues/1279) | Pluggable parser strategy with confidence scoring | E — Backend domain rewrites |
| [#1284](https://github.com/Calebux/SYNCRO/issues/1284) | Multi-provider exchange-rate quorum with circuit breaking | E — Backend domain rewrites |

---

## 0. Sequencing

These four are not independent. Two of them consume the cache abstraction, and
the FX work is much smaller once the cache exists:

```
#1267 cache abstraction ──┬──> #1284 FX quorum      (uses cache + circuit breaker)
                          └──> #1279 parser strategy (uses cache for merchant templates)

#1268 job runner ─────────────> (independent, but lands the Redis conventions
                                 #1267 also needs — do these two in parallel,
                                 same author, one shared `redis-client` change)
```

Recommended order: **#1267 → #1284 → #1279**, with **#1268** running in parallel.
Doing #1284 before #1267 means writing the two-tier + single-flight logic twice.

Each issue below is sized to land as 2–4 PRs. Do not attempt any of them as a
single PR; the migration steps are written as separable commits deliberately.

---

## 1. #1267 — Unified cache abstraction

### What exists today

Four independent caching implementations, no shared key format or TTL policy:

| Location | Storage | Key format | TTL | Redis-down behaviour |
|---|---|---|---|---|
| `backend/src/services/query-cache-service.ts` | Redis only | `query_cache:{ns}:{userId}:{sha256[:16]}` | `QUERY_CACHE_*_TTL_MS`, per call site | Bypass — `getClient()` returns `null`, `get` returns `null` |
| `backend/src/services/exchange-rate/exchange-rate-service.ts` | in-process `Map` + `RedisCacheAdapter` | `exchange-rates:{base}` | `EXCHANGE_RATE_TTL_MS`, default 15 min | Serve stale, then static rates |
| `backend/src/services/exchange-rate/redis-cache.ts` | Redis | own prefix | own SWR window + jitter | own metrics counter |
| `backend/src/services/api-latency-service.ts` | in-process `Map` only | `api_latency:` prefix declared but unused | 24 h window | n/a — never reaches Redis (`TODO(#698)` at `:68`) |

Consequences the issue is pointing at:

- `sharedRedisClient.getClient()` swallows connection failure and returns
  `null`, so **every** caller silently degrades to "no cache" — which is correct
  for query results and wrong for exchange rates, where the right answer is
  "serve the last known value and mark it stale".
- No single-flight anywhere. `ExchangeRateService.scheduleBackgroundRevalidation`
  has a `revalidating` Set that is a hand-rolled single-flight for one specific
  path; concurrent cold misses in `query-cache-service` all hit the database.
- `api-latency-service.ts:68` has both branches of its `if` calling
  `recordToMemory` — the Redis branch is a placeholder. This is tracked as row
  `#698` in `DEBT.md`.

### Target design

One module, `backend/src/lib/cache/`, and it becomes the only place caching
touches Redis.

```ts
// backend/src/lib/cache/types.ts

/** How a namespace behaves when Redis is unreachable. */
export type DegradeMode =
  | 'bypass'       // skip the cache, call upstream every time (query results)
  | 'serve-stale'  // return the last in-process value with an age (FX rates)
  | 'fail';        // throw — the caller cannot proceed without the cache

export interface NamespaceSpec<T> {
  /** First key segment. Must be unique across the app. */
  readonly name: string;
  /** Fresh window. */
  readonly ttlMs: number;
  /** How long past `ttlMs` a value may still be served while revalidating. */
  readonly staleWhileRevalidateMs: number;
  readonly degradeMode: DegradeMode;
  /** In-process LRU entry cap for this namespace. 0 disables the L1 tier. */
  readonly maxLocalEntries: number;
  /** Runtime validation — a value that fails is treated as a miss. */
  readonly validate: (raw: unknown) => T | null;
}

export interface CacheEntry<T> {
  value: T;
  /** Epoch ms of the write that produced this value. */
  storedAt: number;
  ageMs: number;
  /** True when `ageMs > ttlMs` — served under the SWR window. */
  stale: boolean;
  source: 'local' | 'redis' | 'upstream';
}

export interface Cache<T> {
  /** Read-through with single-flight. `loader` runs at most once per key. */
  getOrLoad(key: string, loader: () => Promise<T>): Promise<CacheEntry<T>>;
  /** Read without falling through to a loader. */
  peek(key: string): Promise<CacheEntry<T> | null>;
  set(key: string, value: T): Promise<void>;
  invalidate(key: string): Promise<void>;
  /** Namespace-wide invalidation, cursor-based like the existing SCAN loop. */
  invalidatePrefix(prefix: string): Promise<void>;
}
```

Key construction is centralised so no call site builds a key by hand:

```
syncro:v1:{namespace}:{...segments}
```

`v1` is a global epoch. Bumping it invalidates every namespace at once — the
escape hatch for a bad deploy, and cheaper than a `SCAN`-and-delete sweep.

Namespaces are declared in one file, which is where the TTL documentation lives:

```ts
// backend/src/lib/cache/namespaces.ts
export const NAMESPACES = {
  subscriptionList: defineNamespace<Subscription[]>({
    name: 'subscription-list',
    ttlMs: envMs('QUERY_CACHE_SUBSCRIPTION_LIST_TTL_MS', 60_000),
    staleWhileRevalidateMs: 0,
    degradeMode: 'bypass',        // correctness beats latency for user data
    maxLocalEntries: 0,           // per-user, low reuse — L1 would just waste heap
    validate: parseSubscriptionList,
  }),
  analytics:     /* ttl 5m,  bypass,      L1 0    */,
  exchangeRates: /* ttl 15m, serve-stale, L1 32,  swr 6h */,
  merchantMeta:  /* ttl 24h, serve-stale, L1 512, swr 7d */,
  apiLatency:    /* ttl 24h, bypass,      L1 256  */,
} as const;
```

Two tiers, L1 in front of L2:

- **L1** — per-process LRU with `maxLocalEntries` per namespace. Skipped when
  `maxLocalEntries: 0`. Per-user namespaces get 0 because hit rate is near zero
  and the heap cost is not.
- **L2** — Redis via `sharedRedisClient`, storing the envelope
  `{ v: 1, storedAt, value }` so `ageMs` survives a process restart.
  `EX` is set to `ttlMs + staleWhileRevalidateMs`, so Redis expiry is the
  outer bound and freshness is decided from `storedAt`, not from key existence.
  This is what makes `serve-stale` possible at all.

**Single-flight** is a per-process `Map<string, Promise<T>>` held for the
duration of `loader`. Cross-process single-flight (a Redis lock) is deliberately
out of scope: `backend/src/lib/redis-lock.ts` already exists for the cases that
need it, and taking a lock on every cache miss costs more than the duplicate
upstream call it prevents. Document this choice in the module header — it is the
first thing a reviewer will ask about.

**Degradation** is decided by the namespace, not by the call site:

| `degradeMode` | Redis down | L1 hit, stale | No value anywhere |
|---|---|---|---|
| `bypass` | call `loader` every time | ignore, call `loader` | call `loader` |
| `serve-stale` | serve L1 with `stale: true` | serve, revalidate in background | call `loader`; if that throws, rethrow |
| `fail` | throw `CacheUnavailableError` | serve, revalidate | call `loader` |

Metrics are emitted once, in the module, tagged by namespace:
`cache_hit_total{namespace,tier}`, `cache_miss_total{namespace}`,
`cache_stale_served_total{namespace}`, `cache_single_flight_joined_total{namespace}`,
`cache_degraded_total{namespace,mode}`.

### Migration

1. **Land `backend/src/lib/cache/` with tests, wired to nothing.** Reviewable in
   isolation; no runtime risk.
2. **Migrate `query-cache-service.ts`.** Keep the exported
   `queryCacheService` shape as a thin facade over `NAMESPACES.subscriptionList`
   / `.analytics` so no route changes in this PR. Preserve the existing key
   format behind a `legacyKey` option for one release so a deploy does not cold-
   start every user's cache, then drop it.
3. **Migrate exchange rates.** Delete `exchange-rate/redis-cache.ts`; its SWR,
   jitter and metrics are all now namespace config. `ExchangeRateService` loses
   its private `Map`, its `revalidating` Set and `parseRedisRates`. This PR is
   the natural predecessor to #1284.
4. **Migrate merchant metadata** (`services/merchant-service.ts`, plus the
   `TemplateCache` in `services/llm-template-cache.ts` if it proves to be the
   same shape — check before assuming).
5. **Resolve `#698`.** Point `api-latency-service.recordLatency` at
   `NAMESPACES.apiLatency`, delete the `TODO(#698)` comment, delete the dead
   `REDIS_KEY_PREFIX` field, and remove the row from `DEBT.md`. Note the
   percentile computation currently only reads `memoryStore`, so
   `getLatencyMetrics` must be updated to merge across instances or explicitly
   documented as per-instance — decide this in the PR, do not leave it implicit.

### Tests → acceptance criteria

| Criterion | Test |
|---|---|
| One cache module is the only place Redis is used for caching | Lint rule or `grep` test asserting `sharedRedisClient` is imported only by `lib/cache/`, `lib/redis-lock.ts`, `lib/redis-store.ts` |
| Namespaced keys with documented TTLs | Unit test over `NAMESPACES` asserting every entry has a non-zero `ttlMs` and a doc comment; snapshot the generated key for each namespace |
| Single-flight | Fire 50 concurrent `getOrLoad` for one key against a counting loader; assert loader called exactly once and all 50 resolve to the same value |
| Redis-down behaviour explicit per namespace | Table-driven test over all three `DegradeMode`s with a stubbed client that throws |
| `#698` resolved | Assert no `TODO(#698)` remains in `backend/src`; assert `DEBT.md` has no `#698` row |

Add a test for the case that will actually break in production: Redis returns a
value that no longer matches `T` after a deploy. `validate` must turn it into a
miss, not a runtime `TypeError` three layers up.

---

## 2. #1268 — One job contract and runner

### What exists today

Ten files in `backend/src/jobs`, plus a parallel scheduler in
`backend/src/services/scheduler.ts` holding **16 more** `cron.schedule` calls.
Every one has its own try/catch, its own logging, and its own idea of failure.

| File | Schedule(s) | Mechanism | Wired in `index.ts`? |
|---|---|---|---|
| `reminder-job.ts` | `0 0 *`, `0 8 *`, `0 9 *`, `*/30`, `0 10 *` | `node-cron`, **at module load** | **No** |
| `notification-queue.ts` | event-driven | **BullMQ** `Queue` + `Worker` | yes (via routes / shutdown) |
| `settlement-batch-job.ts` | `*/2 * * * *` | `node-cron` | yes |
| `channel-monitor-job.ts` | `0 * * * *` | `node-cron` | yes |
| `channel-settlement-job.ts` | `0 2 * * *` | `node-cron` | yes |
| `stealth-scan-job.ts` | `* * * * *` | `node-cron` | yes |
| `csp-monitoring-job.ts` | `*/5`, `*/5`, `0 2 *` | `node-cron`, `scheduled: false` | **No** |
| `job-alert-monitor.ts` | (see file) | `node-cron` | yes |
| `auto-resume.ts` | `0 6 * * *` | `node-cron` | yes |
| `webhook-retry-job.ts` | `* * * * *` | `node-cron` | yes |

Two findings worth pulling out before designing anything, because they are bugs
today and the migration must not preserve them:

- **`reminder-job.ts` is not imported anywhere.** It duplicates three schedules
  that `scheduler.ts` already runs (`0 9` process reminders, `*/30` retries,
  `0 8`/`0 0` scheduling). If anyone ever adds the import, reminders fire twice.
  It also registers cron as an import side effect, so importing it for a unit
  test starts real timers.
- **`csp-monitoring-job.ts` is not imported either** — `startCspMonitoringJobs()`
  is never called, so CSP stats refresh, alert checks and the 90-day cleanup do
  not run in production. Confirm against a deployed instance before treating
  this as a migration task; it may need its own issue.

Beyond that: `scheduler.ts` runs **16 cron jobs on every instance**. Any
multi-instance deploy runs the monthly digest, hard deletes and retention purge
once per replica. `renewalLockService` and `idempotencyService` protect some
paths, but that is per-feature, not a property of the scheduler.

### Target design

```ts
// backend/src/jobs/contract.ts

export interface JobContext {
  jobName: string;
  runId: string;
  correlationId: string;
  logger: Logger;
  /** Cooperative cancellation — long jobs must check this. */
  signal: AbortSignal;
}

export interface JobDefinition<P = void> {
  /** Stable identifier. Also the BullMQ queue/job name and the metric label. */
  readonly name: string;
  /** Cron expression for scheduled jobs; omit for purely event-driven ones. */
  readonly schedule?: string;
  readonly timezone?: string;           // default 'UTC'
  /** Max simultaneous executions across all workers. */
  readonly concurrency: number;
  readonly timeoutMs: number;
  readonly retry: {
    attempts: number;
    backoff: { type: 'exponential' | 'fixed'; delayMs: number };
  };
  /**
   * Stable key for at-most-once side effects. For scheduled jobs this MUST
   * include the tick (e.g. `digest:2026-08`), never `Date.now()`.
   */
  readonly idempotencyKey: (payload: P) => string;
  readonly deadLetter: 'notification' | 'renewal' | 'none';
  /** Feature flag. Evaluated per run, so a flag flip takes effect immediately. */
  readonly enabled?: () => boolean;
  run(payload: P, ctx: JobContext): Promise<void>;
}
```

One runner over BullMQ — already a dependency (`bullmq@^5.79.1`), already used
by `notification-queue.ts`, and `@bull-board/express` is already mounted at
`routes/admin-queues.ts`, so the migration inherits a working dashboard.

```ts
// backend/src/jobs/runner.ts
export class JobRunner {
  register<P>(def: JobDefinition<P>): void;
  /** Creates queues, workers and repeatable jobs for everything registered. */
  async start(): Promise<void>;
  async stop(): Promise<void>;      // drain, then close — hook into graceful-shutdown.ts
  /** Manual trigger for admin routes and tests. */
  async trigger<P>(name: string, payload: P): Promise<string>;
}
```

Three properties the runner owns, so no job implements them again:

1. **Scheduling happens once per cluster, not once per instance.** BullMQ
   repeatable jobs are stored in Redis and produced by whichever instance holds
   the scheduler — this is the mechanism that fixes the 16-jobs-per-replica
   problem. Register with a deterministic `jobId` derived from
   `idempotencyKey`, so two instances enqueueing the same tick collapse to one.
2. **Idempotency across restarts.** Before `run`, `SET syncro:v1:job-run:{key}
   NX EX <window>`. If the key exists, the run is skipped and counted as
   `skipped_duplicate`, not as a success. The window must exceed the job's
   period. This is what makes the criterion "at-most-once side effects per
   idempotency key" testable.
3. **Uniform observability.** The runner emits, for every job, with a `job`
   label: `job_started_total`, `job_succeeded_total`, `job_failed_total`,
   `job_duration_seconds`, `job_retries_total`, `job_dead_lettered_total`. It
   also calls `jobAlertService.recordJobOutcome(name, ok, err)` centrally —
   today only some jobs do, which is why `config/job-alert-config.ts` cannot
   cover them all.

Dead-lettering routes through the existing
`services/notification-dead-letter-service.ts`, whose consumer routes stay
unchanged. Generalise its payload column to a `job_name` + opaque JSON rather
than adding a second dead-letter table.

### Migration

Do **not** migrate ten jobs in one PR.

1. Land `contract.ts` + `runner.ts` + tests, registered with zero jobs.
2. Migrate `notification-queue.ts` first — it is already BullMQ, so this
   validates the contract against the hardest case (custom backoff, non-
   retryable 410/404 discard, dead-letter on exhaustion) with the least risk.
3. Migrate the six simple cron jobs one PR at a time, deleting the bespoke
   `start*Job`/`stop*Job` pair and its `index.ts` wiring in the same commit.
   `runWithCorrelationId` moves into the runner; jobs stop calling it.
4. **Delete `reminder-job.ts`** rather than migrating it — its schedules are
   already live in `scheduler.ts`. Migrate the `scheduler.ts` versions instead.
   Call this out explicitly in the PR description; a reviewer seeing a deleted
   job file will otherwise assume a regression.
5. Resolve `csp-monitoring-job.ts` — confirm it is genuinely dead, then either
   register it properly or delete it. Do not migrate a job that has never run
   without deciding which.
6. Migrate the 16 schedules in `scheduler.ts`, then delete the file and its
   `getStatus()` consumer at `index.ts:312` (replace with `runner.status()`).

### Tests → acceptance criteria

| Criterion | Test |
|---|---|
| All jobs declared through the shared contract | Test asserting `jobs/registry.ts` exports every job and that no `cron.schedule` call remains in `backend/src` outside `runner.ts` |
| Uniform metric set | For each registered job, run it through the runner with a stub and assert all six metrics are emitted with the `job` label |
| Uniform dead-lettering | Force a job past `retry.attempts`; assert one row lands via `notificationDeadLetterService` with the job name, and that the existing dead-letter route returns it |
| Runs once per interval, not once per instance | Start three `JobRunner`s against one Redis (`ioredis-mock` or a container), advance to one tick, assert the handler ran exactly once |
| At-most-once across restarts | Run a job, kill the runner mid-`run`, restart within the idempotency window, assert the side effect happened once |

The multi-instance test is the one that matters and the one most likely to be
skipped as "hard to set up". Budget for it explicitly; without it this issue's
central claim is unverified.

---

## 3. #1279 — Parser strategy with confidence scoring

### What exists today

Routing between parsers is a hardcoded threshold inside one function.
`parseSubscriptionEmailWithFallback` (`services/email-parser.ts:79`):

```ts
const regexResult = parseSubscriptionEmail(input);
if (regexResult && regexResult.confidence >= 0.9) return regexResult;   // (a)
if (!llmParser.isAvailable) return regexResult;
const llmResult = await llmParser.parse(combined, context);
if (!regexResult || llmResult.confidence > regexResult.confidence) { ... }
```

Problems this creates, all of them consequences of confidence being an
undocumented number rather than a contract:

- **The regex path can never reach 0.9.** Summing the additive boosts in
  `parseSubscriptionEmail` gives at most `0.2 + 0.2 + 0.2 + 0.2 + 0.1 + 0.15 =
  1.05`, capped to `0.95` — but the `+0.15` requires a normalised merchant that
  differs from the raw sender, and hitting every other boost simultaneously is
  rare. In practice line (a) almost never short-circuits, so the LLM is called
  for nearly every email. That is the cost problem #1279 is really about.
- **The two confidence scales are not comparable.** The heuristic score is a sum
  of hand-tuned constants; the LLM's is self-reported by Gemini. Comparing them
  with `>` is meaningless, but that comparison decides which result wins.
- **There is no low-confidence path.** Whatever comes back is returned, and the
  caller creates a subscription. `email-scanner.ts` carries `confidence` through
  to `audit_logs` but nothing branches on it.
- **A third parser is not in the pipeline at all.**
  `subscription-classifier.ts` runs its own rule → DB cache → Claude Haiku
  ladder for *category*, with a separate `'high' | 'medium' | 'low'` confidence
  enum. Two confidence vocabularies in one subsystem.
- **No known-merchant template strategy exists.** `merchant-normalizer` only
  canonicalises the name; there is no per-merchant extraction template, which is
  the cheapest and most accurate strategy and the one the issue asks for first.

### Target design

```ts
// backend/src/services/parsing/strategy.ts

export interface ParseEvidence {
  /** What in the input supported this field — a matched phrase, a template id. */
  readonly field: keyof ParsedSubscriptionFields;
  readonly reason: string;
  readonly excerpt?: string;   // ≤80 chars, never the full body (privacy contract)
}

export interface StrategyResult {
  readonly strategy: StrategyName;
  readonly fields: Partial<ParsedSubscriptionFields>;
  /**
   * Calibrated probability that `fields` is correct. NOT a heuristic sum —
   * see "Calibration" below. Strategies that cannot calibrate return their
   * band's floor.
   */
  readonly confidence: number;
  readonly evidence: ParseEvidence[];
  /** Cost actually incurred, for budget attribution. Zero for free strategies. */
  readonly cost: { tokens: number; usd: number };
}

export interface ParserStrategy {
  readonly name: StrategyName;
  /** Ordering key. Lower runs first. Ties broken by declaration order. */
  readonly costRank: number;
  /** Cheap pre-check — skip the strategy entirely when it cannot apply. */
  canHandle(input: ParseInput): boolean;
  parse(input: ParseInput, ctx: ParseContext): Promise<StrategyResult | null>;
}

export type StrategyName = 'merchant-template' | 'heuristic-regex' | 'llm';
```

Three strategies, run cheapest first:

| `costRank` | Strategy | Source | Typical confidence |
|---|---|---|---|
| 0 | `merchant-template` | new: per-merchant extraction templates keyed off `merchant-normalizer`'s canonical name | 0.95–0.99 |
| 1 | `heuristic-regex` | existing `parseSubscriptionEmail`, rescored | 0.4–0.85 |
| 2 | `llm` | existing `llmParser`, unchanged internals | 0.6–0.9 |

The orchestrator replaces the ad-hoc `if` chain:

```ts
// backend/src/services/parsing/orchestrator.ts
export async function parseEmail(
  input: ParseInput,
  ctx: ParseContext,
): Promise<ParseOutcome> {
  const results: StrategyResult[] = [];

  for (const strategy of STRATEGIES) {          // sorted by costRank
    if (!strategy.canHandle(input)) continue;

    const result = await strategy.parse(input, ctx);
    if (result) results.push(result);

    // The escalation gate: stop as soon as we are confident enough.
    if (result && result.confidence >= THRESHOLDS.accept) break;
  }

  return decide(results);
}
```

**Precedence.** Not "highest confidence wins" — that is the current bug. Merge
field-by-field, preferring the lowest `costRank` result whose confidence for the
overall parse clears `THRESHOLDS.field`. A cheap strategy that is confident about
`amount` but silent about `interval` should contribute `amount` and let the LLM
supply `interval`. Record which strategy supplied each field.

**Thresholds**, in one config object, not scattered as literals:

```ts
export const THRESHOLDS = {
  accept:  0.85,   // create a subscription; stop escalating
  suggest: 0.50,   // create a suggestion for user confirmation
  discard: 0.50,   // below this: not a subscription email, log and drop
  field:   0.60,   // minimum for a single field to be taken from a strategy
} as const;
```

**Calibration** is the part that makes the numbers mean something. The current
additive scoring is uncalibrated, so any threshold on it is arbitrary. Before
picking the numbers above, take the parser corpus added in `777b999` and:

1. Label a held-out set of emails with ground-truth fields.
2. Bucket each strategy's raw score into deciles and measure actual precision
   per decile.
3. Fit the raw score to observed precision (isotonic regression, or a lookup
   table if the corpus is small — a table is fine and easier to review).
4. Assert in CI that observed precision at `>= accept` stays above the target
   (e.g. 0.95). This is what stops the threshold from silently rotting as
   prompts and merchants change.

Ship the table; treat the numbers above as placeholders until it exists.

**Low-confidence routing.** Between `suggest` and `accept`, write to a
suggestions table instead of `subscriptions`:

```sql
create table subscription_suggestions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  source_message_id text,
  parsed_fields  jsonb not null,
  strategy       text  not null,
  confidence     numeric(4,3) not null,
  evidence       jsonb not null,
  status         text  not null default 'pending',   -- pending|accepted|rejected
  created_at     timestamptz not null default now(),
  unique (user_id, source_message_id)
);
```

RLS mirroring `subscriptions`. The `unique` constraint makes rescans idempotent.
Accepting a suggestion is the only path from suggestion to subscription, and it
records the acceptance as a labelled training example — this is how the corpus
grows without a manual labelling effort.

**Auditability.** Add `parse_strategy`, `parse_confidence` and `parse_evidence`
to `subscriptions` for rows created by email parsing (nullable; manual entries
leave them null). The issue's fourth criterion is exactly this. Note that
`email-scanner.ts` is a privacy boundary — its `metadataExtractionOnly`
whitelist must be extended for the new fields or they will be silently stripped,
and `evidence.excerpt` must stay bounded so no body content crosses that line.

**Classifier alignment.** `subscription-classifier.ts` keeps its own pipeline
(it answers a different question) but adopts the numeric scale, so
`'high' | 'medium' | 'low'` stops being a second vocabulary. One mapping
function, one place.

### Migration

1. Land `parsing/strategy.ts` + orchestrator + the three strategy adapters,
   wrapping today's code unchanged. Behaviour-preserving: thresholds set so the
   outcome matches current routing. Land the calibration harness alongside.
2. Build the calibration table from the corpus; set real thresholds; this is the
   PR where accuracy actually moves. Include a before/after table on the corpus.
3. Add `merchant-template` for the top merchants by volume (measure first — do
   not guess the list). This is where the LLM call rate drops.
4. Add the suggestions table, RLS, routes and the accept/reject flow.
5. Add the audit columns and extend the `email-scanner` whitelist.

### Tests → acceptance criteria

| Criterion | Test |
|---|---|
| All paths implement one interface and return confidence | Type-level: `STRATEGIES` is `readonly ParserStrategy[]`; runtime test that every result has `confidence` in `[0,1]` and non-empty `evidence` |
| Cost order, LLM only below threshold | Spy on `llmParser.parse`; a known-merchant email must not call it. Assert call count is 0 for the template corpus |
| Below threshold → suggestion, not subscription | Feed a deliberately ambiguous email; assert a `subscription_suggestions` row and zero `subscriptions` rows |
| Strategy and confidence recorded | Assert every parser-created subscription has non-null `parse_strategy` / `parse_confidence` |
| Calibration holds | CI test over the held-out set: precision at `confidence >= accept` ≥ target, else fail |

---

## 4. #1284 — FX quorum and circuit breaking

### What exists today

`ExchangeRateService.fetchFromProviders` (`exchange-rate-service.ts:287`):

```ts
for (const provider of this.providers) {
  try {
    const rates = await provider.getRates(baseCurrency);
    Object.assign(allRates, rates);      // ← last writer wins
  } catch (error) { errors.push(err); }
}
if (Object.keys(allRates).length === 0) throw new AggregateError(...);
```

`Object.assign` is the whole problem. `FiatRateProvider` (ExchangeRate-API) and
`FrankfurterProvider` (ECB) both return overlapping fiat pairs, and both declare
`supportsCurrency` over the same `SUPPORTED_FIAT` set — so the second provider
silently overwrites the first. Two independent sources are already being
fetched and the result is *last wins* rather than *cross-check*. That is a
one-line-shaped bug with a real user-facing consequence.

Alongside it:

- **No sanity bounds.** A provider returning `0` for a currency propagates into
  `getRate`, where `if (!fromRate || !toRate) throw` catches exactly zero but
  not `0.0001` or a 50× jump. `CryptoRateProvider` already guards `priceInBase > 0`
  before inverting; nothing else does.
- **No circuit breaker.** Every request retries a dead provider in-line.
  `ExternalServiceClient` may have retry/timeout — verify what it provides
  before building a second breaker on top of it.
- **Partial results are indistinguishable from complete ones.** If Frankfurter
  returns 30 pairs and ExchangeRate-API times out, the merged map is stored with
  `fetchedAt = now` and reported as `source: 'live'`.
- **Staleness plumbing already exists and is good.** `ExchangeRateResponse`
  carries `cachedAt`, `ageMs`, `stale`, `source`, and `routes/exchange-rates.ts`
  lifts them into `meta`. Extend this, do not rebuild it.

### Target design

Per-currency-pair, not per-provider-response. Rates are validated one pair at a
time, because that is the granularity at which providers disagree.

```ts
// backend/src/services/exchange-rate/quorum.ts

export interface ProviderQuote {
  provider: string;
  rate: number;
  fetchedAt: number;
}

export type QuorumOutcome =
  | { status: 'agreed';     rate: number; sources: string[]; spread: number }
  | { status: 'tiebreak';   rate: number; sources: string[]; spread: number; rule: TiebreakRule }
  | { status: 'rejected';   reason: RejectReason; quotes: ProviderQuote[] };

export type RejectReason =
  | 'no-quotes'
  | 'single-source'        // only one provider responded, policy requires two
  | 'disagreement'         // spread beyond tolerance, no tiebreak applied
  | 'implausible-value'    // zero, negative, non-finite, or out of absolute bounds
  | 'implausible-jump';    // beyond MAX_MOVE_PCT from last accepted
```

**Agreement.** For each currency, collect one quote per provider.
Relative spread `= (max - min) / median`. Accept when
`spread <= TOLERANCE_PCT` (start at 0.5% for fiat, 2% for crypto — crypto is
genuinely more volatile between sources and a shared tolerance will either
reject good crypto rates or accept bad fiat ones). Accepted rate is the
**median**, not the mean: median is robust to one provider being wrong, which is
the exact failure being defended against.

**Tiebreak**, applied in order and always recorded on the result:

1. Prefer the quote from the higher-trust provider tier (ECB/Frankfurter over
   aggregators) when exactly two disagree.
2. If a last-accepted rate exists, take the quote closest to it — a provider
   agreeing with history is more likely correct than one making a large move.
3. Otherwise reject and keep the previous value.

**Plausibility**, checked before quorum, per quote:

```ts
if (!Number.isFinite(rate) || rate <= 0)             reject('implausible-value');
if (rate < ABS_MIN || rate > ABS_MAX)                reject('implausible-value');
if (last && Math.abs(rate - last) / last > MAX_MOVE) reject('implausible-jump');
```

`MAX_MOVE` must scale with the age of the last accepted rate — a 10% bound is
right for 15 minutes and wrong after a two-day outage. Use
`MAX_MOVE_PCT * max(1, ageHours)` capped at some ceiling, and make it per-asset-
class. Rejected quotes are logged with the provider name and never stored;
the previous accepted value is kept.

**Circuit breaker**, one per provider, three states:

| State | Behaviour | Transition |
|---|---|---|
| `closed` | calls pass through | 5 consecutive failures, or ≥50% failures over 20 calls → `open` |
| `open` | fail fast, no network call | after `cooldownMs` (start 60s, exponential to 15 min) → `half-open` |
| `half-open` | one probe call allowed | success → `closed`; failure → `open`, longer cooldown |

Breaker state lives in the process; **do not** put it in Redis. Provider health
is genuinely per-instance (an instance may have its own network problem), and
sharing the state means one bad instance opens the breaker for all of them.
Emit `fx_provider_state{provider,state}` so the divergence is visible.

**Staleness.** Extend `ExchangeRateResponse` per-currency rather than only
per-response, since after a partial outage different currencies have different
ages:

```ts
export interface RateDetail {
  rate: number;
  sources: string[];
  quorum: 'agreed' | 'tiebreak' | 'last-known-good' | 'static';
  fetchedAt: string;
  ageMs: number;
  stale: boolean;
}
export interface ExchangeRateResponse {
  base: string;
  rates: Record<string, number>;        // kept for backwards compatibility
  details: Record<string, RateDetail>;  // new
  cachedAt: string | null;
  ageMs: number | null;
  stale: boolean;                       // true if ANY rate is stale
  source: 'live' | 'stale-cache' | 'static-fallback';
}
```

Keeping the flat `rates` map means no client breaks; `details` is additive.
`routes/exchange-rates.ts` already surfaces `stale` in `meta` — extend `meta`
with a `staleCurrencies: string[]` so the UI can label individual figures rather
than the whole dashboard.

**Never fall back to zero.** The precedence chain, explicitly, and this is the
core of the issue: quorum → tiebreak → last-known-good (any age, marked stale) →
static rates (marked `quorum: 'static'`) → omit the currency entirely. A missing
currency that the UI renders as "unavailable" is correct; a zero that renders as
"$0.00 spend" is a silent data corruption bug.

### Migration

1. Land `quorum.ts` + `plausibility.ts` + `circuit-breaker.ts` as pure functions
   with tests. No wiring. Pure functions here means the disagreement and
   implausible-value cases are table-driven tests, not integration tests.
2. Replace `Object.assign` in `fetchFromProviders` with per-currency quorum,
   behind `FX_QUORUM_ENABLED`. Log what the old path *would* have returned
   versus the new one for one release, then flip the default. This shadow period
   is worth it — it tells you the real disagreement rate before quorum can
   reject anything in production.
3. Add a third independent provider. Two providers can only ever detect
   disagreement, never resolve it, so every disagreement falls to tiebreak.
   Three gives a real median. Pick one with a different upstream than ECB.
4. Wire the circuit breaker; delete any now-redundant retry in
   `ExternalServiceClient` for this call path (check first).
5. Extend the response type and the route `meta`; update the client's converted-
   total rendering to read `staleCurrencies`.
6. Persist rejections to `exchange_rate_history` with `source: 'rejected'` plus
   the reason — `storeHistoricalRate` already writes there, and this makes
   provider misbehaviour queryable after the fact instead of log-only.

Depends on #1267 for the cache tier; if #1267 slips, `RedisCacheAdapter` still
works and the quorum logic is independent of it.

### Tests → acceptance criteria

| Criterion | Test |
|---|---|
| Accepted only on agreement or documented tiebreak | Table test: two providers within tolerance → `agreed` with median; beyond tolerance → `tiebreak` with the rule named, or `rejected` |
| Zero/negative/implausible rejected and never stored | Feed `0`, `-1`, `NaN`, `Infinity`, and a 50× jump; assert `rejected`, assert the previous value is still returned, assert nothing was written |
| Every rate carries source and age | Assert `details[c].sources.length >= 1` and a numeric `ageMs` for every returned currency |
| Outage degrades to last-known-good, not zero | Stub all providers to throw; assert previous rates returned with `stale: true` and `quorum: 'last-known-good'`; assert no rate is `0` |
| Disagreement / outage / implausible covered | The three above, plus a breaker test: 5 failures → `open`, no network call while open, one probe after cooldown |

Add a regression test naming the current bug directly: two providers returning
different values for `EUR` must not resolve to "whichever ran last". That test
fails on `main` today.

---

## 5. Cross-cutting notes

**Feature flags.** Every one of these is a behaviour change to a live path. Each
should land behind a flag (`CACHE_V2_ENABLED`, `JOB_RUNNER_V2_ENABLED`,
`PARSER_STRATEGY_ENABLED`, `FX_QUORUM_ENABLED`) with the old path deletable one
release later. `#1357` (strict zod env config) is in flight — declare these
there rather than reading `process.env` directly.

**`DEBT.md`.** #1267 removes the `#698` row. If any of this work leaves a
`TODO` on a critical path it must be added to the registry with an issue number,
or the `debt-policy.yml` CI job will block the PR.

**Documentation.** `docs/JOB_FAILURE_RUNBOOK.md` and
`docs/ops/notification-queue-runbook.md` both describe the current per-job
behaviour and go stale the moment #1268 lands. Update them in the same PR as the
runner, not afterwards.

**ADRs.** `#1359` adopted an ADR format with one existing record
(`docs/adr/ADR-001-frontend-backend-split.md`). The cache degrade-mode policy
(#1267) and the FX precedence chain (#1284) are both durable cross-cutting
decisions and should get ADRs; the other two are implementation choices and
should not.

**What this plan does not settle.** Three things need a decision from someone
with production data, and each will otherwise be guessed at during
implementation:

1. The parser confidence thresholds (§3) are placeholders until the calibration
   table exists. Do not merge them as constants.
2. Whether `csp-monitoring-job.ts` is genuinely dead in production (§2), or
   started somewhere this survey did not find.
3. The FX tolerance percentages (§4), which need the shadow-mode disagreement
   rate before they can be set honestly.
