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
import { reminderDateBefore } from '@syncro/shared/subscription-math';
import { calculateBackoffDelay } from '../utils/retry';
import { userPreferenceService } from './user-preference-service';
import { notificationPreferenceService } from './notification-preference-service';
import { telegramBotService } from './telegram-bot-service';
import { nextOccurrence, ScheduleInterval } from './occurrence-scheduler';

export interface ReminderEngineOptions {
  defaultDaysBefore?: number[];
  maxRetryAttempts?: number;
}

type DeliveryStatus = 'sent' | 'failed' | 'retrying';

export function computeReminderDate(renewalDate: Date, daysBefore: number): Date {
  return reminderDateBefore(renewalDate, daysBefore);
}

export class ReminderEngine {
  private readonly defaultDaysBefore: number[];
  private readonly maxRetryAttempts: number;
  private readonly supabase: typeof supabase;
  private readonly logger: typeof logger;
  private readonly emailService: typeof emailService;
  private readonly pushService: typeof pushService;
  private readonly slackService: typeof slackService;
  private readonly blockchainService: typeof blockchainService;
  private readonly userPreferenceService: typeof import('./user-preference-service').userPreferenceService;
  private readonly notificationPreferenceService: typeof import('./notification-preference-service').notificationPreferenceService;
  private readonly telegramBotService: typeof import('./telegram-bot-service').telegramBotService;
  private readonly clock: import('./clock').Clock;

  constructor(
    options: ReminderEngineOptions & Partial<{
      supabase: typeof supabase;
      logger: typeof logger;
      emailService: typeof emailService;
      pushService: typeof pushService;
      slackService: typeof slackService;
      blockchainService: typeof blockchainService;
      userPreferenceService: typeof import('./user-preference-service').userPreferenceService;
      notificationPreferenceService: typeof import('./notification-preference-service').notificationPreferenceService;
      telegramBotService: typeof import('./telegram-bot-service').telegramBotService;
      clock: import('./clock').Clock;
    }>
  = {}) {
    this.defaultDaysBefore = options.defaultDaysBefore || [7, 3, 1];
    this.maxRetryAttempts = options.maxRetryAttempts || 3;

    this.supabase = options.supabase ?? supabase;
    this.logger = options.logger ?? logger;
    this.emailService = options.emailService ?? emailService;
    this.pushService = options.pushService ?? pushService;
    this.slackService = options.slackService ?? slackService;
    this.blockchainService = options.blockchainService ?? blockchainService;
    this.userPreferenceService = options.userPreferenceService ?? require('./user-preference-service').userPreferenceService;
    this.notificationPreferenceService = options.notificationPreferenceService ?? require('./notification-preference-service').notificationPreferenceService;
    this.telegramBotService = options.telegramBotService ?? require('./telegram-bot-service').telegramBotService;
    this.clock = options.clock ?? new (require('./clock').SystemClock)();
  }

  async processReminders(targetDate: Date = new Date()): Promise<void> {
    const dateString = targetDate.toISOString().split('T')[0];
    this.logger.info(`Processing reminders for date: ${dateString}`);

    const { data: reminders, error } = await this.supabase
      .from('reminder_schedules')
      .select('*')
      .eq('reminder_date', dateString)
      .eq('status', 'pending');

    if (error) {
      this.logger.error('Failed to fetch reminders:', error);
      throw error;
    }

    if (!reminders || reminders.length === 0) {
      this.logger.info(`No pending reminders found for ${dateString}`);
      return;
    }

    for (const reminder of reminders) {
      try {
        await this.processReminder(reminder as ReminderSchedule);
      } catch (processError) {
        this.logger.error(`Failed to process reminder ${reminder.id}:`, processError);
      }
    }
  }

