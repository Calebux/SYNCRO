import crypto from 'crypto';
import ical, { ICalCalendar } from 'ical-generator';
import { supabase } from '../config/database';
import logger from '../config/logger';
import { env } from '../config/env';
import { userPreferenceService } from './user-preference-service';
import type { Subscription } from '../types/reminder';

export interface CalendarPreferences {
  calendar_sync_enabled: boolean;
  calendar_export_reminders: boolean;
}

export interface CalendarTokenResponse {
  token: string;
  userId: string;
  feedUrl: string;
}

export interface CalendarPreferencesUpdate {
  calendar_sync_enabled?: boolean;
  calendar_export_reminders?: boolean;
}

interface ReminderScheduleRow {
  id: string;
  subscription_id: string;
  reminder_date: string;
  reminder_type: string;
  days_before: number;
  status: string;
  subscriptions?: Pick<Subscription, 'name' | 'price' | 'billing_cycle' | 'status'>;
}

function getCalendarSecret(): string {
  const secret = env.CALENDAR_SECRET;
  if (!secret) {
    if (env.NODE_ENV === 'production') {
      throw new Error('CALENDAR_SECRET environment variable is required in production');
    }
    return 'syncro-calendar-secret-dev-only';
  }
  return secret;
}

export function generateCalendarToken(userId: string): string {
  return crypto
    .createHmac('sha256', getCalendarSecret())
    .update(userId)
    .digest('hex')
    .substring(0, 32);
}

export function verifyCalendarToken(userId: string, token: string): boolean {
  const expected = generateCalendarToken(userId);
  if (expected.length !== token.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

export function getSubscriptionEventUid(subscriptionId: string): string {
  return `syncro-sub-${subscriptionId}@syncro.app`;
}

export function getReminderEventUid(reminderId: string): string {
  return `syncro-reminder-${reminderId}@syncro.app`;
}

export function buildRenewalEvent(subscription: Subscription) {
  return {
    id: getSubscriptionEventUid(subscription.id),
    start: new Date(subscription.next_billing_date!),
    allDay: true,
    summary: `Subscription Renewal: ${subscription.name}`,
    description: `Renewal for ${subscription.name} - $${subscription.price}/${subscription.billing_cycle}`,
    url: subscription.renewal_url || undefined,
    status: 'CONFIRMED' as const,
  };
}

export function buildCancelledRenewalEvent(subscription: Subscription) {
  const eventDate = subscription.next_billing_date || subscription.updated_at;
  return {
    id: getSubscriptionEventUid(subscription.id),
    start: new Date(eventDate),
    allDay: true,
    summary: `Subscription Renewal: ${subscription.name}`,
    description: `Cancelled subscription: ${subscription.name}`,
    status: 'CANCELLED' as const,
  };
}

export function buildReminderEvent(reminder: ReminderScheduleRow) {
  const subscriptionName = reminder.subscriptions?.name || 'Subscription';
  return {
    id: getReminderEventUid(reminder.id),
    start: new Date(reminder.reminder_date),
    allDay: true,
    summary: `Renewal Reminder: ${subscriptionName}`,
    description: `${reminder.days_before} day reminder for ${subscriptionName}`,
    status: reminder.status === 'cancelled' ? ('CANCELLED' as const) : ('CONFIRMED' as const),
  };
}

export function buildCalendarFeed(
  activeSubscriptions: Subscription[],
  cancelledSubscriptions: Subscription[] = [],
  reminders: ReminderScheduleRow[] = [],
): ICalCalendar {
  const calendar = ical({ name: 'SYNCRO Subscriptions' });

  activeSubscriptions.forEach((subscription) => {
    if (subscription.next_billing_date) {
      calendar.createEvent(buildRenewalEvent(subscription));
    }
  });

  cancelledSubscriptions.forEach((subscription) => {
    calendar.createEvent(buildCancelledRenewalEvent(subscription));
  });

  reminders.forEach((reminder) => {
    calendar.createEvent(buildReminderEvent(reminder));
  });

  return calendar;
}

export class CalendarService {
  async getPreferences(userId: string): Promise<CalendarPreferences> {
    const preferences = await userPreferenceService.getPreferences(userId);
    return {
      calendar_sync_enabled: preferences.calendar_sync_enabled ?? false,
      calendar_export_reminders: preferences.calendar_export_reminders ?? true,
    };
  }

  async updatePreferences(
    userId: string,
    updates: CalendarPreferencesUpdate,
  ): Promise<CalendarPreferences> {
    const updated = await userPreferenceService.updatePreferences(userId, updates);
    return {
      calendar_sync_enabled: updated.calendar_sync_enabled ?? false,
      calendar_export_reminders: updated.calendar_export_reminders ?? true,
    };
  }

  async getToken(userId: string, feedBaseUrl: string): Promise<CalendarTokenResponse> {
    const token = generateCalendarToken(userId);
    const normalizedBase = feedBaseUrl.replace(/\/$/, '');
    return {
      token,
      userId,
      feedUrl: `${normalizedBase}/api/calendar/feed/${userId}/${token}.ics`,
    };
  }

  async generateFeed(userId: string): Promise<string> {
    const preferences = await this.getPreferences(userId);

    if (!preferences.calendar_sync_enabled) {
      throw new Error('Calendar sync is disabled for this user');
    }

    const activeSubscriptions = await this.fetchSubscriptions(userId, 'active');
    const cancelledSubscriptions = await this.fetchSubscriptions(userId, 'cancelled');
    const reminders = preferences.calendar_export_reminders
      ? await this.fetchReminderSchedules(userId)
      : [];

    return buildCalendarFeed(activeSubscriptions, cancelledSubscriptions, reminders).toString();
  }

  private async fetchSubscriptions(userId: string, status: string): Promise<Subscription[]> {
    let query = supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', status);

    if (status === 'cancelled') {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 90);
      query = query.gte('updated_at', cutoff.toISOString());
    }

    const { data, error } = await query;

    if (error) {
      logger.error(`Failed to fetch ${status} subscriptions for calendar feed`, error);
      throw error;
    }

    return (data || []) as Subscription[];
  }

  private async fetchReminderSchedules(userId: string): Promise<ReminderScheduleRow[]> {
    const { data, error } = await supabase
      .from('reminder_schedules')
      .select('id, subscription_id, reminder_date, reminder_type, days_before, status, subscriptions(name, price, billing_cycle, status)')
      .eq('user_id', userId)
      .in('status', ['pending', 'cancelled']);

    if (error) {
      logger.error('Failed to fetch reminder schedules for calendar feed', error);
      throw error;
    }

    return (data || []) as ReminderScheduleRow[];
  }
}

export const calendarService = new CalendarService();
