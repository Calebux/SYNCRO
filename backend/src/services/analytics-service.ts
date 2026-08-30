import { supabase } from '../config/database';
import logger from '../config/logger';
import {
  buildCategoryMonthlySpend,
  buildPastMonthlySpendTrend,
  calculateMonthlySpend,
  countUpcomingRenewals,
  getTopMonthlySpendSubscriptions,
  normalizeToMonthlyAmount,
  roundMoney,
} from '@syncro/shared/subscription-math';
import { AnalyticsSummary, MonthlySpend, CategorySpend, SubscriptionSpend, Budget } from '../types/analytics';
import { Subscription } from '../types/reminder';
import { groupBy, uniqueIds } from '../utils/db-query-metrics';
import { queryCacheService } from './query-cache-service';

/** The suggestion columns this service reads, keyed back to their owner. */
type SuggestionSaving = { user_id: string; savings_per_year: number | null };

export class AnalyticsService {
  /**
   * Get analytics summary for a user
   */
  async getSummary(userId: string): Promise<AnalyticsSummary> {
    const cached = await queryCacheService.get<AnalyticsSummary>(userId, 'analytics_summary', { type: 'summary' });
    if (cached) {
      return cached;
    }

    const summaries = await this.getSummaries([userId]);
    const summary = summaries.get(userId) ?? this.composeSummary([], [], []);

    await queryCacheService.set(
      userId,
      'analytics_summary',
      { type: 'summary' },
      summary,
      queryCacheService.getDefaultAnalyticsTtl(),
    );

    return summary;
  }

  /**
   * Get analytics summaries for many users in a fixed number of queries
   * (issue #1095).
   *
   * The per-user path costs three queries, so composing summaries for N users
   * in a loop cost 3N. This issues one subscriptions, one budgets and one
   * suggestions query for the whole set and fans the rows out in memory.
   *
   * The cache is deliberately left to `getSummary`: it is keyed per user, so
   * reading it here would reintroduce the per-user round trip this exists to
   * remove.
   */
  async getSummaries(userIds: readonly string[]): Promise<Map<string, AnalyticsSummary>> {
    const summaries = new Map<string, AnalyticsSummary>();
    const ids = uniqueIds(userIds);
    if (ids.length === 0) return summaries;

    try {
      const [subsRes, budgetsRes, suggestionsRes] = await Promise.all([
        supabase.from('subscriptions').select('*').in('user_id', ids).eq('status', 'active'),
        supabase.from('monthly_budgets').select('*').in('user_id', ids),
        supabase
          .from('suggestions')
          .select('user_id, savings_per_year')
          .in('user_id', ids)
          .eq('dismissed_until', null),
      ]);

      if (subsRes.error) throw subsRes.error;
      if (budgetsRes.error) throw budgetsRes.error;
      if (suggestionsRes.error) throw suggestionsRes.error;

      const subsByUser = groupBy((subsRes.data || []) as Subscription[], (sub) => sub.user_id);
      const budgetsByUser = groupBy((budgetsRes.data || []) as Budget[], (b) => b.user_id);
      const suggestionsByUser = groupBy(
        (suggestionsRes.data || []) as SuggestionSaving[],
        (s) => s.user_id,
      );

      for (const userId of ids) {
        summaries.set(
          userId,
          this.composeSummary(
            subsByUser.get(userId) ?? [],
            budgetsByUser.get(userId) ?? [],
            suggestionsByUser.get(userId) ?? [],
          ),
        );
      }

      return summaries;
    } catch (error) {
      logger.error('Error fetching analytics summary:', error);
      throw error;
    }
  }

