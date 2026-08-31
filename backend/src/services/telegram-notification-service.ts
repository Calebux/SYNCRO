import logger from '../config/logger';
import { supabase } from '../config/database';
import { telegramBotService } from './telegram-bot-service';
import { userPreferenceService } from './user-preference-service';
import { normalizeToMonthlyAmount } from '@syncro/shared/subscription-math';
import type { Subscription } from '../types/subscription';

/**
 * Telegram notification delivery for renewals, payments, and spending summaries.
 */
export class TelegramNotificationService {
  async isTelegramEnabled(userId: string): Promise<boolean> {
    const prefs = await userPreferenceService.getPreferences(userId);
    return prefs.notification_channels.includes('telegram');
  }

  async sendPaymentConfirmation(
    userId: string,
    params: {
      subscriptionName: string;
      amount: number;
      currency?: string;
      billingCycle?: string;
      transactionHash?: string;
    },
  ): Promise<void> {
    if (!(await this.isTelegramEnabled(userId))) {
      return;
    }

    const currency = params.currency ?? 'USD';
    const message = [
      '✅ <b>Payment Confirmed</b>',
      '',
      `<b>${params.subscriptionName}</b>`,
      `💰 Amount: ${currency} ${params.amount.toFixed(2)}/${params.billingCycle ?? 'period'}`,
      params.transactionHash ? `🔗 Tx: <code>${params.transactionHash.slice(0, 16)}…</code>` : '',
    ]
      .filter(Boolean)
      .join('\n');

    await telegramBotService.sendSimpleMessage(userId, message);
  }

  async sendWeeklySpendingSummary(userId: string): Promise<void> {
    if (!(await this.isTelegramEnabled(userId))) {
      return;
    }

    const prefs = await userPreferenceService.getPreferences(userId);
    if (!prefs.email_opt_ins?.reminders) {
      logger.debug('[TelegramNotification] User opted out of reminder notifications');
      return;
    }

    const { data: subscriptions, error } = await supabase
      .from('subscriptions')
      .select('name, price, currency, billing_cycle, status')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (error) {
      logger.error('[TelegramNotification] Failed to fetch subscriptions for weekly summary', { error });
      return;
    }

    const subs = (subscriptions ?? []) as Subscription[];
    if (subs.length === 0) {
      await telegramBotService.sendSimpleMessage(
        userId,
        '📊 <b>Weekly Spending Summary</b>\n\nNo active subscriptions this week.',
      );
      return;
    }

    const totalMonthly = subs.reduce(
      (sum, s) => sum + normalizeToMonthlyAmount(s.price, s.billing_cycle),
      0,
    );

    const topThree = [...subs]
      .sort((a, b) => normalizeToMonthlyAmount(b.price, b.billing_cycle) - normalizeToMonthlyAmount(a.price, a.billing_cycle))
      .slice(0, 3);

    const lines = topThree.map(
      (s, i) =>
        `${i + 1}. ${s.name} — ${s.currency} ${normalizeToMonthlyAmount(s.price, s.billing_cycle).toFixed(2)}/mo`,
    );

    const message = [
      '📊 <b>Weekly Spending Summary</b>',
      '',
      `💳 <b>Total:</b> ${subs[0]?.currency ?? 'USD'} ${totalMonthly.toFixed(2)}/mo`,
      `📦 <b>Active subscriptions:</b> ${subs.length}`,
      '',
      '<b>Top spenders:</b>',
      ...lines,
    ].join('\n');

    await telegramBotService.sendSimpleMessage(userId, message);
  }

  async sendWeeklySummariesToAllUsers(): Promise<number> {
    const { data: connections, error } = await supabase
      .from('user_telegram_connections')
      .select('user_id');

    if (error || !connections?.length) {
      return 0;
    }

    let sent = 0;
    for (const conn of connections) {
      try {
        await this.sendWeeklySpendingSummary(conn.user_id);
        sent++;
      } catch (err) {
        logger.error('[TelegramNotification] Weekly summary failed', {
          userId: conn.user_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info('[TelegramNotification] Weekly summaries sent', { sent });
    return sent;
  }
}

export const telegramNotificationService = new TelegramNotificationService();
