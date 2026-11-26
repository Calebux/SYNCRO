import { describe, expect, it } from 'vitest';
import { formatTimeToExhaustion, getSpendCapAlerts, getSpendForecastAlerts } from '@/lib/spend-cap-alerts';

describe('getSpendCapAlerts', () => {
  const agent = {
    agentId: 'agent-1',
    agentName: 'Agent One',
    currentBalance: 20,
    capacity: 100,
    utilizationPercentage: 20,
  };

  it('alerts at 80% and becomes critical at 100%', () => {
    expect(getSpendCapAlerts([{ ...agent, currentSpend: 80 }])).toEqual([
      { agentId: 'agent-1', agentName: 'Agent One', percentage: 80, exceeded: false },
    ]);
    expect(getSpendCapAlerts([{ ...agent, currentSpend: 100 }])).toEqual([
      { agentId: 'agent-1', agentName: 'Agent One', percentage: 100, exceeded: true },
    ]);
  });

  it('does not alert below 80% or for missing caps', () => {
    expect(getSpendCapAlerts([{ ...agent, currentSpend: 79.99 }])).toEqual([]);
    expect(getSpendCapAlerts([{ ...agent, capacity: 0, currentSpend: 0 }])).toEqual([]);
  });
});

describe('spend forecast helpers', () => {
  const agent = { agentId: 'a', agentName: 'A', currentBalance: 10, capacity: 100, utilizationPercentage: 10 };

  it('alerts only when exhaustion falls inside the window', () => {
    expect(getSpendForecastAlerts([{ ...agent, hoursToCap: 5 }])).toEqual([{ agentId: 'a', agentName: 'A', hoursToCap: 5 }]);
    expect(getSpendForecastAlerts([{ ...agent, hoursToCap: 24 }])).toHaveLength(1);
    expect(getSpendForecastAlerts([{ ...agent, hoursToCap: 25 }])).toEqual([]);
    expect(getSpendForecastAlerts([{ ...agent, hoursToCap: 0 }])).toEqual([]);
    expect(getSpendForecastAlerts([{ ...agent, hoursToCap: null }, agent])).toEqual([]);
    expect(getSpendForecastAlerts([{ ...agent, hoursToCap: 40 }], 48)).toHaveLength(1);
  });

  it('formats durations', () => {
    expect(formatTimeToExhaustion(null)).toBe('No projection');
    expect(formatTimeToExhaustion(0)).toBe('Now');
    expect(formatTimeToExhaustion(0.5)).toBe('30 min');
    expect(formatTimeToExhaustion(1)).toBe('1 hour');
    expect(formatTimeToExhaustion(5)).toBe('5 hours');
    expect(formatTimeToExhaustion(72)).toBe('3 days');
  });
});