  /**
   * Turn one user's subscription, budget and suggestion rows into a summary.
   * Pure — all DB access happens in `getSummaries`.
   */
  private composeSummary(
    subscriptions: Subscription[],
    budgets: Budget[],
    suggestions: SuggestionSaving[],
  ): AnalyticsSummary {
    const totalMonthlySpend = calculateMonthlySpend(subscriptions);
    const categoryBreakdown = this.formatCategoryBreakdown(subscriptions);
    const topSubscriptions = this.formatTopSubscriptions(subscriptions);
    const monthlyTrend = this.getMonthlyTrend(subscriptions);

    const overallBudget = budgets.find(b => b.category === null);
    const budgetStatus = {
      overall_limit: overallBudget?.budget_limit || null,
      current_spend: totalMonthlySpend,
      percentage: overallBudget ? (totalMonthlySpend / overallBudget.budget_limit) * 100 : 0
    };

    const upcomingRenewalsCount = countUpcomingRenewals(subscriptions, 7);
    const potentialSavingsMonthly = suggestions
      .filter(s => s.savings_per_year)
      .reduce((sum, s) => sum + (s.savings_per_year || 0) / 12, 0);

    return {
      total_monthly_spend: totalMonthlySpend,
      active_subscriptions: subscriptions.length,
      upcoming_renewals_count: upcomingRenewalsCount,
      monthly_trend: monthlyTrend,
      category_breakdown: categoryBreakdown,
      top_subscriptions: topSubscriptions,
      budget_status: budgetStatus,
      potential_savings_monthly: parseFloat(potentialSavingsMonthly.toFixed(2))
    };
  }

  private formatCategoryBreakdown(subscriptions: Subscription[]): CategorySpend[] {
    return buildCategoryMonthlySpend(subscriptions).map((category) => ({
      category: category.category,
      total_spend: category.totalMonthlySpend,
      percentage: category.percentage,
      count: category.count,
    }));
  }

  private formatTopSubscriptions(subscriptions: Subscription[]): SubscriptionSpend[] {
    return getTopMonthlySpendSubscriptions(subscriptions).map((subscription) => ({
      id: subscription.id ? String(subscription.id) : '',
      name: subscription.name ?? '',
      price: subscription.price,
      billing_cycle: subscription.billing_cycle,
      monthly_normalized_price: subscription.monthlyNormalizedPrice,
    }));
  }

  /**
   * Get monthly spend trend for the last 6 months.
   *
   * Projected from the subscription rows the caller already holds — it never
   * touched the database, so it no longer takes a userId or returns a promise.
   */
  private getMonthlyTrend(currentSubs: Subscription[]): MonthlySpend[] {
    // In a real app, this would query historical data or logs.
    // For now, we'll project the trend based on current subscriptions and created_at dates
    return buildPastMonthlySpendTrend(currentSubs).map((point) => ({
      month: point.month,
      total_spend: point.totalMonthlySpend,
      count: point.count,
    }));
  }

  /**
   * Get user budgets
   */
  async getUserBudgets(userId: string) {
    return await supabase
      .from('monthly_budgets')
      .select('*')
      .eq('user_id', userId);
  }

