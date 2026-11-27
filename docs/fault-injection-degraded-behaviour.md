# Fault Injection & Degraded Behaviour (#92)

Documents the intentional degraded behaviour for each external dependency and the alert conditions for unrecoverable states.

## External Dependencies

| Dependency | Used For | Failure Mode | Degraded Behaviour | Alert? |
|---|---|---|---|---|
| Supabase (PostgreSQL) | All data persistence | Network error, timeout, RLS rejection | Throw structured error; surface to caller | Yes – unrecoverable |
| Redis | Rate limiting | ECONNREFUSED, timeout | Fail open (allow request); fall back to in-memory | No – transient |
| Stripe | Payment processing | Timeout, 5xx, card declined | Timeout/5xx: retry + alert; card declined: surface to user | Yes – on 5xx/timeout |
| Stellar/Soroban | Blockchain sync | RPC unavailable | Database-first: DB write succeeds, blockchain sync retried async | No – retried |
| Web Push | Push notifications | 410 Gone, 5xx | 410: remove subscription; 5xx: retry up to 3× | No |
| Nodemailer (SMTP) | Email notifications | SMTP error | Retry with backoff; mark delivery as failed after max attempts | No |

## Degraded Behaviour Details

### Supabase Down
- All API endpoints that require data return 500 with a generic error message (no internal details leaked).
- The scheduler and reminder engine will fail their current cycle and retry on the next cron tick.
- **Alert condition:** Any Supabase error that persists across 3 consecutive scheduler runs.

### Redis Unavailable
- Rate limiting falls back to in-memory store (per-process, not distributed).
- This means rate limits are not enforced across multiple backend instances during a Redis outage.
- **This is intentional:** availability is prioritised over strict rate enforcement during transient Redis failures.
- **Alert condition:** None for transient failures. Alert if Redis is unavailable for > 5 minutes (configure in your monitoring tool).

### Stripe Unavailable / Errors
| Error Type | Retryable | User-Facing | Alert |
|---|---|---|---|
| `StripeConnectionError` (timeout) | Yes | No | Yes |
| `StripeAPIError` (5xx) | Yes | No | Yes |
| `StripeCardError` (card declined, 402) | No | Yes | No |
| `StripeRateLimitError` (429) | Yes | No | No |
| `StripeInvalidRequestError` (4xx) | No | Yes | No |

- Subscriptions remain in `pending` state when Stripe is unavailable. The scheduler retries on the next cycle.
- Users are never charged without a corresponding DB record. If a charge succeeds but the DB write fails, a refund compensation is triggered.

### Stellar/Soroban Unavailable
- The backend uses a database-first pattern: the subscription is written to Supabase first.
- Blockchain sync is attempted asynchronously and failures are logged to `blockchain_logs`.
- The API returns HTTP 207 (partial success) when the DB write succeeded but blockchain sync failed.
- The event listener retries from the last processed ledger (`event_cursor`) on restart.

## Alert Configuration

Configure alerts in your monitoring tool (e.g., Datadog, Grafana, Supabase alerts) for:

1. **Supabase connection errors** – any `code: '08006'` or network error in backend logs
2. **Stripe 5xx / timeout** – `StripeConnectionError` or `StripeAPIError` with `statusCode >= 500`
3. **Scheduler consecutive failures** – 3+ failed cron runs in a row
4. **Blockchain sync lag** – `event_cursor.last_ledger` not updated for > 10 minutes on mainnet

## Running Fault Injection Tests

```bash
cd backend
npm test -- --testPathPattern=fault-injection
```

Tests are in `backend/tests/fault-injection.test.ts`.
