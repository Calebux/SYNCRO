/**
 * Tests for Issue #71 — Normalize timestamp and timezone storage rules
 *
 * Covers:
 *  - QuietHoursService using the stored IANA timezone (not raw UTC)
 *  - Overnight quiet-hours windows evaluated in user timezone
 *  - getQuietHoursEndTime returning a correct UTC instant for non-UTC users
 *  - isAppropriateTimeForDelayedNotifications respecting user timezone
 *  - DST edge cases (US Eastern spring-forward / fall-back)
 *  - Fallback to UTC when timezone is empty or invalid
 */

import { QuietHoursService } from '../src/services/quiet-hours-service';
import { UserPreferences, NotificationPayload } from '../src/types/reminder';

// ─── helpers ────────────────────────────────────────────────────────────────

function makePrefs(overrides: Partial<UserPreferences> = {}): UserPreferences {
  return {
    user_id: 'test-user',
    notification_channels: ['email'],
    reminder_timing: [7, 3, 1],
    email_opt_ins: { marketing: false, reminders: true, updates: true },
    automation_flags: { auto_renew: false, auto_retry: true },
    quiet_hours_enabled: true,
    quiet_hours_start: '22:00',
    quiet_hours_end: '08:00',
    quiet_hours_timezone: 'UTC',
    critical_alerts_only: true,
    calendar_sync_enabled: false,
    calendar_export_reminders: true,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    title: 'Test',
    body: 'Test body',
    subscription: { id: 'sub-1', name: 'Netflix' } as any,
    reminderType: 'renewal',
    daysBefore: 7,
    renewalDate: new Date().toISOString(),
    ...overrides,
  };
}

// ─── suite ──────────────────────────────────────────────────────────────────

