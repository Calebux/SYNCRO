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
import { Subscription, UserPreferences } from '../types/reminder';
import { CurrencyConverter } from './currency-converter';
import { groupBy, uniqueIds } from '../utils/db-query-metrics';
import { queryCacheService } from './query-cache-service';

/** The suggestion columns this service reads, keyed back to their owner. */
type SuggestionSaving = { user_id: string; savings_per_year: number | null };

export class AnalyticsService {
  private readonly currencyConverter: CurrencyConverter;

  constructor(currencyConverter?: CurrencyConverter) {
    this.currencyConverter = currencyConverter ?? new CurrencyConverter();
  }

  /**
   * Get analytics summary for a user
   */
  async getSummary(userId: string): Promise<AnalyticsSummary> {
    const cached = await queryCacheService.get<AnalyticsSummary>(userId, 'analytics_summary', { type: 'summary' });
    if (cached) {
      return cached;
    }

    const summaries = await this.getSummaries([userId]);
    const summary = summaries.get(userId) ?? this.composeSummary([], [], [], 'USD');

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
   */
  async getSummaries(userIds: readonly string[]): Promise<Map<string, AnalyticsSummary>> {
    const summaries = new Map<string, AnalyticsSummary>();
    const ids = uniqueIds(userIds);
    if (ids.length === 0) return summaries;

    try {
      const [subsRes, budgetsRes, suggestionsRes, prefsRes] = await Promise.all([
        supabase.from('subscriptions').select('*').in('user_id', ids).eq('status', 'active'),
        supabase.from('monthly_budgets').select('*').in('user_id', ids),
        supabase
          .from('suggestions')
          .select('user_id, savings_per_year')
          .in('user_id', ids)
          .eq('dismissed_until', null),
        supabase
          .from('user_preferences')
          .select('user_id, currency')
          .in('user_id', ids),
      ]);

      if (subsRes.error) throw subsRes.error;
      if (budgetsRes.error) throw budgetsRes.error;
      if (suggestionsRes.error) throw suggestionsRes.error;
      if (prefsRes.error) throw prefsRes.error;

      const subsByUser = groupBy((subsRes.data || []) as Subscription[], (sub) => sub.user_id);
      const budgetsByUser = groupBy((budgetsRes.data || []) as Budget[], (b) => b.user_id);
      const suggestionsByUser = groupBy(
        (suggestionsRes.data || []) as SuggestionSaving[],
        (s) => s.user_id,
      );
      const prefsByUser = new Map<string, string>();
      for (const row of (prefsRes.data || []) as UserPreferences[]) {
        prefsByUser.set(row.user_id, row.currency || 'USD');
      }

      for (const userId of ids) {
        const displayCurrency = prefsByUser.get(userId) || 'USD';
        summaries.set(
          userId,
          this.composeSummary(
            subsByUser.get(userId) ?? [],
            budgetsByUser.get(userId) ?? [],
            suggestionsByUser.get(userId) ?? [],
            displayCurrency,
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
  private async composeSummary(
    subscriptions: Subscription[],
    budgets: Budget[],
    suggestions: SuggestionSaving[],
    displayCurrency: string,
  ): Promise<AnalyticsSummary> {
    const items = subscriptions.map((sub) => ({
      monthlyAmount: normalizeToMonthlyAmount(sub.price, sub.billing_cycle),
      currency: sub.currency || 'USD',
    }));

    const totalMonthlySpend = await this.currencyConverter.convertMonthlyAmounts(items, displayCurrency);
    const categoryBreakdown = await this.convertCategoryBreakdown(subscriptions, displayCurrency);
    const topSubscriptions = this.formatTopSubscriptions(subscriptions);
    const monthlyTrend = await this.convertMonthlyTrend(subscriptions, displayCurrency);

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
      potential_savings_monthly: parseFloat(potentialSavingsMonthly.toFixed(2)),
      display_currency: displayCurrency,
    };
  }

  private async convertCategoryBreakdown(
    subscriptions: Subscription[],
    displayCurrency: string,
  ): Promise<CategorySpend[]> {
    const categories = new Map<string, { total: number; count: number }>();

    for (const sub of subscriptions) {
      const category = sub.category || 'Other';
      const monthlyAmount = normalizeToMonthlyAmount(sub.price, sub.billing_cycle);
      const converted = await this.currencyConverter.convert(monthlyAmount, sub.currency || 'USD', displayCurrency);
      const current = categories.get(category) ?? { total: 0, count: 0 };
      current.total += converted;
      current.count += 1;
      categories.set(category, current);
    }

    const totalMonthlySpend = Array.from(categories.values()).reduce((sum, c) => sum + c.total, 0);

    return Array.from(categories.entries())
      .map(([category, data]) => ({
        category,
        total_spend: roundMoney(data.total),
        count: data.count,
        percentage: totalMonthlySpend > 0 ? (data.total / totalMonthlySpend) * 100 : 0,
      }))
      .sort((a, b) => b.total_spend - a.total_spend);
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
   */
  private async getMonthlyTrend(currentSubs: Subscription[]): Promise<MonthlySpend[]> {
    const trend: MonthlySpend[] = [];
    const months = 6;
    const now = new Date();

    for (let index = months - 1; index >= 0; index--) {
      const targetDate = new Date(now.getFullYear(), now.getMonth() - index, 1);
      const monthEnd = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0);
      const subsAtTime = currentSubs.filter((sub) => {
        const createdAt = sub.created_at;
        if (!createdAt) return true;
        return new Date(createdAt) <= monthEnd;
      });

      const items = subsAtTime.map((sub) => ({
        monthlyAmount: normalizeToMonthlyAmount(sub.price, sub.billing_cycle),
        currency: sub.currency || 'USD',
      }));

      const totalSpend = await this.currencyConverter.convertMonthlyAmounts(items, 'USD');

      trend.push({
        month: `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`,
        total_spend: roundMoney(totalSpend),
        count: subsAtTime.length,
      });
    }

    return trend;
  }

  /**
   * Get monthly spend trend converted to a display currency.
   */
  private async convertMonthlyTrend(
    currentSubs: Subscription[],
    displayCurrency: string,
  ): Promise<MonthlySpend[]> {
    const rawTrend = await this.getMonthlyTrend(currentSubs);

    const converted = await Promise.all(
      rawTrend.map((point) =>
        this.currencyConverter.convert(point.total_spend, 'USD', displayCurrency).then((convertedSpend) => ({
          month: point.month,
          total_spend: convertedSpend,
          count: point.count,
        })),
      ),
    );

    return converted;
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
   */
  async checkBudgetThresholds(userIds: readonly string[]): Promise<void> {
    const ids = uniqueIds(userIds);
    if (ids.length === 0) return;

    try {
      const summaries = await this.getSummaries(ids);
      const monthStr = new Date().toISOString().substring(0, 7);

      const breached = ids
        .map((userId) => ({ userId, summary: summaries.get(userId) }))
        .filter((entry): entry is { userId: string; summary: AnalyticsSummary } =>
          !!entry.summary &&
          !!entry.summary.budget_status.overall_limit &&
          entry.summary.budget_status.percentage >= 80,
        );

      if (breached.length === 0) return;

      const { data: existing } = await supabase
        .from('notifications')
        .select('user_id')
        .in('user_id', breached.map((entry) => entry.userId))
        .eq('type', 'budget_alert')
        .like('message', `%${monthStr}%`);

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
            message: `${message} (Current spend: ${summary.display_currency === 'USD' ? '$' : summary.display_currency + ' '}${budget_status.current_spend.toFixed(2)})`,
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

      const { data: prefs } = await supabase
        .from('user_preferences')
        .select('currency')
        .eq('user_id', userId)
        .single();

      const displayCurrency = (prefs as any)?.currency || 'USD';

      const monthlyTrend = await this.convertMonthlyTrend(typedSubs, displayCurrency);
      const categoryBreakdown = await this.convertCategoryBreakdown(typedSubs, displayCurrency);

      const items = typedSubs.map((sub) => ({
        monthlyAmount: normalizeToMonthlyAmount(sub.price, sub.billing_cycle),
        currency: sub.currency || 'USD',
      }));
      const currentMonthSpend = await this.currencyConverter.convertMonthlyAmounts(items, displayCurrency);

      return {
        current_month_spend: currentMonthSpend,
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

      const { data: prefs } = await supabase
        .from('user_preferences')
        .select('currency')
        .eq('user_id', userId)
        .single();

      const displayCurrency = (prefs as any)?.currency || 'USD';

      const forecast: MonthlySpend[] = [];
      const now = new Date();

      for (let i = 0; i < 6; i++) {
        const targetDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const monthStr = targetDate.toISOString().substring(0, 7);
        
        let monthlyTotal = 0;
        let count = 0;

        const items: Array<{ monthlyAmount: number; currency: string }> = [];

        for (const sub of typedSubs) {
          const createdAt = new Date(sub.created_at);
          
          if (createdAt <= new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0)) {
            items.push({
              monthlyAmount: normalizeToMonthlyAmount(sub.price, sub.billing_cycle),
              currency: sub.currency || 'USD',
            });
            count++;
          }
        }

        monthlyTotal = await this.currencyConverter.convertMonthlyAmounts(items, displayCurrency);

        forecast.push({
          month: monthStr,
          total_spend: roundMoney(monthlyTotal),
          count
        });
      }

      const avgProjected = forecast.length > 0
        ? roundMoney(forecast.reduce((sum, m) => sum + m.total_spend, 0) / forecast.length)
        : 0;

      return {
        forecast,
        avg_projected_monthly_spend: avgProjected
      };
    } catch (error) {
      logger.error('Error fetching forecast data:', error);
      throw error;
    }
  }
}

export const analyticsService = new AnalyticsService();
