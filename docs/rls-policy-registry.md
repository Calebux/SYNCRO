# RLS Policy Registry

All tables in the `public` schema must have Row Level Security (RLS) enabled.
This document is the authoritative record of every table's RLS status and any documented exceptions.

## Covered Tables

| Table | Migration | RLS Enabled | Policies | Notes |
|---|---|---|---|---|
| `profiles` | `001_create_users_and_profiles.sql` | ✅ | select, insert, update, delete | Owner-only via `auth.uid() = id` |
| `email_accounts` | `002_create_email_accounts.sql` | ✅ | select, insert, update, delete | Owner-only via `auth.uid() = user_id` |
| `subscriptions` | `003_create_subscriptions.sql` | ✅ | select, insert, update, delete | Owner-only via `auth.uid() = user_id` |
| `teams` | `004_create_teams.sql` | ✅ | select, insert, update, delete | Owner + member via EXISTS subquery |
| `team_members` | `004_create_teams.sql` | ✅ | select, insert | Member visibility via team ownership check |
| `api_keys` | `005_create_api_keys.sql` | ✅ | select, insert, update, delete | Owner-only via `auth.uid() = user_id` |
| `notifications` | `006_create_notifications.sql` | ✅ | select, insert, update, delete | Owner-only via `auth.uid() = user_id` |
| `reminder_schedules` | `007_create_reminder_tables.sql` | ✅ | select, insert, update | Owner-only via `auth.uid() = user_id` |
| `notification_deliveries` | `007_create_reminder_tables.sql` | ✅ | select, insert, update | Owner-only via `auth.uid() = user_id` |
| `blockchain_logs` | `007_create_reminder_tables.sql` | ✅ | select, insert | Owner-only via `auth.uid() = user_id` |
| `idempotency_keys` | `008_create_idempotency_table.sql` | ✅ | select, insert | Owner-only via `auth.uid() = user_id` |
| `user_preferences` | `008_create_user_preferences.sql` | ✅ | select, insert, update | Owner-only via `auth.uid() = user_id` |
| `contract_events` | `009_create_event_tables.sql` | ✅ | **none (exception)** | See exceptions below |
| `event_cursor` | `009_create_event_tables.sql` | ✅ | **none (exception)** | See exceptions below |
| `renewal_approvals` | `009_create_event_tables.sql` | ✅ | select | User reads own approvals via `subscriptions.blockchain_sub_id` join |

## RLS Exceptions

Tables where RLS is enabled but no user-facing policies exist. Access is exclusively via the Supabase **service role key** from the backend.

### `contract_events`
- **Reason:** Written by the backend event listener service using the service role. Contains raw on-chain event data not directly meaningful to end users.
- **User access path:** Users access processed event data through `blockchain_logs`, which has full user-scoped RLS policies.
- **Risk:** Low. No user PII stored. Service role access is server-side only.

### `event_cursor`
- **Reason:** Singleton system table (enforced by `CHECK (id = 1)`) tracking the last processed blockchain ledger. Managed exclusively by the backend event listener.
- **User access path:** None required. This is internal state for the event processing pipeline.
- **Risk:** None. Contains no user data.

## Adding New Tables

When adding a new migration:

1. Always include `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;`
2. Add at minimum a SELECT policy scoped to `auth.uid()`
3. Add the table to this registry
4. If the table is a system/service-role-only table, document the exception here
5. Run `scripts/check-rls.sh` locally before merging

## CI Enforcement

`scripts/check-rls.sh` runs against the database and fails if any `public` table has `rowsecurity = false`.
Wire it into your CI pipeline with:

```yaml
- name: RLS audit
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
  run: bash backend/scripts/check-rls.sh
```
