import logger from '../config/logger';
import { supabase } from '../config/database';
import {
  V3NotificationEventType,
  V3_EVENT_CLASSIFICATIONS,
  V3NotificationPreferences,
  DEFAULT_V3_PRINCIPAL_PREFERENCES,
  DEFAULT_V3_OPERATOR_PREFERENCES,
  V3NotificationDispatchInput,
  NotificationChannel,
} from '../types/v3-notifications';
import { renderV3Notification, renderV3Telegram, renderV3Slack } from './v3-notification-templates';
import { pushService, PushSubscription } from './push-service';
import { telegramBotService } from './telegram-bot-service';
import { slackService, sendSlackAlert } from './slack-service';
import { roleService } from './role-service';
import { userPreferenceService } from './user-preference-service';

const OPERATOR_ROLES = new Set(['owner', 'admin']);

class V3NotificationDispatchService {
  private async resolveOperatorUserIds(): Promise<string[]> {
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('user_id, role');
      if (error) throw error;
      return (data ?? [])
        .filter((row) => OPERATOR_ROLES.has((row as any).role))
        .map((row) => (row as any).user_id);
    } catch (err) {
      logger.error('[V3Dispatch] Failed to resolve operator users', { error: err instanceof Error ? err.message : String(err) });
      return [];
    }
  }

  private async getUserNotificationPreferences(
    userId: string,
  ): Promise<V3NotificationPreferences> {
    try {
      const { data, error } = await supabase
        .from('user_preferences')
        .select('v3_notification_preferences')
        .eq('user_id', userId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;

      const stored = (data as any)?.v3_notification_preferences as V3NotificationPreferences | undefined;
      const role = await roleService.getUserRole(userId);
      const isOperator = OPERATOR_ROLES.has(role);
      const defaults = isOperator ? DEFAULT_V3_OPERATOR_PREFERENCES : DEFAULT_V3_PRINCIPAL_PREFERENCES;

      if (!stored) return defaults;

      const merged: V3NotificationPreferences = { ...defaults } as V3NotificationPreferences;
      for (const key of Object.keys(defaults) as V3NotificationEventType[]) {
        merged[key] = {
          enabled: stored[key]?.enabled ?? defaults[key].enabled,
          channels: stored[key]?.channels ?? defaults[key].channels,
        };
      }
      return merged;
    } catch (err) {
      logger.warn('[V3Dispatch] Failed to fetch per-event preferences, using defaults', { userId, error: err instanceof Error ? err.message : String(err) });
      const role = await roleService.getUserRole(userId).catch(() => 'member' as const);
      return OPERATOR_ROLES.has(role) ? DEFAULT_V3_OPERATOR_PREFERENCES : DEFAULT_V3_PRINCIPAL_PREFERENCES;
    }
  }

  private async isEventEnabledForUser(
    userId: string,
    eventType: V3NotificationEventType,
  ): Promise<{ enabled: boolean; channels: NotificationChannel[] }> {
    const prefs = await this.getUserNotificationPreferences(userId);
    const pref = prefs[eventType];
    return { enabled: pref.enabled, channels: pref.channels };
  }

  private async getPushSubscriptions(userId: string): Promise<PushSubscription[]> {
    try {
      const { data, error } = await supabase
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .eq('user_id', userId);
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      }));
    } catch (err) {
      logger.warn('[V3Dispatch] Failed to fetch push subscriptions', { userId, error: err instanceof Error ? err.message : String(err) });
      return [];
    }
  }

  private async getTeamSlackWebhook(userId: string): Promise<string | null> {
    try {
      const { data: ownedTeam } = await supabase
        .from('teams')
        .select('slack_webhook_url')
        .eq('owner_id', userId)
        .maybeSingle();
      if ((ownedTeam as any)?.slack_webhook_url) return (ownedTeam as any).slack_webhook_url;

      const { data: membership } = await supabase
        .from('team_members')
        .select('team_id')
        .eq('user_id', userId)
        .maybeSingle();
      if (!membership) return null;

      const { data: team } = await supabase
        .from('teams')
        .select('slack_webhook_url')
        .eq('id', (membership as any).team_id)
        .maybeSingle();
      return (team as any)?.slack_webhook_url ?? null;
    } catch {
      return null;
    }
  }

  private async storeInAppNotification(
    userId: string,
    eventType: V3NotificationEventType,
    title: string,
    body: string,
    metadata: Record<string, unknown>,
    url?: string,
  ): Promise<void> {
    try {
      await supabase.from('notifications').insert({
        user_id: userId,
        type: eventType,
        title,
        message: body,
        metadata,
        url,
        read: false,
      });
    } catch (err) {
      logger.warn('[V3Dispatch] Failed to persist in-app notification', { userId, eventType, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async dispatchToUser(
    userId: string,
    eventType: V3NotificationEventType,
    payload: any,
    url?: string,
  ): Promise<void> {
    const { enabled, channels } = await this.isEventEnabledForUser(userId, eventType);
    if (!enabled) {
      logger.debug('[V3Dispatch] Event disabled per user preferences', { userId, eventType });
      return;
    }

    const rendered = renderV3Notification(eventType, payload);
    const finalUrl = url || rendered.url;

    const transportPromises: Promise<unknown>[] = [];

    if (channels.includes('push')) {
      transportPromises.push((async () => {
        const subs = await this.getPushSubscriptions(userId);
        for (const sub of subs) {
          try {
            await pushService.send(sub, {
              title: rendered.title,
              body: rendered.body,
              url: finalUrl,
            });
          } catch (err) {
            logger.warn('[V3Dispatch] Push transport failed', { userId, eventType, error: err instanceof Error ? err.message : String(err) });
          }
        }
      })());
    }

    if (channels.includes('telegram')) {
      transportPromises.push((async () => {
        try {
          const message = renderV3Telegram(eventType, payload);
          await telegramBotService.sendSimpleMessage(userId, message);
        } catch (err) {
          logger.warn('[V3Dispatch] Telegram transport failed', { userId, eventType, error: err instanceof Error ? err.message : String(err) });
        }
      })());
    }

    if (channels.includes('slack')) {
      transportPromises.push((async () => {
        try {
          const slackMsg = renderV3Slack(eventType, payload);
          const webhook = await this.getTeamSlackWebhook(userId);
          if (webhook) {
            await sendSlackAlert(webhook, slackMsg.text);
          } else {
            const res = await slackService.sendCustomMessage(slackMsg.text, { maxAttempts: 1 });
            if (!res.success) logger.debug('[V3Dispatch] Slack global webhook not configured', { userId, eventType });
          }
        } catch (err) {
          logger.warn('[V3Dispatch] Slack transport failed', { userId, eventType, error: err instanceof Error ? err.message : String(err) });
        }
      })());
    }

    transportPromises.push(
      this.storeInAppNotification(userId, eventType, rendered.title, rendered.body, { eventType, payload, ...rendered } as Record<string, unknown>, finalUrl),
    );

    await Promise.allSettled(transportPromises);
  }

  async dispatch(input: V3NotificationDispatchInput): Promise<void> {
    const { eventType, targetUserId, payload, url } = input;
    const classification = V3_EVENT_CLASSIFICATIONS[eventType];
    if (!classification) {
      throw new Error(`Unknown v3 notification event type: ${eventType}`);
    }

    const startTime = Date.now();
    logger.info('[V3Dispatch] Dispatching v3 event', { eventType, audience: classification.audience, targetUserId });

    try {
      if (classification.audience === 'principal') {
        if (!targetUserId) {
          throw new Error(`Principal-facing event ${eventType} requires targetUserId`);
        }
        await this.dispatchToUser(targetUserId, eventType, payload, url);
      } else {
        const operatorIds = await this.resolveOperatorUserIds();
        if (operatorIds.length === 0) {
          logger.warn('[V3Dispatch] No operator users found for operator-facing event', { eventType });
          return;
        }
        const results = await Promise.allSettled(
          operatorIds.map((id) => this.dispatchToUser(id, eventType, payload, url)),
        );
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed > 0) {
          logger.warn('[V3Dispatch] Some operator dispatches failed', { eventType, failed, total: operatorIds.length });
        }
      }
      logger.info('[V3Dispatch] Dispatch complete', { eventType, durationMs: Date.now() - startTime });
    } catch (err) {
      logger.error('[V3Dispatch] Dispatch failed', {
        eventType,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      throw err;
    }
  }

  async dispatchMany(inputs: V3NotificationDispatchInput[]): Promise<void> {
    await Promise.allSettled(inputs.map((i) => this.dispatch(i)));
  }

  async getUserPreferences(userId: string): Promise<V3NotificationPreferences> {
    return this.getUserNotificationPreferences(userId);
  }

  async upsertUserPreferences(
    userId: string,
    updates: Partial<V3NotificationPreferences>,
  ): Promise<V3NotificationPreferences> {
    const current = await this.getUserNotificationPreferences(userId);
    const merged: V3NotificationPreferences = { ...current } as V3NotificationPreferences;
    for (const key of Object.keys(updates) as V3NotificationEventType[]) {
      const update = updates[key];
      if (update) {
        merged[key] = {
          enabled: update.enabled ?? merged[key].enabled,
          channels: update.channels ?? merged[key].channels,
        };
      }
    }

    const { data, error } = await supabase
      .from('user_preferences')
      .upsert({
        user_id: userId,
        v3_notification_preferences: merged,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) throw new Error(`Failed to save v3 preferences: ${error.message}`);

    return (data as any).v3_notification_preferences as V3NotificationPreferences ?? merged;
  }
}

export const v3NotificationDispatch = new V3NotificationDispatchService();
export default v3NotificationDispatch;
