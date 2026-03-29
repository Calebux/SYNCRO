import { supabase } from '../config/database';
import logger from '../config/logger';
import { AnalyticsSummary, MonthlySpend, CategorySpend, SubscriptionSpend, Budget } from '../types/analytics';
import { Subscription } from '../types/reminder';
import { riskNotificationService } from './risk-detection/risk-notification-service';

export class AnalyticsService {
  /**
   * Get analytics summary for a user
   */
  async getSummary(userId: string): Promise<AnalyticsSummary> {
    try {
      // 1. Fetch active subscriptions
      const { data: subscriptions, error: subError } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active');

      if (subError) throw subError;

      // 2. Fetch budgets
      const { data: budgets, error: budgetError } = await supabase
        .from('monthly_budgets')
        .select('*')
        .eq('user_id', userId);

      if (budgetError) throw budgetError;

      const typedSubs = (subscriptions || []) as Subscription[];
      const typedBudgets = (budgets || []) as Budget[];

      // 3. Calculate metrics
      const totalMonthlySpend = this.calculateTotalMonthlySpend(typedSubs);
      const categoryBreakdown = this.calculateCategoryBreakdown(typedSubs, totalMonthlySpend);
      const topSubscriptions = this.getTopSubscriptions(typedSubs);
      const monthlyTrend = await this.getMonthlyTrend(userId, typedSubs);
      
      const overallBudget = typedBudgets.find(b => b.category === null);
      const budgetStatus = {
        overall_limit: overallBudget?.budget_limit || null,
        current_spend: totalMonthlySpend,
        percentage: overallBudget ? (totalMonthlySpend / overallBudget.budget_limit) * 100 : 0
      };

      // 4. Upcoming renewals count (next 7 days)
      const next7Days = new Date();
      next7Days.setDate(next7Days.getDate() + 7);
      const upcomingRenewalsCount = typedSubs.filter(sub => {
        if (!sub.next_billing_date) return false;
        const renewalDate = new Date(sub.next_billing_date);
        return renewalDate <= next7Days && renewalDate >= new Date();
      }).length;

      return {
        total_monthly_spend: totalMonthlySpend,
        active_subscriptions: typedSubs.length,
        upcoming_renewals_count: upcomingRenewalsCount,
        monthly_trend: monthlyTrend,
        category_breakdown: categoryBreakdown,
        top_subscriptions: topSubscriptions,
        budget_status: budgetStatus
      };
    } catch (error) {
      logger.error('Error fetching analytics summary:', error);
      throw error;
    }
  }

  /**
   * Calculate monthly normalized spend
   */
  private calculateTotalMonthlySpend(subscriptions: Subscription[]): number {
    return subscriptions.reduce((total, sub) => {
      return total + this.normalizeToMonthly(sub.price, sub.billing_cycle);
    }, 0);
  }

  /**
   * Normalize price to monthly
   */
  private normalizeToMonthly(price: number, cycle: string): number {
    switch (cycle.toLowerCase()) {
      case 'annual':
      case 'yearly':
        return price / 12;
      case 'monthly':
        return price;
      case 'weekly':
        return price * (365 / 7 / 12); // Average weeks in a month
      case 'quarterly':
        return price / 3;
      case 'semiannual':
        return price / 6;
      default:
        return price;
    }
  }

  /**
   * Calculate spend by category
   */
  private calculateCategoryBreakdown(subscriptions: Subscription[], totalSpend: number): CategorySpend[] {
    const categories: Record<string, { total: number, count: number }> = {};
    
    subscriptions.forEach(sub => {
      const category = sub.category || 'Other';
      if (!categories[category]) {
        categories[category] = { total: 0, count: 0 };
      }
      categories[category].total += this.normalizeToMonthly(sub.price, sub.billing_cycle);
      categories[category].count += 1;
    });

    return Object.entries(categories).map(([name, data]) => ({
      category: name,
      total_spend: parseFloat(data.total.toFixed(2)),
      percentage: totalSpend > 0 ? (data.total / totalSpend) * 100 : 0,
      count: data.count
    })).sort((a, b) => b.total_spend - a.total_spend);
  }

  /**
   * Get top 5 expensive subscriptions (monthly normalized)
   */
  private getTopSubscriptions(subscriptions: Subscription[]): SubscriptionSpend[] {
    return subscriptions.map(sub => ({
      id: sub.id,
      name: sub.name,
      price: sub.price,
      billing_cycle: sub.billing_cycle,
      monthly_normalized_price: this.normalizeToMonthly(sub.price, sub.billing_cycle)
    }))
    .sort((a, b) => b.monthly_normalized_price - a.monthly_normalized_price)
    .slice(0, 5);
  }

  /**
   * Get monthly spend trend for the last 6 months
   */
  private async getMonthlyTrend(userId: string, currentSubs: Subscription[]): Promise<MonthlySpend[]> {
    // In a real app, this would query historical data or logs.
    // For now, we'll project the trend based on current subscriptions and created_at dates
    const trend: MonthlySpend[] = [];
    const now = new Date();
    
    for (let i = 5; i >= 0; i--) {
      const targetDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthStr = targetDate.toISOString().substring(0, 7);
      
      // Filter subs that existed in this month
      const subsAtTime = currentSubs.filter(sub => {
        const createdAt = new Date(sub.created_at);
        return createdAt <= new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0);
      });

      const monthlyTotal = subsAtTime.reduce((total, sub) => {
        return total + this.normalizeToMonthly(sub.price, sub.billing_cycle);
      }, 0);

      trend.push({
        month: monthStr,
        total_spend: parseFloat(monthlyTotal.toFixed(2)),
        count: subsAtTime.length
      });
    }

    return trend;
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

    return data;
  }

  /**
   * Check if user has exceeded their budget and notify if necessary
   */
  async checkBudgetThreshold(userId: string): Promise<void> {
    try {
      const summary = await this.getSummary(userId);
      const { budget_status } = summary;

      if (budget_status.overall_limit && budget_status.percentage >= 80) {
        // Trigger notification via riskNotificationService (reusing it or adding a new method)
        // For now, let's just insert an in-app notification directly
        const message = budget_status.percentage >= 100 
          ? `Urgent: You have exceeded your monthly budget of $${budget_status.overall_limit}!`
          : `Warning: You have used ${budget_status.percentage.toFixed(1)}% of your monthly budget.`;

        // Check if we already notified for this month to prevent spam
        const monthStr = new Date().toISOString().substring(0, 7);
        const { data: existing } = await supabase
          .from('notifications')
          .select('id')
          .eq('user_id', userId)
          .eq('type', 'budget_alert')
          .like('message', `%${monthStr}%`) // Simple deduplication for the month
          .limit(1);

        if (!existing || existing.length === 0) {
          await supabase.from('notifications').insert({
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
          });
          
          logger.info('Budget alert triggered', { userId, percentage: budget_status.percentage });
        }
      }
    } catch (error) {
      logger.error('Error checking budget threshold:', error);
    }
  }
}

export const analyticsService = new AnalyticsService();
