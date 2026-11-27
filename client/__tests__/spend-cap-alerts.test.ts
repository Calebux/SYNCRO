import { describe, expect, it } from 'vitest';
import { getSpendCapAlerts } from '@/lib/spend-cap-alerts';

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