  async processRetries(): Promise<void> {
    const now = this.clock.now().toISOString();
    this.logger.info('Processing delivery retries');

    const { data: deliveries, error } = await this.supabase
      .from('notification_deliveries')
      .select('*, reminder_schedules!inner(*)')
      .eq('status', 'retrying')
      .lte('next_retry_at', now)
      .lt('attempt_count', this.maxRetryAttempts);

    if (error) {
      this.logger.error('Failed to fetch retry deliveries:', error);
      throw error;
    }

    if (!deliveries || deliveries.length === 0) {
      this.logger.info('No deliveries need retry');
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

  async scheduleReminders(): Promise<void> {
    this.logger.info('[ReminderEngine] scheduleReminders noop — subscription reminders removed in v3.');
  }

  async scheduleTrialReminders(): Promise<void> {
    this.logger.info('[ReminderEngine] scheduleTrialReminders noop — subscription reminders removed in v3.');
  }

  async processDelayedNotifications(): Promise<void> {
    this.logger.info('ReminderEngine.processDelayedNotifications noop');
  }

  private async processReminder(reminder: ReminderSchedule): Promise<void> {
    this.logger.info('[ReminderEngine] processReminder noop — subscription reminders removed in v3, cancelling.', {
      reminderId: reminder.id,
      subscriptionId: reminder.subscription_id,
    });
    // Mark as cancelled instead of processing legacy subscription reminders.
    const { error } = await this.supabase
      .from('reminder_schedules')
      .update({
        status: 'cancelled',
        updated_at: this.clock.now().toISOString(),
      })
      .eq('id', reminder.id);
    if (error) {
      this.logger.error(`Failed to cancel legacy reminder ${reminder.id}:`, error);
    }
  }

  private async retryDelivery(
    delivery: NotificationDelivery & { reminder_schedules: ReminderSchedule },
  ): Promise<void> {
    this.logger.info('[ReminderEngine] retryDelivery noop — subscription reminders removed in v3, marking failed.', {
      deliveryId: delivery.id,
      channel: delivery.channel,
    });
    await this.markDeliveryAsFailed(delivery.id, 'Subscription reminders removed in v3');
  }

  private async getSubscription(id: string): Promise<Subscription | null> {
    try {
      const { data, error } = await this.supabase.from('subscriptions').select('*').eq('id', id).single();
      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        this.logger.error(`Failed to fetch subscription ${id}:`, error);
        return null;
      }

      return (data as Subscription) || null;
    } catch (error) {
      this.logger.error(`Unexpected error fetching subscription ${id}:`, error);
      return null;
    }
  }

  private async getUserProfile(userId: string): Promise<UserProfile | null> {
    try {
      const { data, error } = await this.supabase.from('profiles').select('*').eq('id', userId).single();
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
      const { data: authUser, error: authError } = await this.supabase.auth.admin.getUserById(userId);
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
      this.logger.warn(`Could not fetch auth user email for ${userId}:`, error);
    }

    try {
      const { data: emailAccount } = await this.supabase
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
      const { data, error } = await this.supabase
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
        this.logger.error(`Failed to fetch push subscription for ${userId}:`, error);
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
      this.logger.error(`Unexpected error fetching push subscription for ${userId}:`, error);
      return null;
    }
  }

  private async removeStalePushSubscription(userId: string): Promise<void> {
    const { error } = await this.supabase.from('push_subscriptions').delete().eq('user_id', userId);
    if (error) {
      this.logger.warn(`Failed to remove stale push subscriptions for ${userId}:`, error);
    }
  }

  private async createDeliveryRecord(
    reminderScheduleId: string,
    userId: string,
    channel: NotificationDelivery['channel'],
  ): Promise<NotificationDelivery> {
    const { data, error } = await this.supabase
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
      last_attempt_at: this.clock.now().toISOString(),
      updated_at: this.clock.now().toISOString(),
    };

    if (errorMessage) {
      updateData.error_message = errorMessage;
    }

    if (metadata) {
      updateData.metadata = metadata;
    }

    if (status === 'retrying') {
      updateData.next_retry_at = nextRetryAt || new Date(this.clock.now().getTime() + calculateBackoffDelay(attemptCount)).toISOString();
    } else {
      updateData.next_retry_at = null;
    }

    const { error } = await this.supabase.from('notification_deliveries').update(updateData).eq('id', deliveryId);
    if (error) {
      throw error;
    }
  }

  private async markReminderAsFailed(reminderId: string, reason: string): Promise<void> {
    const { error } = await this.supabase
      .from('reminder_schedules')
      .update({
        status: 'failed',
        updated_at: this.clock.now().toISOString(),
      })
      .eq('id', reminderId);

    if (error) {
      this.logger.error(`Failed to mark reminder ${reminderId} as failed:`, error);
    }

    this.logger.warn(`Reminder ${reminderId} marked as failed: ${reason}`);
  }

  private async markDeliveryAsFailed(deliveryId: string, reason: string): Promise<void> {
    const { error } = await this.supabase
      .from('notification_deliveries')
      .update({
        status: 'failed',
        error_message: reason,
        updated_at: this.clock.now().toISOString(),
      })
      .eq('id', deliveryId);

    if (error) {
      this.logger.error(`Failed to mark delivery ${deliveryId} as failed:`, error);
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
      const override = await this.notificationPreferenceService.getPreferences(subscriptionId);
      if (override) {
        return {
          reminder_days_before: override.reminder_days_before,
          channels: override.channels,
          muted: override.muted,
        };
      }
    } catch (error) {
      this.logger.warn(`Could not fetch subscription-level prefs for ${subscriptionId}, falling back:`, error);
    }

    try {
      const userPrefs = await this.userPreferenceService.getPreferences(userId);
      return {
        reminder_days_before: userPrefs.reminder_timing ?? this.defaultDaysBefore,
        channels: userPrefs.notification_channels ?? ['email'],
        muted: false,
      };
    } catch (error) {
      this.logger.warn(`Could not fetch user-level prefs for ${userId}, using engine defaults:`, error);
    }

    return {
      reminder_days_before: this.defaultDaysBefore,
      channels: ['email'],
      muted: false,
    };
  }
}

export const reminderEngine = new ReminderEngine();
