import { supabase } from '../config/database';
import logger from '../config/logger';
import { emailService } from './email-service';
import { telegramBotService } from './telegram-bot-service';
import {
  DAY_MS,
  DEFAULT_BURN_WINDOW_DAYS,
  forecastFromPayments,
  isExhaustionWithinWindow,
  parseForecastWindowHours,
} from '../v3/spend-forecast';

const THRESHOLDS = [80, 100] as const;
/** Dedup-log threshold value for the forecast (time-to-exhaustion) alert. */
export const FORECAST_THRESHOLD = 0;
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

function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} minutes`;
  if (hours < 48) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}

export class SpendCapAlertService {
  async run(now = new Date()): Promise<number> {
    const { data: channels, error } = await supabase
      .from('payment_channels')
      .select('channel_id, user_id, balance, deposit_amount')
      .eq('state', 'active');
    if (error) throw new Error(`Failed to load channels for spend-cap alerts: ${error.message}`);

    const windowHours = parseForecastWindowHours(process.env.SPEND_FORECAST_ALERT_WINDOW_HOURS);
    const paymentsByChannel = await this.loadRecentPayments(now);

    let sent = 0;
    for (const channel of channels ?? []) {
      const cap = Number(channel.deposit_amount);
      if (!Number.isFinite(cap) || cap <= 0) continue;
      const balance = Number(channel.balance || 0);
      const spent = Math.max(0, cap - balance);
      const percentage = (spent / cap) * 100;
      const forecast = forecastFromPayments(balance, paymentsByChannel.get(channel.channel_id) ?? [], now.getTime());
      if (percentage < 100 && isExhaustionWithinWindow(forecast, windowHours)) {
        if (await this.sendThresholdAlert(channel, spent, cap, percentage, FORECAST_THRESHOLD, currentPeriodStart(now), forecast.hoursToExhaustion ?? undefined)) {
          sent += 1;
        }
      }
      for (const threshold of THRESHOLDS) {
        if (percentage < threshold) continue;
        if (await this.sendThresholdAlert(channel, spent, cap, percentage, threshold, currentPeriodStart(now))) {
          sent += 1;
        }
      }
    }
    return sent;
  }

  private async loadRecentPayments(now: Date): Promise<Map<string, { amount: number; createdAt: string }[]>> {
    const start = new Date(now.getTime() - DEFAULT_BURN_WINDOW_DAYS * DAY_MS).toISOString();
    const { data, error } = await supabase
      .from('channel_payments')
      .select('channel_id, amount, created_at')
      .gte('created_at', start)
      .lte('created_at', now.toISOString());
    if (error) throw new Error(`Failed to load payments for spend forecast: ${error.message}`);
    const byChannel = new Map<string, { amount: number; createdAt: string }[]>();
    for (const payment of data ?? []) {
      const list = byChannel.get(payment.channel_id) ?? [];
      list.push({ amount: Number(payment.amount || 0), createdAt: payment.created_at });
      byChannel.set(payment.channel_id, list);
    }
    return byChannel;
  }

  private async sendThresholdAlert(
    channel: { channel_id: string; user_id: string },
    spent: number,
    cap: number,
    percentage: number,
    threshold: number,
    periodStart: string,
    hoursToExhaustion?: number,
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

    const message = threshold === FORECAST_THRESHOLD
      ? `Spend forecast for agent ${channel.channel_id}: projected to run out in about ${formatDuration(hoursToExhaustion ?? 0)} at the current burn rate (${spent.toFixed(2)} of ${cap.toFixed(2)} used).`
      : threshold === 100
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
          await emailService.sendSimpleEmail(email, threshold === FORECAST_THRESHOLD ? 'SYNCRO spend forecast alert' : `SYNCRO spend-cap ${threshold}% alert`, message, {
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