describe('QuietHoursService — timezone-aware behaviour (Issue #71)', () => {
  let service: QuietHoursService;

  beforeEach(() => {
    service = new QuietHoursService();
  });

  // ── isInQuietHours ─────────────────────────────────────────────────────────

  describe('isInQuietHours — non-UTC timezone', () => {
    /**
     * User is in America/New_York (UTC-5 in winter).
     * Quiet hours: 22:00–08:00 Eastern.
     * 03:00 UTC = 22:00 Eastern → start of quiet hours → should be IN quiet hours.
     */
    it('detects quiet hours start in Eastern Standard Time (UTC-5)', () => {
      const prefs = makePrefs({ quiet_hours_timezone: 'America/New_York' });
      // 2024-01-15 03:00 UTC = 2024-01-14 22:00 EST
      const utcTime = new Date('2024-01-15T03:00:00Z');
      expect(service.isInQuietHours(prefs, utcTime)).toBe(true);
    });

    /**
     * 13:00 UTC = 08:00 EST — exactly at the end boundary.
     * The end boundary is exclusive (< endTimeMinutes), so 08:00 is NOT quiet hours.
     */
    it('treats quiet-hours end boundary as exclusive (08:00 local is NOT quiet hours)', () => {
      const prefs = makePrefs({ quiet_hours_timezone: 'America/New_York' });
      // 2024-01-15 13:00 UTC = 2024-01-15 08:00 EST
      const utcTime = new Date('2024-01-15T13:00:00Z');
      expect(service.isInQuietHours(prefs, utcTime)).toBe(false);
    });

    /**
     * 12:59 UTC = 07:59 EST — one minute before end → still in quiet hours.
     */
    it('is still in quiet hours one minute before end boundary', () => {
      const prefs = makePrefs({ quiet_hours_timezone: 'America/New_York' });
      // 2024-01-15 12:59 UTC = 2024-01-15 07:59 EST
      const utcTime = new Date('2024-01-15T12:59:00Z');
      expect(service.isInQuietHours(prefs, utcTime)).toBe(true);
    });

    /**
     * 18:00 UTC = 13:00 EST — middle of the day, well outside quiet hours.
     */
    it('returns false during daytime in Eastern timezone', () => {
      const prefs = makePrefs({ quiet_hours_timezone: 'America/New_York' });
      // 2024-01-15 18:00 UTC = 2024-01-15 13:00 EST
      const utcTime = new Date('2024-01-15T18:00:00Z');
      expect(service.isInQuietHours(prefs, utcTime)).toBe(false);
    });

    /**
     * User in Asia/Tokyo (UTC+9).
     * Quiet hours: 22:00–08:00 JST.
     * 13:00 UTC = 22:00 JST → start of quiet hours.
     */
    it('detects quiet hours start in Asia/Tokyo (UTC+9)', () => {
      const prefs = makePrefs({ quiet_hours_timezone: 'Asia/Tokyo' });
      // 2024-01-15 13:00 UTC = 2024-01-15 22:00 JST
      const utcTime = new Date('2024-01-15T13:00:00Z');
      expect(service.isInQuietHours(prefs, utcTime)).toBe(true);
    });

    /**
     * User in Asia/Tokyo.
     * 23:00 UTC = 08:00 JST next day → end boundary (exclusive) → NOT quiet hours.
     */
    it('returns false at quiet-hours end boundary in Asia/Tokyo', () => {
      const prefs = makePrefs({ quiet_hours_timezone: 'Asia/Tokyo' });
      // 2024-01-15 23:00 UTC = 2024-01-16 08:00 JST
      const utcTime = new Date('2024-01-15T23:00:00Z');
      expect(service.isInQuietHours(prefs, utcTime)).toBe(false);
    });
  });

  // ── DST edge cases ─────────────────────────────────────────────────────────

  describe('isInQuietHours — DST transitions (America/New_York)', () => {
    /**
     * Spring-forward: 2024-03-10 02:00 EST → 03:00 EDT (clocks skip 02:00–02:59).
     * At 06:00 UTC on that day = 01:00 EST (before spring-forward) → in quiet hours.
     */
    it('handles spring-forward: 01:00 local is still in quiet hours', () => {
      const prefs = makePrefs({ quiet_hours_timezone: 'America/New_York' });
      // 2024-03-10 06:00 UTC = 01:00 EST (before clocks spring forward at 07:00 UTC)
      const utcTime = new Date('2024-03-10T06:00:00Z');
      expect(service.isInQuietHours(prefs, utcTime)).toBe(true);
    });

    /**
     * Spring-forward: 2024-03-10 12:00 UTC = 08:00 EDT (after spring-forward).
     * 08:00 is the end boundary (exclusive) → NOT quiet hours.
     */
    it('handles spring-forward: 08:00 EDT is not in quiet hours', () => {
      const prefs = makePrefs({ quiet_hours_timezone: 'America/New_York' });
      // 2024-03-10 12:00 UTC = 08:00 EDT
      const utcTime = new Date('2024-03-10T12:00:00Z');
      expect(service.isInQuietHours(prefs, utcTime)).toBe(false);
    });

    /**
     * Fall-back: 2024-11-03 02:00 EDT → 01:00 EST (clocks repeat 01:00–01:59).
     * At 06:00 UTC = 01:00 EST (second occurrence, after fall-back) → in quiet hours.
     */
    it('handles fall-back: 01:00 local (post-transition) is still in quiet hours', () => {
      const prefs = makePrefs({ quiet_hours_timezone: 'America/New_York' });
      // 2024-11-03 06:00 UTC = 01:00 EST (after fall-back)
      const utcTime = new Date('2024-11-03T06:00:00Z');
      expect(service.isInQuietHours(prefs, utcTime)).toBe(true);
    });
  });

  // ── getQuietHoursEndTime ───────────────────────────────────────────────────

  describe('getQuietHoursEndTime — returns correct UTC instant', () => {
    /**
     * User in America/New_York (UTC-5 in winter).
     * Quiet hours end at 08:00 EST = 13:00 UTC.
     * Current time: 03:00 UTC (22:00 EST previous day) → end is 13:00 UTC same UTC day.
     */
    it('returns 13:00 UTC for 08:00 EST end time (UTC-5)', () => {
      const prefs = makePrefs({ quiet_hours_timezone: 'America/New_York' });
      // 2024-01-15 03:00 UTC = 2024-01-14 22:00 EST
      const utcNow = new Date('2024-01-15T03:00:00Z');
      const endTime = service.getQuietHoursEndTime(prefs, utcNow);

      // 08:00 EST on 2024-01-15 = 13:00 UTC
      expect(endTime.toISOString()).toBe('2024-01-15T13:00:00.000Z');
    });

    /**
     * User in Asia/Tokyo (UTC+9).
     * Quiet hours end at 08:00 JST = 23:00 UTC (previous UTC day).
     * Current time: 14:00 UTC = 23:00 JST → end is 23:00 UTC same UTC day.
     */
    it('returns 23:00 UTC for 08:00 JST end time (UTC+9)', () => {
      const prefs = makePrefs({ quiet_hours_timezone: 'Asia/Tokyo' });
      // 2024-01-15 14:00 UTC = 2024-01-15 23:00 JST (in quiet hours)
      const utcNow = new Date('2024-01-15T14:00:00Z');
      const endTime = service.getQuietHoursEndTime(prefs, utcNow);

      // 08:00 JST on 2024-01-16 = 2024-01-15 23:00 UTC
      expect(endTime.toISOString()).toBe('2024-01-15T23:00:00.000Z');
    });

    /**
     * UTC user, overnight window.
     * Current time: 23:00 UTC → end is 08:00 UTC next day.
     */
    it('returns next-day 08:00 UTC for UTC user at 23:00 UTC', () => {
      const prefs = makePrefs({ quiet_hours_timezone: 'UTC' });
      const utcNow = new Date('2024-01-01T23:00:00Z');
      const endTime = service.getQuietHoursEndTime(prefs, utcNow);

      expect(endTime.getUTCHours()).toBe(8);
      expect(endTime.getUTCDate()).toBe(2);
    });

    /**
     * UTC user, early morning.
     * Current time: 06:00 UTC → end is 08:00 UTC same day.
     */
    it('returns same-day 08:00 UTC for UTC user at 06:00 UTC', () => {
      const prefs = makePrefs({ quiet_hours_timezone: 'UTC' });
      const utcNow = new Date('2024-01-01T06:00:00Z');
      const endTime = service.getQuietHoursEndTime(prefs, utcNow);

      expect(endTime.getUTCHours()).toBe(8);
      expect(endTime.getUTCDate()).toBe(1);
    });

    /**
     * The returned end time must always be strictly in the future.
     */
    it('always returns a future UTC instant', () => {
      const prefs = makePrefs({ quiet_hours_timezone: 'America/New_York' });
      const utcNow = new Date('2024-01-15T03:00:00Z');
      const endTime = service.getQuietHoursEndTime(prefs, utcNow);
      expect(endTime.getTime()).toBeGreaterThan(utcNow.getTime());
    });

    /**
     * DST Spring Forward: 2026-03-08 in America/New_York (clocks jump 02:00 EST -> 03:00 EDT).
     * Quiet hours: 22:00–08:00.
     * At 2026-03-08 03:00 UTC (2026-03-07 22:00 EST), next end time is 08:00 EDT on Mar 8 = 12:00 UTC.
     */
    it('calculates exact 08:00 EDT wall-clock end time across Spring Forward (23h day)', () => {
      const prefs = makePrefs({ quiet_hours_timezone: 'America/New_York' });
      const utcNow = new Date('2026-03-08T03:00:00Z'); // 22:00 EST on Mar 7
      const endTime = service.getQuietHoursEndTime(prefs, utcNow);

      expect(endTime.toISOString()).toBe('2026-03-08T12:00:00.000Z');
      expect(service.isInQuietHours(prefs, endTime)).toBe(false);
    });

    /**
     * DST Fall Back: 2026-11-01 in America/New_York (clocks fall back 02:00 EDT -> 01:00 EST).
     * Quiet hours: 22:00–08:00.
     * At 2026-11-01 03:00 UTC (2026-10-31 23:00 EDT), next end time is 08:00 EST on Nov 1 = 13:00 UTC.
     * Must NOT yield 12:00 UTC (07:00 EST), which would be inside quiet hours.
     */
    it('calculates exact 08:00 EST wall-clock end time across Fall Back (25h day)', () => {
      const prefs = makePrefs({ quiet_hours_timezone: 'America/New_York' });
      const utcNow = new Date('2026-11-01T03:00:00Z'); // 23:00 EDT on Oct 31
      const endTime = service.getQuietHoursEndTime(prefs, utcNow);

      expect(endTime.toISOString()).toBe('2026-11-01T13:00:00.000Z');
      expect(service.isInQuietHours(prefs, endTime)).toBe(false);
    });

    /**
     * DST Fall Back: 2026-10-25 in Europe/London (BST UTC+1 -> GMT UTC+0).
     * Quiet hours: 22:00–08:00.
     * At 2026-10-24 22:00 UTC (23:00 BST), next end time is 08:00 GMT on Oct 25 = 08:00 UTC.
     */
    it('calculates exact 08:00 GMT end time across European Fall Back', () => {
      const prefs = makePrefs({ quiet_hours_timezone: 'Europe/London' });
      const utcNow = new Date('2026-10-24T22:00:00Z'); // 23:00 BST on Oct 24
      const endTime = service.getQuietHoursEndTime(prefs, utcNow);

      expect(endTime.toISOString()).toBe('2026-10-25T08:00:00.000Z');
      expect(service.isInQuietHours(prefs, endTime)).toBe(false);
    });
  });

  // ── isAppropriateTimeForDelayedNotifications ───────────────────────────────

  describe('isAppropriateTimeForDelayedNotifications — user timezone', () => {
    /**
     * User in America/New_York.
     * 15:00 UTC = 10:00 EST → appropriate (08:00–22:00 local, not in quiet hours).
     */
    it('returns true at 10:00 EST (15:00 UTC) for Eastern user', () => {
      const prefs = makePrefs({ quiet_hours_timezone: 'America/New_York' });
      const utcTime = new Date('2024-01-15T15:00:00Z'); // 10:00 EST
      expect(service.isAppropriateTimeForDelayedNotifications(prefs, utcTime)).toBe(true);
    });

    /**
     * User in America/New_York.
     * 04:00 UTC = 23:00 EST → in quiet hours → not appropriate.
     */
    it('returns false at 23:00 EST (04:00 UTC) — in quiet hours', () => {
      const prefs = makePrefs({ quiet_hours_timezone: 'America/New_York' });
      const utcTime = new Date('2024-01-15T04:00:00Z'); // 23:00 EST
      expect(service.isAppropriateTimeForDelayedNotifications(prefs, utcTime)).toBe(false);
    });

    /**
     * User in America/New_York.
     * 11:00 UTC = 06:00 EST → outside quiet hours but before 08:00 local → not appropriate.
     */
    it('returns false at 06:00 EST (11:00 UTC) — too early', () => {
      const prefs = makePrefs({ quiet_hours_timezone: 'America/New_York' });
      const utcTime = new Date('2024-01-15T11:00:00Z'); // 06:00 EST
      expect(service.isAppropriateTimeForDelayedNotifications(prefs, utcTime)).toBe(false);
    });

    /**
     * User in Asia/Tokyo.
     * 01:00 UTC = 10:00 JST → appropriate.
     */
    it('returns true at 10:00 JST (01:00 UTC) for Tokyo user', () => {
      const prefs = makePrefs({ quiet_hours_timezone: 'Asia/Tokyo' });
      const utcTime = new Date('2024-01-15T01:00:00Z'); // 10:00 JST
      expect(service.isAppropriateTimeForDelayedNotifications(prefs, utcTime)).toBe(true);
    });

    /**
     * Quiet hours disabled → always appropriate regardless of time.
     */
    it('returns true at any time when quiet hours are disabled', () => {
      const prefs = makePrefs({
        quiet_hours_enabled: false,
        quiet_hours_timezone: 'America/New_York',
      });
      const utcTime = new Date('2024-01-15T04:00:00Z'); // 23:00 EST
      expect(service.isAppropriateTimeForDelayedNotifications(prefs, utcTime)).toBe(true);
    });
  });

  // ── timezone fallback ──────────────────────────────────────────────────────

  describe('timezone fallback behaviour', () => {
    /**
     * Empty timezone string → falls back to UTC, no crash.
     */
    it('falls back to UTC when quiet_hours_timezone is empty string', () => {
      const prefs = makePrefs({ quiet_hours_timezone: '' });
      const utcTime = new Date('2024-01-01T23:00:00Z'); // 23:00 UTC → in quiet hours
      expect(() => service.isInQuietHours(prefs, utcTime)).not.toThrow();
      expect(service.isInQuietHours(prefs, utcTime)).toBe(true);
    });

    /**
     * Invalid timezone string → falls back to UTC, no crash.
     */
    it('falls back to UTC when quiet_hours_timezone is invalid', () => {
      const prefs = makePrefs({ quiet_hours_timezone: 'Not/ATimezone' });
      const utcTime = new Date('2024-01-01T23:00:00Z');
      expect(() => service.isInQuietHours(prefs, utcTime)).not.toThrow();
      // Falls back to UTC: 23:00 UTC is in quiet hours (22:00–08:00 UTC)
      expect(service.isInQuietHours(prefs, utcTime)).toBe(true);
    });

    /**
     * getQuietHoursEndTime with invalid timezone → falls back gracefully.
     */
    it('getQuietHoursEndTime falls back gracefully on invalid timezone', () => {
      const prefs = makePrefs({ quiet_hours_timezone: 'Bad/Zone' });
      const utcNow = new Date('2024-01-01T23:00:00Z');
      expect(() => service.getQuietHoursEndTime(prefs, utcNow)).not.toThrow();
      const endTime = service.getQuietHoursEndTime(prefs, utcNow);
      // Should return a future date
      expect(endTime.getTime()).toBeGreaterThan(utcNow.getTime());
    });
  });

  // ── shouldSendDuringQuietHours with non-UTC timezone ──────────────────────

  describe('shouldSendDuringQuietHours — non-UTC timezone', () => {
    /**
     * User in America/New_York, 23:00 EST (04:00 UTC next day).
     * Non-critical payload → should be delayed.
     * delayUntil should be 08:00 EST = 13:00 UTC.
     */
    it('delays non-critical alert and sets delayUntil to 08:00 local time (EST)', () => {
      const prefs = makePrefs({ quiet_hours_timezone: 'America/New_York' });
      const payload = makePayload({ daysBefore: 7 }); // normal priority
      // 2024-01-15 04:00 UTC = 2024-01-14 23:00 EST → in quiet hours
      const utcNow = new Date('2024-01-15T04:00:00Z');

      const result = service.shouldSendDuringQuietHours(prefs, payload, utcNow);

      expect(result.isQuietHours).toBe(true);
      expect(result.shouldDelay).toBe(true);
      expect(result.delayUntil).toBeDefined();
      // 08:00 EST on 2024-01-15 = 13:00 UTC
      expect(result.delayUntil!.toISOString()).toBe('2024-01-15T13:00:00.000Z');
    });

    /**
     * Critical alert during quiet hours → always passes through.
     */
    it('allows critical alert during quiet hours regardless of timezone', () => {
      const prefs = makePrefs({ quiet_hours_timezone: 'America/New_York' });
      const payload = makePayload({ reminderType: 'renewal', daysBefore: 1 }); // critical
      const utcNow = new Date('2024-01-15T04:00:00Z'); // 23:00 EST

      const result = service.shouldSendDuringQuietHours(prefs, payload, utcNow);

      expect(result.isQuietHours).toBe(true);
      expect(result.shouldDelay).toBe(false);
    });
  });

  // ── same-day quiet window ──────────────────────────────────────────────────

  describe('same-day quiet window (e.g. 13:00–17:00)', () => {
    it('detects time inside a same-day window', () => {
      const prefs = makePrefs({
        quiet_hours_start: '13:00',
        quiet_hours_end: '17:00',
        quiet_hours_timezone: 'UTC',
      });
      const utcTime = new Date('2024-01-01T15:00:00Z'); // 15:00 UTC
      expect(service.isInQuietHours(prefs, utcTime)).toBe(true);
    });

    it('returns false before a same-day window', () => {
      const prefs = makePrefs({
        quiet_hours_start: '13:00',
        quiet_hours_end: '17:00',
        quiet_hours_timezone: 'UTC',
      });
      const utcTime = new Date('2024-01-01T12:59:00Z');
      expect(service.isInQuietHours(prefs, utcTime)).toBe(false);
    });

    it('returns false after a same-day window (end boundary exclusive)', () => {
      const prefs = makePrefs({
        quiet_hours_start: '13:00',
        quiet_hours_end: '17:00',
        quiet_hours_timezone: 'UTC',
      });
      const utcTime = new Date('2024-01-01T17:00:00Z'); // exactly at end
      expect(service.isInQuietHours(prefs, utcTime)).toBe(false);
    });
  });
});
