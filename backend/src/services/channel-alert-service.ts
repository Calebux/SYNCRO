import { supabase, databaseRepository, databaseRepository } from '../config/database';
import logger from '../config/logger';
import { sendSlackAlert } from './slack-service';
import { channelStateService } from './channel-state';
import { paymentChannelService } from './payment-channel-service';

type ChannelAlertType =
  | 'channel_expiry_7d'
  | 'channel_expiry_3d'
  | 'channel_expiry_1d'
  | 'channel_low_balance';

async function wasAlertSent(
  userId: string,
  channelId: string,
  alertType: ChannelAlertType,
): Promise<boolean> {
  const { data } = await databaseRepository
    .from('channel_alert_logs')
    .select('id')
    .eq('user_id', userId)
    .eq('channel_id', channelId)
    .eq('alert_type', alertType)
    .maybeSingle();
  return !!data;
}

async function recordAlert(
  userId: string,
  channelId: string,
  alertType: ChannelAlertType,
): Promise<void> {
  await databaseRepository.from('channel_alert_logs').upsert({
    user_id: userId,
    channel_id: channelId,
    alert_type: alertType,
    sent_at: new Date().toISOString(),
  });
}

async function getNotificationChannels(userId: string): Promise<string[]> {
  const { data } = await databaseRepository
    .from('user_preferences')
    .select('notification_channels')
    .eq('user_id', userId)
    .maybeSingle();

  return (data?.notification_channels as string[] | undefined) ?? ['email'];
}

async function getTeamSlackWebhook(userId: string): Promise<string | null> {
  const { data: ownedTeam } = await databaseRepository
    .from('teams')
    .select('slack_webhook_url')
    .eq('owner_id', userId)
    .maybeSingle();
  if (ownedTeam?.slack_webhook_url) return ownedTeam.slack_webhook_url;

  const { data: membership } = await databaseRepository
    .from('team_members')
    .select('team_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (!membership) return null;

  const { data: team } = await databaseRepository
    .from('teams')
    .select('slack_webhook_url')
    .eq('id', membership.team_id)
    .maybeSingle();
  return team?.slack_webhook_url ?? null;
}

async function dispatchAlert(
  userId: string,
  type: ChannelAlertType,
  message: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const channels = await getNotificationChannels(userId);

  if (channels.includes('email') || channels.includes('push')) {
    await databaseRepository.from('notifications').insert({
      user_id: userId,
      type,
      message,
      metadata,
      read: false,
    });
  }

  if (channels.includes('slack')) {
    const webhook = await getTeamSlackWebhook(userId);
    if (webhook) await sendSlackAlert(webhook, message);
  }
}

export async function checkChannelAlertsForUser(userId: string): Promise<void> {
  const channels = await paymentChannelService.listChannels(userId);
  const active = channels.filter((c) => c.state === 'active');
  if (active.length === 0) return;

  const avgRenewal = await channelStateService.getAverageRenewalAmount(userId);
  const prefs = await channelStateService.getChannelPreferences(userId);

  for (const channel of active) {
    const health = channelStateService.assessChannel(channel, avgRenewal);

    if (health.expired) {
      await channelStateService.closeExpiredChannel(userId, channel.id);
      continue;
    }

    const expiryThreshold = channelStateService.getExpiryAlertThreshold(
      health.expiryDaysRemaining,
    );
    if (expiryThreshold) {
      const alertType = `channel_expiry_${expiryThreshold}d` as ChannelAlertType;
      if (!(await wasAlertSent(userId, channel.id, alertType))) {
        const message = `Payment channel expires in ${health.expiryDaysRemaining} day(s). Close or renew to avoid disputes.`;
        await dispatchAlert(userId, alertType, message, {
          channelId: channel.id,
          daysRemaining: health.expiryDaysRemaining,
        });
        await recordAlert(userId, channel.id, alertType);
      }
    }

    if (channelStateService.isLowBalance(health.renewalsRemaining)) {
      const alertType: ChannelAlertType = 'channel_low_balance';
      if (!(await wasAlertSent(userId, channel.id, alertType))) {
        const message = `Payment channel balance covers fewer than 2 renewal cycles. Consider topping up.`;
        await dispatchAlert(userId, alertType, message, {
          channelId: channel.id,
          renewalsRemaining: health.renewalsRemaining,
        });
        await recordAlert(userId, channel.id, alertType);

        if (prefs.autoTopUp) {
          const topUpAmount = prefs.autoTopUpAmount ?? avgRenewal * 3;
          try {
            await paymentChannelService.topUp(userId, channel.id, topUpAmount);
            logger.info('Channel auto-top-up applied', { userId, channelId: channel.id, topUpAmount });
          } catch (err) {
            logger.error('Channel auto-top-up failed', { userId, channelId: channel.id, err });
          }
        }
      }
    }
  }
}

export async function runChannelMonitor(): Promise<void> {
  const channels = await channelStateService.listActiveChannels();
  const userIds = [...new Set(channels.map((c) => c.userId))];
  await Promise.allSettled(userIds.map((id) => checkChannelAlertsForUser(id)));
}
