# Timestamp and Timezone Storage Rules

> **Issue #71 — P1**  
> Canonical reference for how timestamps and timezones are stored, computed,
> and rendered across the SYNCRO backend and frontend.

---

## 1. Canonical Storage Rules

| Data type | Storage format | Column type | Example |
|-----------|---------------|-------------|---------|
| Point-in-time | ISO-8601 UTC | `TIMESTAMPTZ` | `2026-05-28T09:00:00Z` |
| Wall-clock time | `HH:MM` (24-hour) | `TIME` | `22:00` |
| Timezone identifier | IANA string | `TEXT` | `America/New_York` |
| Blockchain timestamp | Unix epoch seconds | `BIGINT` | `1716883200` |
| Calendar date (no time) | `YYYY-MM-DD` | `DATE` | `2026-05-28` |

### Rules

1. **All point-in-time values are stored in UTC** (`TIMESTAMPTZ`).  
   Application code must never store a local time as if it were UTC.

2. **Quiet-hours wall-clock times (`quiet_hours_start`, `quiet_hours_end`)
   have no timezone component.**  
   They are always evaluated in the context of the companion
   `quiet_hours_timezone` column.  
   Example: `quiet_hours_start = '22:00'` with `quiet_hours_timezone =
   'America/New_York'` means 22:00 Eastern, which is 03:00 UTC in winter and
   02:00 UTC in summer.

3. **`quiet_hours_timezone` must be a valid IANA identifier** (e.g.
   `America/New_York`, `Europe/London`, `Asia/Tokyo`).  
   It must not be empty when `quiet_hours_enabled = TRUE`.  
   The backend falls back to `UTC` if the value is absent or unrecognised.

4. **Blockchain lifecycle timestamps are Unix epoch seconds (`BIGINT`).**  
   Convert to a displayable timestamp with `to_timestamp(value)` in SQL or
   `new Date(value * 1000)` in TypeScript.

5. **`reminder_date` is a bare `DATE`** (no time, no timezone).  
   The scheduler fires at **09:00 UTC** on that date.  
   Timezone-aware display is handled at the presentation layer.

---

## 2. Affected Tables

### `user_preferences`

| Column | Type | Rule |
|--------|------|------|
| `created_at` | `TIMESTAMPTZ` | UTC, set by DB default |
| `updated_at` | `TIMESTAMPTZ` | UTC, maintained by trigger |
| `quiet_hours_start` | `TIME` | Wall-clock HH:MM, no tz |
| `quiet_hours_end` | `TIME` | Wall-clock HH:MM, no tz |
| `quiet_hours_timezone` | `TEXT` | IANA identifier |

### `subscriptions`

| Column | Type | Rule |
|--------|------|------|
| `next_billing_date` | `TIMESTAMPTZ` | UTC |
| `expired_at` | `TIMESTAMPTZ` | UTC |
| `paused_at` | `TIMESTAMPTZ` | UTC |
| `resume_at` | `TIMESTAMPTZ` | UTC |
| `last_interaction_at` | `TIMESTAMPTZ` | UTC |
| `last_renewal_attempt_at` | `TIMESTAMPTZ` | UTC |
| `blockchain_created_at` | `BIGINT` | Unix epoch seconds |
| `blockchain_activated_at` | `BIGINT` | Unix epoch seconds |
| `blockchain_last_renewed_at` | `BIGINT` | Unix epoch seconds |
| `blockchain_canceled_at` | `BIGINT` | Unix epoch seconds |

### `reminder_schedules`

| Column | Type | Rule |
|--------|------|------|
| `reminder_date` | `DATE` | Calendar day, UTC context |
| `created_at` | `TIMESTAMPTZ` | UTC |
| `updated_at` | `TIMESTAMPTZ` | UTC |

### `notification_deliveries`

| Column | Type | Rule |
|--------|------|------|
| `last_attempt_at` | `TIMESTAMPTZ` | UTC |
| `next_retry_at` | `TIMESTAMPTZ` | UTC |
| `created_at` | `TIMESTAMPTZ` | UTC |
| `updated_at` | `TIMESTAMPTZ` | UTC |

