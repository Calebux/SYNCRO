import { supabase } from '../config/database';
import logger from '../config/logger';
import { emailService } from './email-service';
import { telegramBotService } from './telegram-bot-service';

const THRESHOLDS = [80, 100] as const;
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

function currentPeriodStart(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

export class SpendCapAlertService {
  async run(now = new Date()): Promise<number> {
    const { data: channels, error } = await supabase
      .from('payment_channels')
      .select('channel_id, user_id, balance, deposit_amount')
      .eq('state', 'active');
    if (error) throw new Error(`Failed to load channels for spend-cap alerts: ${error.message}`);

    let sent = 0;
    for (const channel of channels ?? []) {
      const cap = Number(channel.deposit_amount);
      if (!Number.isFinite(cap) || cap <= 0) continue;
      const spent = Math.max(0, cap - Number(channel.balance || 0));
      const percentage = (spent / cap) * 100;
      for (const threshold of THRESHOLDS) {
        if (percentage < threshold) continue;
        if (await this.sendThresholdAlert(channel, spent, cap, percentage, threshold, currentPeriodStart(now))) {
          sent += 1;
        }
      }
    }
    return sent;
  }

  private async sendThresholdAlert(
    channel: { channel_id: string; user_id: string },
    spent: number,
    cap: number,
    percentage: number,
    threshold: number,
    periodStart: string,
  ): Promise<boolean> {
    const { data: preferences, error: preferenceError } = await supabase
      .from('user_preferences')
      .select('spend_cap_alert_channels')
      .eq('user_id', channel.user_id)
      .maybeSingle();
    if (preferenceError) {
      throw new Error(`Failed to read spend-cap notification preferences: ${preferenceError.message}`);
    }
    const channels = (preferences?.spend_cap_alert_channels ?? []) as ('email' | 'telegram')[];
    if (channels.length === 0) return false;

    const message = threshold === 100
      ? `Spend cap reached for agent ${channel.channel_id}: ${spent.toFixed(2)} of ${cap.toFixed(2)} (${percentage.toFixed(0)}%).`
      : `Spend cap warning for agent ${channel.channel_id}: ${percentage.toFixed(0)}% used (${spent.toFixed(2)} of ${cap.toFixed(2)}).`;

    let delivered = false;
    for (const notificationChannel of channels) {
      const { data: log, error: logError } = await supabase
        .from('spend_cap_alert_logs')
        .insert({
          user_id: channel.user_id,
          channel_id: channel.channel_id,
          threshold,
          period_start: periodStart,
          notification_channel: notificationChannel,
        })
        .select('id')
        .single();
      if (logError?.code === '23505') continue;
      if (logError) throw new Error(`Failed to record spend-cap alert: ${logError.message}`);

      try {
        if (notificationChannel === 'email') {
          const { data, error } = await supabase.auth.admin.getUserById(channel.user_id);
          if (error) throw error;
          const email = data.user?.email;
          if (!email) throw new Error('Principal account has no email address.');
          await emailService.sendSimpleEmail(email, `SYNCRO spend-cap ${threshold}% alert`, message, {
            userId: channel.user_id,
            emailType: 'notifications',
            html: `<p>${escapeHtml(message)}</p>`,
          });
        } else {
          const result = await telegramBotService.sendSimpleMessage(channel.user_id, escapeHtml(message));
          if (!result.success) throw new Error(result.error || 'Telegram delivery failed.');
        }
        delivered = true;
      } catch (deliveryError) {
        const { error: deleteError } = await supabase
          .from('spend_cap_alert_logs')
          .delete()
          .eq('id', log.id);
        if (deleteError) {
          logger.error('Could not release failed spend-cap alert deduplication record', {
            alertId: log.id,
            error: deleteError.message,
          });
        }
        throw deliveryError;
      }
    }
    return delivered;
  }
}

export const spendCapAlertService = new SpendCapAlertService();
