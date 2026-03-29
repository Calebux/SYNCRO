import { supabase } from '../config/database';
import logger from '../config/logger';
import type {
  SubscriptionNotificationPreferences,
  NotificationPreferencesUpdateInput,
} from '../types/subscription';

export class NotificationPreferenceService {
  /**
   * Get per-subscription notification preferences.
   * Returns null if no override has been saved — caller should fall back
   * to user-level global settings.
   */
  async getPreferences(
    subscriptionId: string,
  ): Promise<SubscriptionNotificationPreferences | null> {
    const { data, error } = await supabase
      .from('subscription_notification_preferences')
      .select('*')
      .eq('subscription_id', subscriptionId)
      .single();

    if (error) {
      // PGRST116 = no rows found — not an error, just no override set yet
      if (error.code === 'PGRST116') return null;
      logger.error(`Failed to fetch notification preferences for ${subscriptionId}:`, error);
      throw new Error(`Failed to fetch notification preferences: ${error.message}`);
    }

    return data as SubscriptionNotificationPreferences;
  }

  /**
   * Upsert notification preferences for a subscription.
   * Creates the row if it doesn't exist, updates it if it does.
   */
  async upsertPreferences(
    subscriptionId: string,
    input: NotificationPreferencesUpdateInput,
  ): Promise<SubscriptionNotificationPreferences> {
    // Explicit allowlist — raw input never bleeds through
    const {
      reminder_days_before,
      channels,
      muted,
      muted_until,
      custom_message,
    } = input;

    const payload: Partial<SubscriptionNotificationPreferences> & {
      subscription_id: string;
      updated_at: string;
    } = {
      subscription_id: subscriptionId,
      updated_at: new Date().toISOString(),
      ...(reminder_days_before !== undefined && { reminder_days_before }),
      ...(channels !== undefined && { channels }),
      ...(muted !== undefined && { muted }),
      ...(muted_until !== undefined && { muted_until }),
      ...(custom_message !== undefined && { custom_message }),
    };

    const { data, error } = await supabase
      .from('subscription_notification_preferences')
      .upsert(payload, { onConflict: 'subscription_id' })
      .select()
      .single();

    if (error) {
      logger.error(`Failed to upsert notification preferences for ${subscriptionId}:`, error);
      throw new Error(`Failed to save notification preferences: ${error.message}`);
    }

    return data as SubscriptionNotificationPreferences;
  }

  /**
   * Snooze all reminders for a subscription until a given date.
   * Convenience wrapper around upsertPreferences.
   */
  async snooze(
    subscriptionId: string,
    until: string,
  ): Promise<SubscriptionNotificationPreferences> {
    const snoozeUntil = new Date(until);

    if (isNaN(snoozeUntil.getTime())) {
      throw new Error('Invalid snooze date');
    }

    if (snoozeUntil <= new Date()) {
      throw new Error('Snooze date must be in the future');
    }

    return this.upsertPreferences(subscriptionId, {
      muted: true,
      muted_until: snoozeUntil.toISOString(),
    });
  }

  /**
   * Unmute a subscription — clears both muted flag and muted_until.
   */
  async unmute(
    subscriptionId: string,
  ): Promise<SubscriptionNotificationPreferences> {
    return this.upsertPreferences(subscriptionId, {
      muted: false,
      muted_until: null,
    });
  }

  /**
   * Cron job handler — auto-unmutes subscriptions whose snooze has expired.
   * Call this daily alongside scheduleReminders.
   */
  async processExpiredSnoozes(): Promise<void> {
    const now = new Date().toISOString();

    logger.info('Processing expired snoozes');

    const { data, error } = await supabase
      .from('subscription_notification_preferences')
      .update({
        muted: false,
        muted_until: null,
        updated_at: now,
      })
      .eq('muted', true)
      .not('muted_until', 'is', null)
      .lte('muted_until', now)
      .select('subscription_id');

    if (error) {
      logger.error('Failed to process expired snoozes:', error);
      throw new Error(`Failed to process expired snoozes: ${error.message}`);
    }

    const count = data?.length ?? 0;
    logger.info(`Auto-unmuted ${count} subscription(s) with expired snoozes`);
  }
}

export const notificationPreferenceService = new NotificationPreferenceService();