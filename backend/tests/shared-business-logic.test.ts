import {
  buildCategoryMonthlySpend,
  buildPastMonthlySpendTrend,
  calculateMonthlySpend,
  countUpcomingRenewals,
  getTopMonthlySpendSubscriptions,
  normalizeToMonthlyAmount,
} from '@syncro/shared/subscription-math';
import {
  isSafeHttpUrl,
  maskApiKey,
  sanitizeUrl,
} from '@syncro/shared/security';

describe('shared subscription math', () => {
  const subscriptions = [
    {
      id: 'monthly',
      name: 'Monthly App',
      price: 30,
      billing_cycle: 'monthly',
      category: 'productivity',
      created_at: '2026-01-10T00:00:00Z',
      next_billing_date: '2026-05-31T00:00:00Z',
    },
    {
      id: 'yearly',
      name: 'Yearly App',
      price: 120,
      billing_cycle: 'yearly',
      category: 'productivity',
      created_at: '2026-02-01T00:00:00Z',
      next_billing_date: '2026-06-10T00:00:00Z',
    },
    {
      id: 'weekly',
      name: 'Weekly App',
      price: 7,
      billing_cycle: 'weekly',
      category: 'streaming',
      created_at: '2026-05-01T00:00:00Z',
      next_billing_date: '2026-06-01T00:00:00Z',
    },
  ];

  it('normalizes supported billing cycles to monthly amounts', () => {
    expect(normalizeToMonthlyAmount(120, 'annual')).toBe(10);
    expect(normalizeToMonthlyAmount(120, 'yearly')).toBe(10);
    expect(normalizeToMonthlyAmount(90, 'quarterly')).toBe(30);
    expect(normalizeToMonthlyAmount(60, 'semiannual')).toBe(10);
    expect(normalizeToMonthlyAmount(100, 'lifetime')).toBe(0);
  });

  it('calculates total monthly spend once for shared callers', () => {
    expect(calculateMonthlySpend(subscriptions)).toBeCloseTo(70.42, 2);
  });

  it('builds category breakdowns using normalized monthly spend', () => {
    const breakdown = buildCategoryMonthlySpend(subscriptions);

    expect(breakdown[0]).toMatchObject({
      category: 'productivity',
      totalMonthlySpend: 40,
      count: 2,
    });
    expect(breakdown[1]).toMatchObject({
      category: 'streaming',
      totalMonthlySpend: 30.42,
      count: 1,
    });
  });

  it('sorts top subscriptions by monthly-normalized price', () => {
    expect(getTopMonthlySpendSubscriptions(subscriptions, 2).map((sub) => sub.id)).toEqual([
      'weekly',
      'monthly',
    ]);
  });

  it('counts renewals within an inclusive future window', () => {
    expect(countUpcomingRenewals(subscriptions, 7, new Date('2026-05-30T00:00:00Z'))).toBe(2);
  });

  it('projects historical monthly trend from creation dates', () => {
    const trend = buildPastMonthlySpendTrend(subscriptions, 2, new Date('2026-05-30T00:00:00Z'));

    expect(trend).toEqual([
      { month: '2026-04', totalMonthlySpend: 40, count: 2 },
      { month: '2026-05', totalMonthlySpend: 70.42, count: 3 },
    ]);
  });
});

describe('shared security helpers', () => {
  it('accepts only http and https URLs', () => {
    expect(isSafeHttpUrl('https://example.com/path')).toBe(true);
    expect(isSafeHttpUrl('http://example.com/path')).toBe(true);
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('not a url')).toBe(false);
  });

  it('sanitizes unsafe URLs to the fallback', () => {
    expect(sanitizeUrl('https://example.com/path')).toBe('https://example.com/path');
    expect(sanitizeUrl('data:text/html,hello')).toBe('#');
  });

  it('masks API keys with configurable visible sections', () => {
    expect(maskApiKey('sk-ant-validkey123456')).toBe('sk-ant-...3456');
    expect(maskApiKey('short')).toBe('••••••••');
    expect(maskApiKey('abcd1234efgh', { visiblePrefix: 4, visibleSuffix: 4, shortMask: '***' }))
      .toBe('abcd...efgh');
  });
});