### `delayed_notifications`

| Column | Type | Rule |
|--------|------|------|
| `original_send_time` | `TIMESTAMPTZ` | UTC — when the notification was originally due |
| `scheduled_send_time` | `TIMESTAMPTZ` | UTC — when quiet hours end in the user's timezone |
| `created_at` | `TIMESTAMPTZ` | UTC |
| `updated_at` | `TIMESTAMPTZ` | UTC |

---

## 3. Backend Implementation

### Library

The backend uses **`date-fns-tz`** (v3) for all timezone-aware date arithmetic.
Do not use `moment-timezone` or manual UTC-offset arithmetic.

```typescript
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
```

### QuietHoursService

`QuietHoursService` (`backend/src/services/quiet-hours-service.ts`) is the
single source of truth for quiet-hours evaluation.  All methods accept a UTC
`Date` and the user's `UserPreferences` (which carries `quiet_hours_timezone`).

Key methods:

| Method | What it does |
|--------|-------------|
| `isInQuietHours(prefs, utcNow)` | Converts `utcNow` to the user's timezone, then checks whether the local time falls within the quiet window |
| `getQuietHoursEndTime(prefs, utcNow)` | Returns the next UTC instant at which quiet hours end, computed in the user's timezone (handles DST correctly via `fromZonedTime`) |
| `isAppropriateTimeForDelayedNotifications(prefs, utcNow)` | Returns `true` when the local time is 08:00–22:00 and not within quiet hours |
| `determineNotificationPriority(payload)` | Pure function; no timezone dependency |

### DST handling

`date-fns-tz` uses the IANA timezone database bundled with the Node.js runtime
(`Intl`).  `fromZonedTime` correctly resolves ambiguous wall-clock times during
DST transitions (e.g. the repeated 01:30 when clocks fall back) by choosing the
first occurrence.  No special-casing is required in application code.

### Renewal cooldown

`last_renewal_attempt_at` is stored as UTC `TIMESTAMPTZ`.  Cooldown arithmetic
is performed in milliseconds against `Date.now()` — no timezone conversion is
needed because both sides are UTC.

---

## 4. Frontend Implementation

The client uses the browser's `Intl.DateTimeFormat` API (via
`client/lib/timezone-utils.ts`) for display formatting.

```typescript
// Display a UTC ISO string in the user's local timezone
formatDateInUserTimezone(isoString, 'long');

// Detect the browser's timezone for the timezone selector default
getUserTimezone(); // → e.g. "America/New_York"
```

When submitting quiet-hours settings, the client sends:
- `quiet_hours_start` / `quiet_hours_end` as `HH:MM` strings (wall-clock)
- `quiet_hours_timezone` as the IANA identifier selected by the user

The backend validates the timezone with `Intl` before persisting.

---

## 5. DST and Locale Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| Clocks spring forward (e.g. 02:00 → 03:00) | `toZonedTime` skips the gap; a quiet-hours window that would start at 02:30 is treated as starting at 03:00 |
| Clocks fall back (ambiguous hour) | `fromZonedTime` picks the first occurrence (pre-transition) |
| User sets `quiet_hours_timezone = ''` | Backend falls back to `UTC` and logs a warning |
| User in UTC+14 (Line Islands) | Fully supported; IANA identifier `Pacific/Kiritimati` |
| Overnight quiet window (22:00–08:00) | Handled by the `startTimeMinutes > endTimeMinutes` branch in `isInQuietHours` |
| Same-day quiet window (13:00–17:00) | Handled by the standard `>=` / `<` branch |

---

## 6. Testing

Tests live in `backend/tests/`:

| File | Coverage |
|------|----------|
| `quiet-hours-service.test.ts` | Unit tests for all `QuietHoursService` methods, including UTC-only and timezone-aware cases |
| `quiet-hours-integration.test.ts` | End-to-end quiet-hours flow |
| `timestamp-timezone.test.ts` | **New** — DST edge cases, overnight windows, timezone fallback, `getQuietHoursEndTime` UTC correctness |

Run tests:

```bash
cd backend
npm test
```
