/**
 * Server-side analytics computation
 *
 * Runs inside Next.js Server Components to compute analytics data directly from
 * Supabase, avoiding client-side API calls to the backend for initial data.
 *
 * This implements the "server-first data layer" rule:
 *   Read-paths on the server → props into client components → no post-mount fetch.
 */

import { createClient } from '@/lib/supabase/server'
import type { AnalyticsSummary, MonthlySpend, CategorySpend } from '@/lib/api/analytics'

interface SubscriptionRow {
  id: string
  name: string
  price: number
  billing_cycle: string
  category: string | null
  status: string
  next_billing_date: string | null
  created_at: string
  cancelled_at: string | null
}

interface BudgetRow {
  id: string
  user_id: string
  category: string | null
  budget_limit: number
  alert_threshold: number
}

/** Normalize a price to a monthly equivalent. */
function normalizeToMonthly(price: number, cycle: string): number {
  switch ((cycle || '').toLowerCase()) {
    case 'annual':
    case 'yearly':
      return price / 12
    case 'monthly':
      return price
    case 'weekly':
      return price * (365 / 7 / 12)
    case 'quarterly':
      return price / 3
    case 'semiannual':
      return price / 6
    default:
      return price
  }
}

/** Compute category breakdown from subscriptions. */
function computeCategoryBreakdown(
  subscriptions: SubscriptionRow[],
  totalSpend: number,
): CategorySpend[] {
  const categories: Record<string, { total: number; count: number }> = {}

  for (const sub of subscriptions) {
    const category = sub.category || 'Other'
    categories[category] ??= { total: 0, count: 0 }
    categories[category].total += normalizeToMonthly(sub.price, sub.billing_cycle)
    categories[category].count += 1
  }

  return Object.entries(categories)
    .map(([name, data]) => ({
      category: name,
      total_spend: parseFloat(data.total.toFixed(2)),
      percentage: totalSpend > 0 ? (data.total / totalSpend) * 100 : 0,
      count: data.count,
    }))
    .sort((a, b) => b.total_spend - a.total_spend)
}

/** Compute top-5 subscriptions by monthly normalized price. */
function computeTopSubscriptions(subscriptions: SubscriptionRow[]) {
  return subscriptions
    .map((sub) => ({
      id: sub.id,
      name: sub.name,
      price: sub.price,
      billing_cycle: sub.billing_cycle,
      monthly_normalized_price: parseFloat(
        normalizeToMonthly(sub.price, sub.billing_cycle).toFixed(2),
      ),
    }))
    .sort((a, b) => b.monthly_normalized_price - a.monthly_normalized_price)
    .slice(0, 5)
}

/** Compute monthly spend trend for the last 6 months. */
function computeMonthlyTrend(subscriptions: SubscriptionRow[]): MonthlySpend[] {
  const trend: MonthlySpend[] = []
  const now = new Date()

  for (let i = 5; i >= 0; i--) {
    const targetDate = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const monthStr = targetDate.toISOString().substring(0, 7)
    const endOfMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0)

    const subsAtTime = subscriptions.filter((sub) => {
      const createdAt = new Date(sub.created_at)
      return createdAt <= endOfMonth
    })

    const monthlyTotal = subsAtTime.reduce((total, sub) => {
      return total + normalizeToMonthly(sub.price, sub.billing_cycle)
    }, 0)

    trend.push({
      month: monthStr,
      total_spend: parseFloat(monthlyTotal.toFixed(2)),
      count: subsAtTime.length,
    })
  }

  return trend
}

/**
 * Fetch and compute the analytics summary for a user.
 *
 * Called from server components.  Does NOT make an HTTP call to the backend —
 * it queries Supabase directly through the server-side client.
 */
export async function getAnalyticsSummary(userId: string): Promise<AnalyticsSummary> {
  const supabase = await createClient()

  // Fetch active subscriptions
  const { data: subscriptions, error: subError } = await supabase
    .from('subscriptions')
    .select('id, name, price, billing_cycle, category, status, next_billing_date, created_at, cancelled_at')
    .eq('user_id', userId)
    .eq('status', 'active')

  if (subError) {
    console.error('[getAnalyticsSummary] subscriptions query failed', {
      code: subError.code,
      message: subError.message,
    })
    throw subError
  }

  const typedSubs = (subscriptions ?? []) as SubscriptionRow[]

  // Fetch budgets
  const { data: budgets, error: budgetError } = await supabase
    .from('monthly_budgets')
    .select('id, user_id, category, budget_limit, alert_threshold')
    .eq('user_id', userId)

  if (budgetError) {
    console.error('[getAnalyticsSummary] budgets query failed', {
      code: budgetError.code,
      message: budgetError.message,
    })
    throw budgetError
  }

  const typedBudgets = (budgets ?? []) as BudgetRow[]

  // Compute metrics
  const totalMonthlySpend = typedSubs.reduce(
    (total, sub) => total + normalizeToMonthly(sub.price, sub.billing_cycle),
    0,
  )

  const categoryBreakdown = computeCategoryBreakdown(typedSubs, totalMonthlySpend)
  const topSubscriptions = computeTopSubscriptions(typedSubs)
  const monthlyTrend = computeMonthlyTrend(typedSubs)

  const overallBudget = typedBudgets.find((b) => b.category === null)
  const budgetStatus = {
    overall_limit: overallBudget?.budget_limit ?? null,
    current_spend: parseFloat(totalMonthlySpend.toFixed(2)),
    percentage: overallBudget
      ? (totalMonthlySpend / overallBudget.budget_limit) * 100
      : 0,
  }

  // Upcoming renewals (next 7 days)
  const now = new Date()
  const next7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const upcomingRenewalsCount = typedSubs.filter((sub) => {
    if (!sub.next_billing_date) return false
    const renewalDate = new Date(sub.next_billing_date)
    return renewalDate <= next7Days && renewalDate >= now
  }).length

  return {
    total_monthly_spend: parseFloat(totalMonthlySpend.toFixed(2)),
    active_subscriptions: typedSubs.length,
    upcoming_renewals_count: upcomingRenewalsCount,
    monthly_trend: monthlyTrend,
    category_breakdown: categoryBreakdown,
    top_subscriptions: topSubscriptions,
    budget_status: budgetStatus,
  }
}