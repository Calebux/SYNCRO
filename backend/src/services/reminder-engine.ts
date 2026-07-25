import logger from '../config/logger';
import { supabase } from '../config/database';
import { emailService } from './email-service';
import { pushService, PushSubscription } from './push-service';
import { slackService } from './slack-service';
import { blockchainService } from './blockchain-service';
import {
  ReminderSchedule,
  Subscription,
  UserProfile,
  NotificationPayload,
  NotificationDelivery,
} from '../types/reminder';
import { subDays } from 'date-fns';
import { calculateBackoffDelay } from '../utils/retry';
import { userPreferenceService } from './user-preference-service';
import { notificationPreferenceService } from './notification-preference-service';
import { telegramBotService } from './telegram-bot-service';

export interface ReminderEngineOptions {
  defaultDaysBefore?: number[];
  maxRetryAttempts?: number;
}

type DeliveryStatus = 'sent' | 'failed' | 'retrying';

export class ReminderEngine {
  private readonly defaultDaysBefore: number[];
  private readonly maxRetryAttempts: number;

  constructor(options: ReminderEngineOptions = {}) {
    this.defaultDaysBefore = options.defaultDaysBefore || [7, 3, 1];
    this.maxRetryAttempts = options.maxRetryAttempts || 3;
  }

  async processReminders(targetDate: Date = new Date()): Promise<void> {
    const dateString = targetDate.toISOString().split('T')[0];
    logger.info(`Processing reminders for date: ${dateString}`);

    const { data: reminders, error } = await supabase
      .from('reminder_schedules')
      .select('*')
      .eq('reminder_date', dateString)
      .eq('status', 'pending');

    if (error) {
      logger.error('Failed to fetch reminders:', error);
      throw error;
    }

    if (!reminders || reminders.length === 0) {
      logger.info(`No pending reminders found for ${dateString}`);
      return;
    }

    for (const reminder of reminders) {
      try {
        await this.processReminder(reminder as ReminderSchedule);
      } catch (processError) {
        logger.error(`Failed to process reminder ${reminder.id}:`, processError);
      }
    }
  }

  async processRetries(): Promise<void> {
    const now = new Date().toISOString();
    logger.info('Processing delivery retries');

    const { data: deliveries, error } = await supabase
      .from('notification_deliveries')
      .select('*, reminder_schedules!inner(*)')
      .eq('status', 'retrying')
      .lte('next_retry_at', now)
      .lt('attempt_count', this.maxRetryAttempts);

    if (error) {
      logger.error('Failed to fetch retry deliveries:', error);
      throw error;
    }

    if (!deliveries || deliveries.length === 0) {
      logger.info('No deliveries need retry');
      return;
    }

    for (const delivery of deliveries) {
      try {
        await this.retryDelivery(
          delivery as NotificationDelivery & { reminder_schedules: ReminderSchedule },
        );
      } catch (retryError) {
        logger.error(`Failed to retry delivery ${delivery.id}:`, retryError);
      }
    }
  }

