import { supabase, databaseRepository, databaseRepository } from '../config/database';
import logger from '../config/logger';
import { sendSlackAlert } from './slack-service';
import { calculateMonthlySpend } from '@syncro/shared/subscription-math';
import { groupBy, uniqueIds } from '../utils/db-query-metrics';

type AlertType = 'budget_warning' | 'budget_exceeded';

interface ProfileRow {
  id: string;
  monthly_budget: number | null;
  budget_alert_threshold: number | null;
}

interface SubscriptionRow {
  user_id: string;
  price: number | null;
  billing_cycle: string | null;
}

function currentMonth(): string {
  return new Date().toISOString().substring(0, 7); // YYYY-MM
}

/**
 * Resolve the Slack webhook for each user, in three queries for the whole set
 * (owned teams, memberships, then the member teams still unaccounted for).
 */
async function getTeamSlackWebhooks(userIds: readonly string[]): Promise<Map<string, string>> {
  const webhooks = new Map<string, string>();
  if (userIds.length === 0) return webhooks;

  // Teams the users own take precedence.
  const { data: ownedTeams } = await databaseRepository
    .from('teams')
    .select('owner_id, slack_webhook_url')
    .in('owner_id', userIds);

  for (const team of (ownedTeams ?? []) as { owner_id: string; slack_webhook_url: string | null }[]) {
    if (team.slack_webhook_url && !webhooks.has(team.owner_id)) {
      webhooks.set(team.owner_id, team.slack_webhook_url);
    }
  }

  const remaining = userIds.filter((id) => !webhooks.has(id));
  if (remaining.length === 0) return webhooks;

  const { data: memberships } = await databaseRepository
    .from('team_members')
    .select('user_id, team_id')
    .in('user_id', remaining);

  const membershipRows = (memberships ?? []) as { user_id: string; team_id: string }[];
  const teamIds = uniqueIds(membershipRows.map((row) => row.team_id));
  if (teamIds.length === 0) return webhooks;

  const { data: teams } = await databaseRepository
    .from('teams')
    .select('id, slack_webhook_url')
    .in('id', teamIds);

  const webhookByTeam = new Map(
    ((teams ?? []) as { id: string; slack_webhook_url: string | null }[])
      .filter((team) => !!team.slack_webhook_url)
      .map((team) => [team.id, team.slack_webhook_url as string]),
  );

  for (const row of membershipRows) {
    const webhook = webhookByTeam.get(row.team_id);
    if (webhook && !webhooks.has(row.user_id)) {
      webhooks.set(row.user_id, webhook);
    }
  }

  return webhooks;
}

export async function checkBudgetAlerts(userId: string): Promise<void> {
  return checkBudgetAlertsForUsers([userId]);
}

/**
 * Check budget alerts for many users using a fixed number of queries
 * (issue #1095).
 *
 * The per-user path cost 5–8 queries (profile, subscriptions, up to two alert-log
 * reads, the notification insert, up to three Slack-webhook lookups and the
 * alert-log upsert), and the daily cron fanned it out over every user with a
 * budget — so a 10k-user deployment issued tens of thousands of queries per run.
 * This batches every lookup, leaving at most 8 queries for the whole run.
 *
 * @param userIds Users to check. Omit to check every user who has a budget set.
 */
