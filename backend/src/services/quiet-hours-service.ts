import { addDays } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { UserPreferences, NotificationPriority, NotificationPayload } from '../types/reminder';
import logger from '../config/logger';

export interface QuietHoursCheck {
  isQuietHours: boolean;
  shouldDelay: boolean;
  delayUntil?: Date;
  reason?: string;
}

/**
 * Resolve a user's IANA timezone string, falling back to UTC if the value is
 * absent or unrecognised by the runtime.
 */
function resolveTimezone(tz: string | undefined | null): string {
  if (!tz) return 'UTC';
  try {
    // Validate by attempting a conversion — date-fns-tz returns Invalid Date
    // for unknown identifiers rather than throwing, so we check for that too.
    const result = toZonedTime(new Date(), tz);
    if (isNaN(result.getTime())) {
      logger.warn(`Unrecognised timezone "${tz}", falling back to UTC`);
      return 'UTC';
    }
    return tz;
  } catch {
    logger.warn(`Unrecognised timezone "${tz}", falling back to UTC`);
    return 'UTC';
  }
}

/**
 * Return the wall-clock hour and minute for a UTC instant in the given IANA
 * timezone.  Always returns values in [0–23] and [0–59].
 */
function localHourMinute(utcDate: Date, tz: string): { hour: number; minute: number } {
  const zoned = toZonedTime(utcDate, tz);
  return { hour: zoned.getHours(), minute: zoned.getMinutes() };
}

export class QuietHoursService {
  /**
   * Check if a UTC instant falls within the user's quiet hours window,
   * evaluated in the user's own timezone.
   */
  isInQuietHours(preferences: UserPreferences, currentTime: Date = new Date()): boolean {
    if (!preferences.quiet_hours_enabled) {
      return false;
    }

    try {
      const tz = resolveTimezone(preferences.quiet_hours_timezone);
      const { hour, minute } = localHourMinute(currentTime, tz);
      const currentTimeMinutes = hour * 60 + minute;

      const [startHour, startMinute] = preferences.quiet_hours_start.split(':').map(Number);
      const [endHour, endMinute] = preferences.quiet_hours_end.split(':').map(Number);

      const startTimeMinutes = startHour * 60 + startMinute;
      const endTimeMinutes = endHour * 60 + endMinute;

      // Overnight window (e.g. 22:00 → 08:00 crosses midnight)
      if (startTimeMinutes > endTimeMinutes) {
        return currentTimeMinutes >= startTimeMinutes || currentTimeMinutes < endTimeMinutes;
      }

      // Same-day window (e.g. 13:00 → 17:00)
      return currentTimeMinutes >= startTimeMinutes && currentTimeMinutes < endTimeMinutes;
    } catch (error) {
      logger.error('Error checking quiet hours:', error);
      return false;
    }
  }

  /**
   * Calculate the next UTC instant at which quiet hours end, expressed in the
   * user's timezone.  The returned Date is always in the future relative to
   * currentTime.
   */
  getQuietHoursEndTime(preferences: UserPreferences, currentTime: Date = new Date()): Date {
    try {
      const tz = resolveTimezone(preferences.quiet_hours_timezone);
      const [endHour, endMinute] = preferences.quiet_hours_end.split(':').map(Number);

      // Convert the UTC instant to the user's local calendar date/time
      const zonedNow = toZonedTime(currentTime, tz);

      // Build an ISO-like local datetime string from the zoned components —
      // this avoids any dependency on the server's system timezone.
      const year  = zonedNow.getFullYear();
      const month = String(zonedNow.getMonth() + 1).padStart(2, '0');
      const day   = String(zonedNow.getDate()).padStart(2, '0');
      const hh    = String(endHour).padStart(2, '0');
      const mm    = String(endMinute).padStart(2, '0');
      const localDateStr = `${year}-${month}-${day}T${hh}:${mm}:00`;

      let candidate = fromZonedTime(localDateStr, tz);

      if (candidate <= currentTime) {
        const nextZoned = addDays(zonedNow, 1);
        const nextYear = nextZoned.getFullYear();
        const nextMonth = String(nextZoned.getMonth() + 1).padStart(2, '0');
        const nextDay = String(nextZoned.getDate()).padStart(2, '0');
        const nextLocalDateStr = `${nextYear}-${nextMonth}-${nextDay}T${hh}:${mm}:00`;
        candidate = fromZonedTime(nextLocalDateStr, tz);
      }

      return candidate;
    } catch (error) {
      logger.error('Error calculating quiet hours end time:', error);
      // Fallback: 8 hours from now
      return new Date(currentTime.getTime() + 8 * 60 * 60 * 1000);
    }
  }

