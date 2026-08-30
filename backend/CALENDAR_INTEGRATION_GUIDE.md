# Calendar Integration Guide

## Overview

SYNCRO calendar sync exports subscription renewal dates and reminder schedules as an iCal (`.ics`) feed. Users can subscribe to the feed in Apple Calendar, Google Calendar, or Outlook, or download a one-time `.ics` export from the subscriptions page.

## Architecture

| Layer | Responsibility |
|-------|----------------|
| `backend/src/services/calendar-service.ts` | Token generation, preference storage, iCal event creation/cancellation |
| `backend/src/routes/calendar.ts` | HTTP routes for feed, token, and preferences |
| `client/app/api/calendar/feed/[userId]/[token]/route.ts` | Next.js proxy so feed URLs use the frontend host |
| `client/components/settings/CalendarSettings.tsx` | Settings UI for calendar preferences and export |
| `client/components/pages/subscriptions.tsx` | Quick access to feed URL and `.ics` export |

## Environment

Add to `backend/.env`:

```bash
CALENDAR_SECRET=your_calendar_secret_here_use_openssl_rand_hex_32
CALENDAR_FEED_BASE_URL=http://localhost:3000
```

`CALENDAR_SECRET` is required in production. Generate it with:

```bash
openssl rand -hex 32
```

## Database

Run migration `backend/migrations/023_add_calendar_preferences.sql` to add:

- `user_preferences.calendar_sync_enabled` (default `false`)
- `user_preferences.calendar_export_reminders` (default `true`)

## API Routes

### Public

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/calendar/feed/:userId/:token.ics` | Returns iCal feed when token is valid and sync is enabled |

### Authenticated

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/calendar/token` | Returns HMAC token and feed URL |
| `GET` | `/api/calendar/preferences` | Returns calendar sync preferences and feed URL |
| `PATCH` | `/api/calendar/preferences` | Updates `calendar_sync_enabled` and `calendar_export_reminders` |

## Service Behavior

### Event creation

- Active subscriptions with `next_billing_date` produce `STATUS:CONFIRMED` events.
- Pending reminder schedules produce reminder events when `calendar_export_reminders` is enabled.
- Each subscription uses a stable UID: `syncro-sub-{subscriptionId}@syncro.app`.

### Cancellation updates

- Cancelled subscriptions produce `STATUS:CANCELLED` events with the same UID as their renewal event.
- Cancelled reminder schedules produce cancelled reminder events.
- Calendar clients remove or mark events cancelled on the next feed refresh.

### Security

- Feed access is gated by an HMAC token derived from `CALENDAR_SECRET` and `user_id`.
- Token verification uses constant-time comparison.
- Feeds are blocked when `calendar_sync_enabled` is `false`.
- Authenticated routes require standard JWT/API-key auth.

## User Flows

### Enable calendar sync (Settings)

1. Open **Settings → Notifications**.
2. Enable **Calendar feed**.
3. Optionally enable **Include reminder schedules**.
4. Copy the feed URL into your calendar app.

### Export reminders (Subscriptions)

1. Open the **Export** menu on the subscriptions page.
2. Choose **Export reminders (.ics)** for a one-time download.
3. Or use **Sync to Calendar** to copy the subscribed feed URL.

## Testing

Backend tests cover event creation, cancellation updates, token validation, and route behavior:

```bash
cd backend
npm test -- calendar-service.test.ts calendar-api.test.ts
```

## Related Files

- `backend/src/routes/calendar.ts`
- `backend/src/services/calendar-service.ts`
- `backend/tests/calendar-service.test.ts`
- `backend/tests/calendar-api.test.ts`
- `client/lib/api/calendar.ts`
- `client/components/settings/CalendarSettings.tsx`