  async scheduleReminders(daysBefore: number[] = this.defaultDaysBefore): Promise<void> {
    const start = Date.now();
    logger.info(`Scheduling reminders, engine defaults: ${daysBefore.join(', ')}`);

    const { data: subscriptions, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('status', 'active')
      .not('active_until', 'is', null)
      .gt('active_until', new Date().toISOString());

    if (error) {
      logger.error('Failed to fetch subscriptions:', error);
      throw error;
    }

    const rows: Array<Record<string, unknown>> = [];
    const activeSubscriptions = (subscriptions ?? []) as Subscription[];

    if (activeSubscriptions.length === 0) {
      logger.info('No active subscriptions with future renewal dates');
      return;
    }

    const userIds = Array.from(new Set(activeSubscriptions.map((sub) => sub.user_id)));
    const { data: preferences, error: preferencesError } = await supabase
      .from('user_preferences')
      .select('*')
      .in('user_id', userIds);

    if (preferencesError) {
      logger.error('Failed to fetch user preferences:', preferencesError);
      throw preferencesError;
    }

    const prefsByUser = new Map<string, { reminder_timing?: number[]; reminder_jitter_level?: string }>();
    (preferences ?? []).forEach((pref: { user_id: string; reminder_timing?: number[]; reminder_jitter_level?: string }) => {
      prefsByUser.set(pref.user_id, pref);
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const jitterLevels: Record<string, number> = {
      off: 0,
      low: 2,
      medium: 6,
      high: 12
    };

    for (const subscription of activeSubscriptions) {
      const userPref = prefsByUser.get(subscription.user_id);
      const timing = userPref?.reminder_timing ?? daysBefore;
      const jitterLevel = userPref?.reminder_jitter_level ?? 'off';
      const maxJitter = jitterLevels[jitterLevel] || 0;
      const renewalDate = new Date(subscription.active_until as string);

      for (const day of timing) {
        // Calculate base reminder date
        let reminderDate = subDays(renewalDate, day);
        reminderDate.setHours(0, 0, 0, 0);

        let jitterOffsetHours = 0;
        if (maxJitter > 0) {
          // Generate random jitter between -maxJitter and +maxJitter
          jitterOffsetHours = (Math.random() * 2 * maxJitter) - maxJitter;
          // Apply jitter
          reminderDate = new Date(reminderDate.getTime() + jitterOffsetHours * 60 * 60 * 1000);
          // Ensure reminder is not after renewal date
          if (reminderDate > renewalDate) {
            reminderDate = new Date(renewalDate);
            // Recalculate offset to be the maximum possible before renewal
            jitterOffsetHours = (renewalDate.getTime() - subDays(renewalDate, day).setHours(0,0,0,0)) / (60*60*1000);
          }
        }

        if (reminderDate >= today) {
          rows.push({
            subscription_id: subscription.id,
            user_id: subscription.user_id,
            reminder_date: reminderDate.toISOString().split('T')[0],
            reminder_type: 'renewal',
            days_before: day,
            jitter_offset_hours: maxJitter > 0 ? jitterOffsetHours : null,
            status: 'pending',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }
      }
    }

    if (rows.length > 0) {
      const { error: upsertError } = await supabase
        .from('reminder_schedules')
        .upsert(rows, { onConflict: 'subscription_id,reminder_date' });

      if (upsertError) {
        logger.error('Failed to upsert reminder schedules:', upsertError);
        throw upsertError;
      }
    }

    logger.info(`Reminder scheduling completed in ${Date.now() - start}ms`);
  }

  async scheduleTrialReminders(): Promise<void> {
    logger.info('Scheduling trial reminders');

    const { data: trials, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('is_trial', true)
      .eq('status', 'active')
      .not('trial_ends_at', 'is', null)
      .gt('trial_ends_at', new Date().toISOString());

    if (error) {
      logger.error('Failed to fetch trial subscriptions:', error);
      throw error;
    }

    if (!trials || trials.length === 0) {
      logger.info('No active trials to schedule reminders for');
      return;
    }

    const trialSubscriptions = trials as Subscription[];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const subscription of trialSubscriptions) {
      const trialEnd = new Date(subscription.trial_ends_at as string);
      const reminderWindows = subscription.credit_card_required
        ? [14, 7, 3, 1, 0]
        : [7, 3, 1, 0];

      for (const day of reminderWindows) {
        const reminderDate = subDays(trialEnd, day);
        reminderDate.setHours(0, 0, 0, 0);

        if (reminderDate < today) {
          continue;
        }

        const { data: existing } = await supabase
          .from('reminder_schedules')
          .select('id')
          .eq('subscription_id', subscription.id)
          .eq('reminder_type', 'trial_expiry')
          .eq('days_before', day)
          .eq('status', 'pending')
          .single();

        if (existing) {
          continue;
        }

        const { error: insertError } = await supabase.from('reminder_schedules').insert({
          subscription_id: subscription.id,
          user_id: subscription.user_id,
          reminder_date: reminderDate.toISOString().split('T')[0],
          reminder_type: 'trial_expiry',
          days_before: day,
          status: 'pending',
        });

        if (insertError) {
          logger.error('Failed to insert trial reminder schedule:', insertError);
          throw insertError;
        }
      }
    }

    logger.info('Trial reminder scheduling completed');
  }

  async processDelayedNotifications(): Promise<void> {
    logger.info('ReminderEngine.processDelayedNotifications noop');
  }

  private async processReminder(reminder: ReminderSchedule): Promise<void> {
    logger.info(`Processing reminder ${reminder.id} for subscription ${reminder.subscription_id}`);

    try {
      const subscription = await this.getSubscription(reminder.subscription_id);
      if (!subscription) {
        logger.warn(`Subscription ${reminder.subscription_id} not found`);
        await this.markReminderAsFailed(reminder.id, 'Subscription not found');
        return;
      }

      if (subscription.status === 'paused') {
        logger.info(`Skipping reminder ${reminder.id} because subscription is paused`);
        await this.markReminderAsFailed(reminder.id, 'Subscription is paused');
        return;
      }

    const userPreferences = await userPreferenceService.getPreferences(reminder.user_id);
    const deliveryChannels = userPreferences.notification_channels ?? ['email'];
    const renewalDate = reminder.reminder_type === 'trial_expiry'
      ? (subscription.trial_ends_at || new Date().toISOString())
      : (subscription.active_until || new Date().toISOString());
    const payload: NotificationPayload = {
      title: `${subscription.name} Renewal Reminder`,
      body: `${subscription.name} will renew in ${reminder.days_before} day${reminder.days_before === 1 ? '' : 's'}`,
      subscription,
      reminderType: reminder.reminder_type,
      daysBefore: reminder.days_before,
      renewalDate,
    };

    const deliveries: NotificationDelivery[] = [];

    if (deliveryChannels.includes('email') && userPreferences.email_opt_ins.reminders) {
      const emailDelivery = await this.createDeliveryRecord(reminder.id, reminder.user_id, 'email');
      deliveries.push(emailDelivery);

      const userProfile = await this.getUserProfile(reminder.user_id);
      if (!userProfile?.email) {
        emailDelivery.status = 'failed';
        await this.updateDeliveryRecord(
          emailDelivery.id,
          'failed',
          'User email not found',
          { retryable: false },
        );
      } else {
        const emailResult = await emailService.sendReminderEmail(userProfile.email, payload, {
          maxAttempts: this.maxRetryAttempts,
        });
        const emailStatus: DeliveryStatus = emailResult.success
          ? 'sent'
          : (emailResult.metadata?.retryable ? 'retrying' : 'failed');

        emailDelivery.status = emailStatus;

        await this.updateDeliveryRecord(
          emailDelivery.id,
          emailStatus,
          emailResult.error,
          emailResult.metadata,
        );
      }
    }

    if (deliveryChannels.includes('push')) {
      const pushDelivery = await this.createDeliveryRecord(reminder.id, reminder.user_id, 'push');
      deliveries.push(pushDelivery);

      const pushSubscription = await this.getPushSubscription(reminder.user_id);
      if (!pushSubscription) {
        pushDelivery.status = 'failed';
        await this.updateDeliveryRecord(pushDelivery.id, 'failed', 'Push subscription not found', {
          retryable: false,
        });
      } else {
        const pushResult = await pushService.sendPushNotification(pushSubscription, payload, {
          maxAttempts: this.maxRetryAttempts,
        });
        const pushStatus: DeliveryStatus = pushResult.success
          ? 'sent'
          : (pushResult.metadata?.retryable ? 'retrying' : 'failed');

        pushDelivery.status = pushStatus;

        await this.updateDeliveryRecord(
          pushDelivery.id,
          pushStatus,
          pushResult.error,
          pushResult.metadata,
        );

        if (!pushResult.success && pushResult.metadata?.retryable === false) {
          await this.removeStalePushSubscription(reminder.user_id);
        }
      }
    }

    if (deliveryChannels.includes('slack')) {
      const slackDelivery = await this.createDeliveryRecord(reminder.id, reminder.user_id, 'slack');
      deliveries.push(slackDelivery);

      const slackResult = await slackService.sendReminderNotification(payload, {
        maxAttempts: this.maxRetryAttempts,
      });
      const slackStatus: DeliveryStatus = slackResult.success
        ? 'sent'
        : (slackResult.metadata?.retryable ? 'retrying' : 'failed');

      slackDelivery.status = slackStatus;

      await this.updateDeliveryRecord(
        slackDelivery.id,
        slackStatus,
        slackResult.error,
        slackResult.metadata,
      );
    }

    if (deliveryChannels.includes('telegram') && userPreferences.email_opt_ins.reminders) {
      const subPrefs = await this.getNotificationPreferences(reminder.subscription_id, reminder.user_id);
      if (!subPrefs.muted && subPrefs.channels.includes('telegram')) {
        const telegramDelivery = await this.createDeliveryRecord(reminder.id, reminder.user_id, 'telegram');
        deliveries.push(telegramDelivery);

        const telegramResult = await telegramBotService.sendRenewalReminder(reminder.user_id, payload, undefined, {
          maxAttempts: this.maxRetryAttempts,
        });
        const telegramStatus: DeliveryStatus = telegramResult.success
          ? 'sent'
          : (telegramResult.metadata?.retryable ? 'retrying' : 'failed');

        telegramDelivery.status = telegramStatus;

        await this.updateDeliveryRecord(
          telegramDelivery.id,
          telegramStatus,
          telegramResult.error,
          telegramResult.metadata,
        );
      }
    }

    await blockchainService.logReminderEvent(reminder.user_id, payload, deliveryChannels);

    const hasDeliveryProgress = deliveries.some((delivery) =>
      delivery.status === 'sent' || delivery.status === 'retrying',
    );

    const { error: reminderUpdateError } = await supabase
      .from('reminder_schedules')
      .update({
        status: hasDeliveryProgress ? 'sent' : 'failed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', reminder.id);

      if (reminderUpdateError) {
        logger.error(`Failed to update reminder ${reminder.id}:`, reminderUpdateError);
        throw reminderUpdateError;
      }
    } catch (error) {
      logger.error(`Error processing reminder ${reminder.id}:`, error);
      await this.markReminderAsFailed(reminder.id, String(error));
      throw error;
    }
  }

  private async retryDelivery(
    delivery: NotificationDelivery & { reminder_schedules: ReminderSchedule },
  ): Promise<void> {
    const reminder = delivery.reminder_schedules;
    const newAttemptCount = delivery.attempt_count + 1;
    const subscription = await this.getSubscription(reminder.subscription_id);
    if (!subscription) {
      await this.markDeliveryAsFailed(delivery.id, 'Subscription not found');
      return;
    }

    const payload: NotificationPayload = {
      title: `${subscription.name} Renewal Reminder`,
      body: `${subscription.name} will renew in ${reminder.days_before} day${reminder.days_before === 1 ? '' : 's'}`,
      subscription,
      reminderType: reminder.reminder_type,
      daysBefore: reminder.days_before,
      renewalDate: subscription.active_until || new Date().toISOString(),
    };

    let result: { success: boolean; error?: string; metadata?: Record<string, any> } = {
      success: false,
      error: 'Unknown delivery channel',
      metadata: { retryable: false },
    };

    if (delivery.channel === 'email') {
      const userProfile = await this.getUserProfile(delivery.user_id);
      if (!userProfile?.email) {
        await this.markDeliveryAsFailed(delivery.id, 'User email not found');
        return;
      }

      result = await emailService.sendReminderEmail(userProfile.email, payload, {
        maxAttempts: 1,
      });
    } else if (delivery.channel === 'push') {
      const pushSubscription = await this.getPushSubscription(delivery.user_id);
      if (!pushSubscription) {
        await this.markDeliveryAsFailed(delivery.id, 'Push subscription not found');
        return;
      }

      result = await pushService.sendPushNotification(pushSubscription, payload, {
        maxAttempts: 1,
      });

      if (!result.success && result.metadata?.retryable === false) {
        await this.removeStalePushSubscription(delivery.user_id);
      }
    } else if (delivery.channel === 'slack') {
      result = await slackService.sendReminderNotification(payload, {
        maxAttempts: 1,
      });
    } else if (delivery.channel === 'telegram') {
      result = await telegramBotService.sendRenewalReminder(delivery.user_id, payload, undefined, {
        maxAttempts: 1,
      });
    }

    if (result.success) {
      await this.updateDeliveryRecord(delivery.id, 'sent', undefined, result.metadata, newAttemptCount);
      return;
    }

    const retryable = result.metadata?.retryable !== false;
    if (!retryable || newAttemptCount >= this.maxRetryAttempts) {
      await this.markDeliveryAsFailed(delivery.id, result.error || 'Max attempts reached');
      return;
    }

    const delay = calculateBackoffDelay(newAttemptCount);
    const nextRetryAt = new Date(Date.now() + delay);

    await this.updateDeliveryRecord(
      delivery.id,
      'retrying',
      result.error,
      result.metadata,
      newAttemptCount,
      nextRetryAt.toISOString(),
    );
  }

  private async getSubscription(id: string): Promise<Subscription | null> {
    try {
      const { data, error } = await supabase.from('subscriptions').select('*').eq('id', id).single();
      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        logger.error(`Failed to fetch subscription ${id}:`, error);
        return null;
      }

      return (data as Subscription) || null;
    } catch (error) {
      logger.error(`Unexpected error fetching subscription ${id}:`, error);
      return null;
    }
  }

  private async getUserProfile(userId: string): Promise<UserProfile | null> {
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (!error && data) {
        return {
          id: data.id,
          email: data.email || '',
          full_name: data.full_name || data.display_name || null,
          timezone: data.timezone || 'UTC',
          currency: data.currency || 'USD',
        };
      }
    } catch {
      // fall through to auth/email account lookup
    }

    try {
      const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(userId);
      if (!authError && authUser?.user?.email) {
        return {
          id: userId,
          email: authUser.user.email,
          full_name: authUser.user.user_metadata?.full_name || null,
          timezone: authUser.user.user_metadata?.timezone || 'UTC',
          currency: authUser.user.user_metadata?.currency || 'USD',
        };
      }
    } catch (error) {
      logger.warn(`Could not fetch auth user email for ${userId}:`, error);
    }

    try {
      const { data: emailAccount } = await supabase
        .from('email_accounts')
        .select('email')
        .eq('user_id', userId)
        .eq('is_connected', true)
        .limit(1)
        .single();

      if (emailAccount?.email) {
        return {
          id: userId,
          email: emailAccount.email,
          full_name: null,
          timezone: 'UTC',
          currency: 'USD',
        };
      }
    } catch {
      // no-op
    }

    return null;
  }

  private async getPushSubscription(userId: string): Promise<PushSubscription | null> {
    try {
      const { data, error } = await supabase
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        logger.error(`Failed to fetch push subscription for ${userId}:`, error);
        return null;
      }

      if (!data) {
        return null;
      }

      return {
        endpoint: data.endpoint,
        keys: {
          p256dh: data.p256dh,
          auth: data.auth,
        },
      };
    } catch (error) {
      logger.error(`Unexpected error fetching push subscription for ${userId}:`, error);
      return null;
    }
  }

  private async removeStalePushSubscription(userId: string): Promise<void> {
    const { error } = await supabase.from('push_subscriptions').delete().eq('user_id', userId);
    if (error) {
      logger.warn(`Failed to remove stale push subscriptions for ${userId}:`, error);
    }
  }

  private async createDeliveryRecord(
    reminderScheduleId: string,
    userId: string,
    channel: NotificationDelivery['channel'],
  ): Promise<NotificationDelivery> {
    const { data, error } = await supabase
      .from('notification_deliveries')
      .insert({
        reminder_schedule_id: reminderScheduleId,
        user_id: userId,
        channel,
        status: 'pending',
        attempt_count: 0,
        max_attempts: this.maxRetryAttempts,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data as NotificationDelivery;
  }

  private async updateDeliveryRecord(
    deliveryId: string,
    status: DeliveryStatus,
    errorMessage?: string,
    metadata?: Record<string, any>,
    attemptCount = 1,
    nextRetryAt?: string,
  ): Promise<void> {
    const updateData: Record<string, unknown> = {
      status,
      attempt_count: attemptCount,
      last_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (errorMessage) {
      updateData.error_message = errorMessage;
    }

    if (metadata) {
      updateData.metadata = metadata;
    }

    if (status === 'retrying') {
      updateData.next_retry_at = nextRetryAt || new Date(Date.now() + calculateBackoffDelay(attemptCount)).toISOString();
    } else {
      updateData.next_retry_at = null;
    }

    const { error } = await supabase.from('notification_deliveries').update(updateData).eq('id', deliveryId);
    if (error) {
      throw error;
    }
  }

  private async markReminderAsFailed(reminderId: string, reason: string): Promise<void> {
    const { error } = await supabase
      .from('reminder_schedules')
      .update({
        status: 'failed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', reminderId);

    if (error) {
      logger.error(`Failed to mark reminder ${reminderId} as failed:`, error);
    }

    logger.warn(`Reminder ${reminderId} marked as failed: ${reason}`);
  }

  private async markDeliveryAsFailed(deliveryId: string, reason: string): Promise<void> {
    const { error } = await supabase
      .from('notification_deliveries')
      .update({
        status: 'failed',
        error_message: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', deliveryId);

    if (error) {
      logger.error(`Failed to mark delivery ${deliveryId} as failed:`, error);
    }
  }

  private async getNotificationPreferences(
    subscriptionId: string,
    userId: string,
  ): Promise<{
    reminder_days_before: number[];
    channels: string[];
    muted: boolean;
  }> {
    try {
      const override = await notificationPreferenceService.getPreferences(subscriptionId);
      if (override) {
        return {
          reminder_days_before: override.reminder_days_before,
          channels: override.channels,
          muted: override.muted,
        };
      }
    } catch (error) {
      logger.warn(`Could not fetch subscription-level prefs for ${subscriptionId}, falling back:`, error);
    }

    try {
      const userPrefs = await userPreferenceService.getPreferences(userId);
      return {
        reminder_days_before: userPrefs.reminder_timing ?? this.defaultDaysBefore,
        channels: userPrefs.notification_channels ?? ['email'],
        muted: false,
      };
    } catch (error) {
      logger.warn(`Could not fetch user-level prefs for ${userId}, using engine defaults:`, error);
    }

    return {
      reminder_days_before: this.defaultDaysBefore,
      channels: ['email'],
      muted: false,
    };
  }
}

export const reminderEngine = new ReminderEngine();
