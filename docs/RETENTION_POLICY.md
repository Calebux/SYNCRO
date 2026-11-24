# Data Retention Policy

This document outlines the retention policies for data within the SYNCRO application to ensure compliance with GDPR and standard privacy best practices.

## V3 receipts and usage data

Retention periods below apply to the v3 metering data path. Open payment-channel disputes are a legal/evidentiary hold: receipt rows for those channels are not moved to the archive, regardless of age. The daily retention job reads each source in batches of at most 500 rows and continues until it has processed all currently expired rows, avoiding unbounded database queries while draining backlogs.

| Data | Active storage | Archive / deletion | Reason and privacy treatment |
| --- | --- | --- | --- |
| Signed v3 receipts | 2 years from issue; longer while the associated channel has an open dispute | Moved to `usage_retention_archive` after 2 years if no open dispute remains | Retains verifiable billing evidence beyond the normal dispute window. The signed receipt is kept intact in the archive because redacting signed fields would invalidate its cryptographic proof. |
| Terminal meter usage events (`meter_usage_ledger`) | 2 years from reservation; active reservations are retained until terminal | Moved to `usage_retention_archive` after 2 years | Supports usage reconciliation, billing investigations, and accounting. During the move, `route`, `correlation_id`, and `settlement_ref` are redacted; amounts, agent identifier, lifecycle timestamps, and status remain. |
| Settled payment rows (`channel_payments`) | 7 years from creation | Moved to `usage_retention_archive` after 7 years, unless the channel has an open dispute | Supports long-term financial reporting and accounting. The rows contain settlement-level values rather than request query/body metadata. |
| Aggregated usage analytics | Recomputed from retained source rows | Not separately archived | Aggregates are derived data, so retaining a second copy would create inconsistent totals. They remain reproducible for the retention period of their source data: 2 years for metering events and 7 years for settled payments. |

Archived rows are stored as JSON in `usage_retention_archive`, keyed by source table and source row ID. The archive insert is idempotent; the live source row is deleted only after its archive insert succeeds. Re-running the worker therefore does not create duplicate archive records. The worker checks open disputes before archiving receipts and settlement rows.

The signed receipt's request hash is part of the cryptographic payload and is not modified: changing it would make the receipt impossible to verify. Usage-event routing and correlation metadata are removed when the event leaves active storage.

The daily worker is `backend/src/jobs/usage-retention-job.ts`; retention periods and movement rules are implemented in `backend/src/archival/usage-retention-archiver.ts`.

## Soft-Delete Retention

To allow users to recover accidentally deleted data and to maintain temporary records for auditing, we employ a "soft-delete" approach for specific entities.

### Subscriptions

- **Soft-Delete Window:** When a user deletes a subscription, its `status` is marked as `deleted` and the `deleted_at` timestamp is set.
- **Retention Period:** Soft-deleted subscriptions are retained in the database for **30 days**.
- **Restoration:** Within this 30-day window, users can restore the subscription via the API (`POST /api/subscriptions/:id/restore`), which resets the status to `active` and clears the `deleted_at` timestamp.
- **Hard-Delete (Purge):** A daily scheduled background job (`SchedulerService`) automatically purges any subscriptions where the `deleted_at` timestamp is older than 30 days. This is a permanent, non-recoverable deletion from the database, which cascades down to associated tags, notes, and reminders.

## Complete Account Deletion (GDPR Right to Erasure)

When a user requests to delete their account (`DELETE /api/user/account`):
- We immediately perform a cascading hard delete of all user-owned records (profiles, subscriptions, notifications, email_accounts, team_members, tags).
- The underlying Auth user record is destroyed.
- This process bypasses the 30-day soft-delete retention entirely, ensuring immediate compliance with GDPR erasure requests.

## Logs and Telemetry

- **Application Logs:** Retained for 90 days in standard storage, aggregated for debugging.
- **Audit Logs:** Security and access events are retained for 1 year for compliance auditing purposes.
- **CSP Violation Logs:** Retained for trend analysis. IPs are redacted before storage.