  /**
   * Determine notification priority based on content and type.
   *
   * Priority tiers:
   *   critical — renewal ≤ 1 day away, or trial expiring today
   *   high     — trial expiring ≤ 2 days, or renewal ≤ 3 days
   *   normal   — standard renewal / trial_expiry reminders
   *   low      — cancellation reminders
   */
  determineNotificationPriority(payload: NotificationPayload): NotificationPriority {
    if (payload.reminderType === 'renewal' && payload.daysBefore <= 1) {
      return 'critical';
    }
    if (payload.reminderType === 'trial_expiry' && payload.daysBefore <= 0) {
      return 'critical';
    }
    if (payload.reminderType === 'trial_expiry' && payload.daysBefore <= 2) {
      return 'high';
    }
    if (payload.reminderType === 'renewal' && payload.daysBefore <= 3) {
      return 'high';
    }
    if (payload.reminderType === 'renewal' || payload.reminderType === 'trial_expiry') {
      return 'normal';
    }
    if (payload.reminderType === 'cancellation') {
      return 'low';
    }
    return 'normal';
  }

  /**
   * Decide whether a notification should be sent immediately or delayed.
   * Critical alerts always pass through, even during quiet hours.
   */
  shouldSendDuringQuietHours(
    preferences: UserPreferences,
    payload: NotificationPayload,
    currentTime: Date = new Date(),
  ): QuietHoursCheck {
    if (!this.isInQuietHours(preferences, currentTime)) {
      return { isQuietHours: false, shouldDelay: false };
    }

    const priority = this.determineNotificationPriority(payload);

    if (priority === 'critical') {
      return {
        isQuietHours: true,
        shouldDelay: false,
        reason: 'Critical alert allowed during quiet hours',
      };
    }

    if (preferences.critical_alerts_only) {
      const delayUntil = this.getQuietHoursEndTime(preferences, currentTime);
      return {
        isQuietHours: true,
        shouldDelay: true,
        delayUntil,
        reason: `Non-critical alert delayed until ${delayUntil.toISOString()}`,
      };
    }

    return {
      isQuietHours: true,
      shouldDelay: false,
      reason: 'User allows all alerts during quiet hours',
    };
  }

  /**
   * Return true when it is an appropriate local time to deliver delayed
   * notifications for this user (08:00–22:00 in the user's own timezone,
   * and not currently within quiet hours).
   */
  isAppropriateTimeForDelayedNotifications(
    preferences: UserPreferences,
    currentTime: Date = new Date(),
  ): boolean {
    if (!preferences.quiet_hours_enabled) {
      return true;
    }

    if (this.isInQuietHours(preferences, currentTime)) {
      return false;
    }

    try {
      const tz = resolveTimezone(preferences.quiet_hours_timezone);
      const { hour } = localHourMinute(currentTime, tz);
      // Deliver delayed notifications between 08:00 and 22:00 local time
      return hour >= 8 && hour < 22;
    } catch (error) {
      logger.error('Error checking appropriate time for delayed notifications:', error);
      return true;
    }
  }
}

export const quietHoursService = new QuietHoursService();
