import { supabase } from '../config/database';
import logger from '../config/logger';
import { NotificationPayload, NotificationPriority } from '../types/reminder';

export interface DelayedNotification {
  id: string;
  user_id: string;
  reminder_schedule_id: string;
  notification_payload: NotificationPayload;
  original_send_time: string;
  scheduled_send_time: string;
  priority: NotificationPriority;
  status: 'pending' | 'sent' | 'cancelled';
  delay_reason: string | null;
  created_at: string;
  updated_at: string;
}

export class DelayedNotificationService {
  /**
   * Store a notification to be sent later
   */
  async storeDelayedNotification(
    userId: string,
    reminderScheduleId: string,
    payload: NotificationPayload,
    scheduledSendTime: Date,
    priority: NotificationPriority,
    delayReason?: string
  ): Promise<DelayedNotification> {
    try {
      const { data, error } = await supabase
        .from('delayed_notifications')
        .insert({
          user_id: userId,
          reminder_schedule_id: reminderScheduleId,
          notification_payload: payload,
          original_send_time: new Date().toISOString(),
          scheduled_send_time: scheduledSendTime.toISOString(),
          priority,
          delay_reason: delayReason,
        })
        .select()
        .single();

      if (error) {
        logger.error('Failed to store delayed notification:', error);
        throw new Error(`Failed to store delayed notification: ${error.message}`);
      }

      logger.info('Delayed notification stored', {
        id: data.id,
        userId,
        scheduledSendTime: scheduledSendTime.toISOString(),
        priority,
      });

      return data as DelayedNotification;
    } catch (error) {
      logger.error('Error storing delayed notification:', error);
      throw error;
    }
  }

  /**
   * Get pending delayed notifications that are ready to be sent
   */
  async getPendingDelayedNotifications(currentTime: Date = new Date()): Promise<DelayedNotification[]> {
    try {
      const { data, error } = await supabase
        .from('delayed_notifications')
        .select('*')
        .eq('status', 'pending')
        .lte('scheduled_send_time', currentTime.toISOString())
        .order('scheduled_send_time', { ascending: true });

      if (error) {
        logger.error('Failed to fetch pending delayed notifications:', error);
        throw new Error(`Failed to fetch delayed notifications: ${error.message}`);
      }

      return (data || []) as DelayedNotification[];
    } catch (error) {
      logger.error('Error fetching pending delayed notifications:', error);
      throw error;
    }
  }

  /**
   * Mark a delayed notification as sent
   */
  async markDelayedNotificationAsSent(notificationId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('delayed_notifications')
        .update({
          status: 'sent',
          updated_at: new Date().toISOString(),
        })
        .eq('id', notificationId);

      if (error) {
        logger.error(`Failed to mark delayed notification ${notificationId} as sent:`, error);
        throw new Error(`Failed to update delayed notification: ${error.message}`);
      }

      logger.info(`Delayed notification ${notificationId} marked as sent`);
    } catch (error) {
      logger.error('Error marking delayed notification as sent:', error);
      throw error;
    }
  }

  /**
   * Cancel delayed notifications for a specific reminder schedule
   */
  async cancelDelayedNotifications(reminderScheduleId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('delayed_notifications')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString(),
        })
        .eq('reminder_schedule_id', reminderScheduleId)
        .eq('status', 'pending');

      if (error) {
        logger.error(`Failed to cancel delayed notifications for reminder ${reminderScheduleId}:`, error);
        throw new Error(`Failed to cancel delayed notifications: ${error.message}`);
      }

      logger.info(`Delayed notifications cancelled for reminder ${reminderScheduleId}`);
    } catch (error) {
      logger.error('Error cancelling delayed notifications:', error);
      throw error;
    }
  }

  /**
   * Get delayed notifications for a user (for debugging/admin purposes)
   */
  async getUserDelayedNotifications(
    userId: string,
    status?: DelayedNotification['status']
  ): Promise<DelayedNotification[]> {
    try {
      let query = supabase
        .from('delayed_notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query;

      if (error) {
        logger.error(`Failed to fetch delayed notifications for user ${userId}:`, error);
        throw new Error(`Failed to fetch user delayed notifications: ${error.message}`);
      }

      return (data || []) as DelayedNotification[];
    } catch (error) {
      logger.error('Error fetching user delayed notifications:', error);
      throw error;
    }
  }

  /**
   * Clean up old delayed notifications (sent or cancelled)
   */
  async cleanupOldDelayedNotifications(olderThanDays: number = 30): Promise<void> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const { error } = await supabase
        .from('delayed_notifications')
        .delete()
        .in('status', ['sent', 'cancelled'])
        .lt('updated_at', cutoffDate.toISOString());

      if (error) {
        logger.error('Failed to cleanup old delayed notifications:', error);
        throw new Error(`Failed to cleanup delayed notifications: ${error.message}`);
      }

      logger.info(`Cleaned up delayed notifications older than ${olderThanDays} days`);
    } catch (error) {
      logger.error('Error cleaning up old delayed notifications:', error);
      throw error;
    }
  }
}

export const delayedNotificationService = new DelayedNotificationService();