export async function checkBudgetAlertsForUsers(userIds?: readonly string[]): Promise<void> {
  try {
    const month = currentMonth();

    let profileQuery = databaseRepository
      .from('profiles')
      .select('id, monthly_budget, budget_alert_threshold')
      .not('monthly_budget', 'is', null);

    if (userIds) {
      const ids = uniqueIds(userIds);
      if (ids.length === 0) return;
      profileQuery = profileQuery.in('id', ids);
    }

    const { data: profileRows } = await profileQuery;

    const profiles = ((profileRows ?? []) as ProfileRow[]).filter((p) => !!p.monthly_budget);
    if (profiles.length === 0) return;

    const ids = profiles.map((p) => p.id);

    const [{ data: subRows }, { data: alertRows }] = await Promise.all([
      databaseRepository
        .from('subscriptions')
        .select('user_id, price, billing_cycle')
        .in('user_id', ids)
        .eq('status', 'active'),
      databaseRepository
        .from('budget_alert_logs')
        .select('user_id, alert_type')
        .in('user_id', ids)
        .eq('month', month),
    ]);

    const subsByUser = groupBy((subRows ?? []) as SubscriptionRow[], (row) => row.user_id);

    const alertsSent = new Set(
      ((alertRows ?? []) as { user_id: string; alert_type: AlertType }[])
        .map((row) => `${row.user_id}:${row.alert_type}`),
    );

    interface PendingAlert {
      userId: string;
      alertType: AlertType;
      message: string;
      percentage: number;
      budget: number;
      monthlyTotal: number;
    }

    const pending: PendingAlert[] = [];

    for (const profile of profiles) {
      const budget = Number(profile.monthly_budget);
      const threshold = profile.budget_alert_threshold ?? 80;
      const monthlyTotal = calculateMonthlySpend(subsByUser.get(profile.id) ?? []);
      const percentage = (monthlyTotal / budget) * 100;

      let alertType: AlertType | null = null;
      let message = '';

      if (percentage >= 100 && !alertsSent.has(`${profile.id}:budget_exceeded`)) {
        alertType = 'budget_exceeded';
        message = `🚨 You've exceeded your $${budget.toFixed(2)} monthly subscription budget by $${(monthlyTotal - budget).toFixed(2)}`;
      } else if (percentage >= threshold && !alertsSent.has(`${profile.id}:budget_warning`)) {
        alertType = 'budget_warning';
        message = `⚠️ You've used ${percentage.toFixed(0)}% of your $${budget.toFixed(2)} monthly subscription budget ($${monthlyTotal.toFixed(2)}/$${budget.toFixed(2)})`;
      }

      if (alertType) {
        pending.push({ userId: profile.id, alertType, message, percentage, budget, monthlyTotal });
      }
    }

    if (pending.length === 0) return;

    // Insert in-app notifications
    await databaseRepository.from('notifications').insert(
      pending.map((alert) => ({
        user_id: alert.userId,
        type: alert.alertType,
        message: alert.message,
        metadata: {
          month,
          percentage: alert.percentage,
          limit: alert.budget,
          current: alert.monthlyTotal,
        },
        read: false,
      })),
    );

    // Send Slack alerts to any team that has a webhook configured
    const webhooks = await getTeamSlackWebhooks(pending.map((alert) => alert.userId));
    const slackSends: Promise<unknown>[] = [];
    for (const alert of pending) {
      const webhookUrl = webhooks.get(alert.userId);
      if (webhookUrl) slackSends.push(sendSlackAlert(webhookUrl, alert.message));
    }
    await Promise.allSettled(slackSends);

    await databaseRepository.from('budget_alert_logs').upsert(
      pending.map((alert) => ({
        user_id: alert.userId,
        alert_type: alert.alertType,
        month,
      })),
    );

    for (const alert of pending) {
      logger.info('Budget alert sent', {
        userId: alert.userId,
        alertType: alert.alertType,
        percentage: alert.percentage,
      });
    }
  } catch (err) {
    logger.error('checkBudgetAlerts failed', { userIds, err });
  }
}

/**
 * Returns how much adding a new subscription would push the monthly total,
 * and whether it would exceed the budget.
 */
export async function wouldExceedBudget(
  userId: string,
  newMonthlyAmount: number
): Promise<{ wouldExceed: boolean; newTotal: number; budget: number; overage: number } | null> {
  const { data: profile } = await databaseRepository
    .from('profiles')
    .select('monthly_budget')
    .eq('id', userId)
    .maybeSingle();

  if (!profile?.monthly_budget) return null;

  const { data: subs } = await databaseRepository
    .from('subscriptions')
    .select('price, billing_cycle')
    .eq('user_id', userId)
    .eq('status', 'active');

  const currentTotal = calculateMonthlySpend(subs ?? []);

  const budget = Number(profile.monthly_budget);
  const newTotal = currentTotal + newMonthlyAmount;

  return {
    wouldExceed: newTotal > budget,
    newTotal,
    budget,
    overage: Math.max(0, newTotal - budget),
  };
}
