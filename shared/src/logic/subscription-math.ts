export interface MonthlyPricedSubscription {
  id?: string | number;
  name?: string;
  price: number | string | null | undefined;
  billing_cycle?: string | null;
  billingCycle?: string | null;
  category?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
  next_billing_date?: string | null;
  cancelled_at?: string | null;
}

export interface CategoryMonthlySpend {
  category: string;
  totalMonthlySpend: number;
  count: number;
  percentage: number;
}

export interface TopMonthlySubscription {
  id?: string | number;
  name?: string;
  price: number;
  billing_cycle: string;
  monthlyNormalizedPrice: number;
}

export interface MonthlySpendPoint {
  month: string;
  totalMonthlySpend: number;
  count: number;
}

const AVERAGE_MONTHS_PER_WEEK = 365 / 7 / 12;

function toNumber(value: number | string | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? 0));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function roundMoney(value: number): number {
  return Number.parseFloat(value.toFixed(2));
}

export function normalizeToMonthlyAmount(
  price: number | string | null | undefined,
  billingCycle: string | null | undefined,
): number {
  const amount = toNumber(price);

  switch ((billingCycle ?? 'monthly').toLowerCase()) {
    case 'annual':
    case 'yearly':
      return amount / 12;
    case 'quarterly':
      return amount / 3;
    case 'weekly':
      return amount * AVERAGE_MONTHS_PER_WEEK;
    case 'semiannual':
    case 'semi-annual':
      return amount / 6;
    case 'lifetime':
      return 0;
    case 'monthly':
    default:
      return amount;
  }
}

export function calculateMonthlySpend(subscriptions: MonthlyPricedSubscription[]): number {
  return subscriptions.reduce(
    (total, sub) => total + normalizeToMonthlyAmount(sub.price, sub.billing_cycle ?? sub.billingCycle),
    0,
  );
}

export function buildCategoryMonthlySpend(
  subscriptions: MonthlyPricedSubscription[],
  fallbackCategory = 'Other',
): CategoryMonthlySpend[] {
  const totalMonthlySpend = calculateMonthlySpend(subscriptions);
  const categories = new Map<string, { total: number; count: number }>();

  for (const sub of subscriptions) {
    const category = sub.category || fallbackCategory;
    const current = categories.get(category) ?? { total: 0, count: 0 };
    current.total += normalizeToMonthlyAmount(sub.price, sub.billing_cycle ?? sub.billingCycle);
    current.count += 1;
    categories.set(category, current);
  }

  return Array.from(categories.entries())
    .map(([category, data]) => ({
      category,
      totalMonthlySpend: roundMoney(data.total),
      count: data.count,
      percentage: totalMonthlySpend > 0 ? (data.total / totalMonthlySpend) * 100 : 0,
    }))
    .sort((a, b) => b.totalMonthlySpend - a.totalMonthlySpend);
}

export function getTopMonthlySpendSubscriptions(
  subscriptions: MonthlyPricedSubscription[],
  limit = 5,
): TopMonthlySubscription[] {
  return subscriptions
    .map((sub) => {
      const billingCycle = sub.billing_cycle ?? sub.billingCycle ?? 'monthly';

      return {
        id: sub.id,
        name: sub.name,
        price: toNumber(sub.price),
        billing_cycle: billingCycle,
        monthlyNormalizedPrice: normalizeToMonthlyAmount(sub.price, billingCycle),
      };
    })
    .sort((a, b) => b.monthlyNormalizedPrice - a.monthlyNormalizedPrice)
    .slice(0, limit);
}

export function countUpcomingRenewals(
  subscriptions: MonthlyPricedSubscription[],
  daysAhead: number,
  now = new Date(),
): number {
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + daysAhead);

  return subscriptions.filter((sub) => {
    if (!sub.next_billing_date) return false;
    const renewalDate = new Date(sub.next_billing_date);
    return renewalDate <= windowEnd && renewalDate >= now;
  }).length;
}

export function buildPastMonthlySpendTrend(
  subscriptions: MonthlyPricedSubscription[],
  months = 6,
  now = new Date(),
): MonthlySpendPoint[] {
  const trend: MonthlySpendPoint[] = [];

  for (let index = months - 1; index >= 0; index--) {
    const targetDate = new Date(now.getFullYear(), now.getMonth() - index, 1);
    const monthEnd = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0);
    const subsAtTime = subscriptions.filter((sub) => {
      const createdAt = sub.created_at ?? sub.createdAt;
      if (!createdAt) return true;
      return new Date(createdAt) <= monthEnd;
    });

    trend.push({
      month: formatMonthKey(targetDate),
      totalMonthlySpend: roundMoney(calculateMonthlySpend(subsAtTime)),
      count: subsAtTime.length,
    });
  }

  return trend;
}
