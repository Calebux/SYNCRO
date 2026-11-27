# Issue #649: Safe Email Re-scan and Replay Workflow - Implementation Summary

## Overview
Implemented a safe, auditable email re-scan workflow so operators and end users can replay bounded email history after parser improvements or transient provider failures.

## What Changed

### 1. `EmailRescanService`
Created `backend/src/services/email-rescan-service.ts` to orchestrate replay jobs.
- Validates replay windows before any provider call is made.
- Pulls Gmail and Outlook messages for the requested account inside the requested range.
- Re-processes each message through the existing parser fallback flow.
- Uses duplicate detection before inserting any subscription.
- Persists replay job counters and terminal status.

### 2. Replay Job Storage
Added `backend/migrations/023_create_rescan_jobs.sql`.
- Persists replay jobs with start/end timestamps and outcome counters.
- Adds status/date/count constraints for safety.
- Enables RLS so users can only access their own jobs.

### 3. Backend API Route
Added `POST /api/integrations/email/rescan` in `backend/src/routes/email-rescan.ts`.
- Requires authentication from the existing backend middleware stack.
- Validates bounded request input.
- Verifies ownership of the target email account.
- Rejects disconnected accounts before replay begins.

### 4. Audit Logging
Added replay audit events through `auditService.insertEntry`.
- `email_rescan_requested`
- `email_rescan_completed`
- `email_rescan_failed`

Each event includes the replay window, target account, actor, and relevant counts or error details.

### 5. Tests
Added focused coverage in:
- `backend/tests/email-rescan-service.test.ts`
- `backend/tests/email-rescan-route.test.ts`

These cover bounded-range enforcement, duplicate prevention, ownership checks, disconnected-account handling, and failure auditing.

## Acceptance Criteria Status
- [x] Re-scan jobs can target a bounded time range.
- [x] Duplicate subscription creation is prevented.
- [x] Audit logs record replay actions.
- [x] Tests added and documentation updated.