  /**
   * Upsert a budget
   */
  async upsertBudget(userId: string, budget: Partial<Budget>) {
    const { data, error } = await supabase
      .from('monthly_budgets')
      .upsert({
        ...budget,
        user_id: userId,
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      logger.error('Error upserting budget:', error);
      throw error;
    }

    await queryCacheService.invalidateUserNamespace(userId, 'analytics_summary');

    return data;
  }

  /**
   * Check if user has exceeded their budget and notify if necessary
   */
  async checkBudgetThreshold(userId: string): Promise<void> {
    return this.checkBudgetThresholds([userId]);
  }

  /**
   * Check budget thresholds for many users and raise any needed alerts
   * (issue #1095).
   *
   * Costs five queries for the whole set — three for the summaries, one
   * de-duplication read and one batched notification insert — instead of the
   * four-per-user the single-user path needed.
   */
  async checkBudgetThresholds(userIds: readonly string[]): Promise<void> {
    const ids = uniqueIds(userIds);
    if (ids.length === 0) return;

    try {
      const summaries = await this.getSummaries(ids);
      const monthStr = new Date().toISOString().substring(0, 7);

      // Users at or over the alert threshold.
      const breached = ids
        .map((userId) => ({ userId, summary: summaries.get(userId) }))
        .filter((entry): entry is { userId: string; summary: AnalyticsSummary } =>
          !!entry.summary &&
          !!entry.summary.budget_status.overall_limit &&
          entry.summary.budget_status.percentage >= 80,
        );

      if (breached.length === 0) return;

      // Check which users were already notified this month, to prevent spam.
      const { data: existing } = await supabase
        .from('notifications')
        .select('user_id')
        .in('user_id', breached.map((entry) => entry.userId))
        .eq('type', 'budget_alert')
        .like('message', `%${monthStr}%`); // Simple deduplication for the month

      const alreadyNotified = new Set(
        ((existing ?? []) as { user_id: string }[]).map((row) => row.user_id),
      );

      const notifications = breached
        .filter((entry) => !alreadyNotified.has(entry.userId))
        .map(({ userId, summary }) => {
          const { budget_status } = summary;
          const message = budget_status.percentage >= 100
            ? `Urgent: You have exceeded your monthly budget of $${budget_status.overall_limit}!`
            : `Warning: You have used ${budget_status.percentage.toFixed(1)}% of your monthly budget.`;

          logger.info('Budget alert triggered', { userId, percentage: budget_status.percentage });

          return {
            user_id: userId,
            type: 'budget_alert',
            message: `${message} (Current spend: $${budget_status.current_spend.toFixed(2)})`,
            metadata: {
              month: monthStr,
              percentage: budget_status.percentage,
              limit: budget_status.overall_limit
            },
            read: false,
            created_at: new Date().toISOString()
          };
        });

      if (notifications.length > 0) {
        await supabase.from('notifications').insert(notifications);
      }
    } catch (error) {
      logger.error('Error checking budget threshold:', error);
    }
  }

  /**
   * Get spending trends for the user
   */
  async getSpending(userId: string) {
    try {
      const { data: subscriptions, error: subError } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', userId);

      if (subError) throw subError;

      const typedSubs = (subscriptions || []) as Subscription[];
      const monthlyTrend = this.getMonthlyTrend(typedSubs);
      const categoryBreakdown = this.formatCategoryBreakdown(typedSubs);

      return {
        current_month_spend: calculateMonthlySpend(typedSubs),
        monthly_trend: monthlyTrend,
        category_breakdown: categoryBreakdown,
        active_subscriptions: typedSubs.length
      };
    } catch (error) {
      logger.error('Error fetching spending data:', error);
      throw error;
    }
  }

  /**
   * Get spending forecast for the next 6 months
   */
  async getForecast(userId: string) {
    try {
      const { data: subscriptions, error: subError } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active');

      if (subError) throw subError;

      const typedSubs = (subscriptions || []) as Subscription[];
      const forecast: MonthlySpend[] = [];
      const now = new Date();

      // Generate forecast for next 6 months
      for (let i = 0; i < 6; i++) {
        const targetDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const monthStr = targetDate.toISOString().substring(0, 7);
        
        let monthlyTotal = 0;
        let count = 0;

        // Calculate spend for each active subscription in this month
        for (const sub of typedSubs) {
          const createdAt = new Date(sub.created_at);
          const nextBillingDate = sub.next_billing_date ? new Date(sub.next_billing_date) : createdAt;
          
          // Check if subscription will be active in this month
          if (createdAt <= new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0)) {
            monthlyTotal += normalizeToMonthlyAmount(sub.price, sub.billing_cycle);
            count++;
          }
        }

        forecast.push({
          month: monthStr,
          total_spend: roundMoney(monthlyTotal),
          count: count
        });
      }

      return {
        forecast,
        avg_projected_monthly_spend: parseFloat((forecast.reduce((sum, m) => sum + m.total_spend, 0) / forecast.length).toFixed(2))
      };
    } catch (error) {
      logger.error('Error fetching forecast data:', error);
      throw error;
    }
  }
}

export const analyticsService = new AnalyticsService();
