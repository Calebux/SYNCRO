/**
 * Shared subscription arithmetic.
 *
 * ## Invariants
 *
 * 1. **Occurrences are strictly increasing.** `occurrencesInRange` and
 *    repeated `addInterval` calls never emit a timestamp `<=` the previous one.
 * 2. **A monthly schedule produces exactly 12 occurrences per calendar year**
 *    when the range is a full year that contains the anchor's month-day
 *    (month-end and leap-day anchors clamp; they still yield 12 dates).
 * 3. **Converting a cycle to days and back is lossless** for day and week
 *    intervals: `daysToCycle(cycleToDays(i))` is equivalent to `i`. Month and
 *    year intervals are calendar-based and are inverted with `addInterval`.
 * 4. **Proration never exceeds the full amount.** `prorateAmount(full, used, period) <= full`
 *    for every non-negative `full`.
 *
 * Time zone: occurrence math is calendar/UTC. DST transitions do not drop or
 * duplicate a billing date. Reminder dates are `daysBefore` UTC calendar days
 * before the renewal instant.
 */
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

export type BillingUnit = 'day' | 'week' | 'month' | 'year';

export interface BillingInterval {
  unit: BillingUnit;
  count: number;
}

export const MONTH_END_ANCHORS = [
  '2026-01-31T12:00:00.000Z',
  '2026-03-31T12:00:00.000Z',
  '2026-08-31T12:00:00.000Z',
] as const;

export const LEAP_DAY_ANCHORS = [
  '2024-02-29T12:00:00.000Z',
  '2028-02-29T12:00:00.000Z',
] as const;

export const DST_BOUNDARY_INSTANTS = [
  '2026-03-08T06:30:00.000Z',
  '2026-11-01T05:30:00.000Z',
] as const;

function utcParts(date: Date): { y: number; m: number; d: number; hh: number; mm: number; ss: number; ms: number } {
  return {
    y: date.getUTCFullYear(),
    m: date.getUTCMonth(),
    d: date.getUTCDate(),
    hh: date.getUTCHours(),
    mm: date.getUTCMinutes(),
    ss: date.getUTCSeconds(),
    ms: date.getUTCMilliseconds(),
  };
}

function daysInUtcMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function addInterval(anchor: Date, interval: BillingInterval, steps = 1): Date {
  if (!Number.isInteger(interval.count) || interval.count < 1) {
    throw new RangeError('Billing interval count must be a positive integer');
  }
  if (!Number.isInteger(steps) || steps < 0) {
    throw new RangeError('steps must be a non-negative integer');
  }
  const total = interval.count * steps;
  const parts = utcParts(anchor);
  if (interval.unit === 'day') {
    return new Date(Date.UTC(parts.y, parts.m, parts.d + total, parts.hh, parts.mm, parts.ss, parts.ms));
  }
  if (interval.unit === 'week') {
    return new Date(Date.UTC(parts.y, parts.m, parts.d + total * 7, parts.hh, parts.mm, parts.ss, parts.ms));
  }
  if (interval.unit === 'year') {
    const year = parts.y + total;
    const dim = daysInUtcMonth(year, parts.m);
    return new Date(Date.UTC(year, parts.m, Math.min(parts.d, dim), parts.hh, parts.mm, parts.ss, parts.ms));
  }
  const monthIndex = parts.m + total;
  const year = parts.y + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const dim = daysInUtcMonth(year, month);
  return new Date(Date.UTC(year, month, Math.min(parts.d, dim), parts.hh, parts.mm, parts.ss, parts.ms));
}

export function occurrencesInRange(
  anchor: Date,
  interval: BillingInterval,
  start: Date,
  end: Date,
): Date[] {
  if (end.getTime() < start.getTime()) {
    return [];
  }
  let step = 0;
  let cursor = addInterval(anchor, interval, 0);
  while (cursor.getTime() < start.getTime() && step < 10_000) {
    step += 1;
    const next = addInterval(anchor, interval, step);
    if (next.getTime() <= cursor.getTime()) {
      throw new Error('addInterval produced a non-increasing timestamp');
    }
    cursor = next;
  }
  const out: Date[] = [];
  while (cursor.getTime() <= end.getTime() && out.length < 10_000) {
    if (cursor.getTime() >= start.getTime()) {
      out.push(new Date(cursor.getTime()));
    }
    step += 1;
    const next = addInterval(anchor, interval, step);
    if (next.getTime() <= cursor.getTime()) {
      throw new Error('addInterval produced a non-increasing timestamp');
    }
    cursor = next;
  }
  return out;
}

export function nextRenewalDate(anchor: Date, interval: BillingInterval, from: Date): Date {
  if (anchor.getTime() > from.getTime()) {
    return new Date(anchor.getTime());
  }
  const upcoming = occurrencesInRange(anchor, interval, new Date(from.getTime() + 1), new Date(from.getTime() + 1000 * 60 * 60 * 24 * 366 * 20));
  if (upcoming.length === 0) {
    throw new Error('Unable to compute next renewal date');
  }
  return upcoming[0];
}

export function cycleToDays(interval: BillingInterval): number | null {
  if (interval.unit === 'day') return interval.count;
  if (interval.unit === 'week') return interval.count * 7;
  return null;
}

export function daysToCycle(days: number): BillingInterval {
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError('days must be a positive integer');
  }
  if (days % 7 === 0) {
    return { unit: 'week', count: days / 7 };
  }
  return { unit: 'day', count: days };
}

export function prorateAmount(fullAmount: number, elapsedMs: number, periodMs: number): number {
  if (!Number.isFinite(fullAmount) || fullAmount < 0) {
    throw new RangeError('fullAmount must be a finite non-negative number');
  }
  if (!Number.isFinite(periodMs) || periodMs <= 0) {
    return 0;
  }
  const used = Math.max(0, elapsedMs);
  const ratio = Math.min(1, used / periodMs);
  return roundMoney(fullAmount * ratio);
}

export function reminderDateBefore(renewal: Date, daysBefore: number): Date {
  if (!Number.isInteger(daysBefore) || daysBefore < 0) {
    throw new RangeError('daysBefore must be a non-negative integer');
  }
  const parts = utcParts(renewal);
  return new Date(Date.UTC(parts.y, parts.m, parts.d - daysBefore, 0, 0, 0, 0));
}

export function zonedCalendarDate(instant: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(instant);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}
