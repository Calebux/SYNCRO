# Data Retention Policy

This document outlines the retention policies for data within the SYNCRO application to ensure compliance with GDPR and standard privacy best practices.

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
