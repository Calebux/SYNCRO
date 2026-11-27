# N+1 Query Audit — Analytics & Digest Builders

Issue: [#1095](https://github.com/Calebux/SYNCRO/issues/1095)

An audit of the code paths that compose **per-user summaries**. Each of them
looped over a set of users and issued a fresh round of queries per user, so
query volume scaled linearly with the user base. All of them now issue a fixed
number of queries per batch.

## How the counts were measured

`backend/src/utils/db-query-metrics.ts` exposes `measureQueries()`, which
temporarily wraps `supabase.from` and tallies the table round-trips a code path
performs:

```ts
const { result, metrics } = await measureQueries(() => service.getSummaries(userIds));
// metrics.total  → 2
// metrics.byTable → { subscriptions: 1, monthly_budgets: 1 }
```

`backend/tests/n-plus-one-queries.test.ts` runs each path for **1 user** and for
**50 users** and asserts the query count is identical, so a future regression
that reintroduces a per-user query fails CI.

## Before / after

`N` = number of users in the batch. Counts are per batch (or, for the digest
run, per 200-user page).

| Code path | Before | After | At N=50 |
| --- | --- | --- | --- |
| `buildMonthlySummaries` (`monthly-summary.ts`) | `3N` | `3` | 150 → **3** |
| `AnalyticsService.getSummaries` (`analytics-service.ts`) | `2N` | `2` | 100 → **2** |
| `AnalyticsService.checkBudgetThresholds` | `3N` | `4` | 150 → **4** |
| `checkBudgetAlertsForUsers` (`budget-alert-service.ts`) | `5N`–`8N` | `≤8` | up to 400 → **8** |
| `DigestService.runMonthlyDigest` (per page) | `1 + 4N` | `5` | 201 → **5** |

### What each path was doing

**`buildMonthlySummary`** issued three sequential queries per user — `users`,
`profiles`, `subscriptions`. `buildMonthlySummaries(userIds)` now runs those
three with `.in(...)` filters, in parallel, and fans the rows out in memory.
The single-user function delegates to it, so the two cannot drift.

**`AnalyticsService.getSummary`** issued a `subscriptions` and a
`monthly_budgets` query per user. `getSummaries(userIds)` batches both. The
summary composition itself was already pure once the rows were loaded — the
private `getMonthlyTrend` never touched the database despite taking a `userId`
and returning a promise, which is now fixed.

**`checkBudgetThreshold`** cost the two summary queries plus a de-duplication
read and an insert per user. `checkBudgetThresholds(userIds)` batches the
summaries, does one `.in(...)` de-duplication read, and writes all notifications
in a single insert.

**`checkBudgetAlerts`** was the worst offender: profile read, subscriptions
read, up to two `budget_alert_logs` reads, a notification insert, up to three
queries to resolve the team Slack webhook, and an alert-log upsert — all per
user, fanned out by the daily cron over every user with a budget. A 10k-user
deployment issued tens of thousands of queries per run.
`checkBudgetAlertsForUsers()` batches every one of those lookups, including
Slack webhook resolution, into at most 8 queries for the entire run. The cron in
`jobs/reminder-job.ts` calls the batched entry point directly.

**`DigestService.runMonthlyDigest`** paged over digest-enabled users and then,
per user, re-read the preferences it had *just fetched in the page query*, built
a summary (3 queries) and wrote one audit row. The page query now selects the
full preference columns, summaries are built for the whole page at once, and
`sendMonthlyDigestBatch` writes all `digest_audit_log` rows in a single insert.

## Notes

- **Batch sizes.** Callers page their user lists (`runMonthlyDigest` uses pages
  of 200) so the `.in(...)` filters stay a reasonable size. Passing an unbounded
  user list to a batch helper would trade an N+1 for an oversized query.
- **Email sending is still per-user** — that is inherent to SMTP, not a query
  problem. `sendMonthlyDigestBatch` bounds it to 5 concurrent sends.
- **Behaviour is unchanged.** The batched paths reproduce the original logic
  exactly, including the fall-through where a user who already received a
  `budget_exceeded` alert this month can still receive a `budget_warning`.
- **`digest-builder.ts`** held a second, unreferenced copy of
  `DigestEmailService` that had already drifted from the live one in
  `digest-email-service.ts`. It is now a re-export, so there is a single
  implementation to audit.

## Re-running the audit

```bash
cd backend
npx jest tests/n-plus-one-queries.test.ts
```

To profile a new code path, wrap it in `measureQueries()` and add a case that
compares the count at N=1 against N=50.
