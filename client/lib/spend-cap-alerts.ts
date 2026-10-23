import type { CapUtilization } from '@syncro/shared/domain';

export interface SpendCapAlert {
  agentId: string;
  agentName: string;
  percentage: number;
  exceeded: boolean;
}

export function getSpendCapAlerts(agents: CapUtilization[]): SpendCapAlert[] {
  return agents.flatMap((agent) => {
    if (!Number.isFinite(agent.capacity) || agent.capacity <= 0) return [];
    const spend = agent.currentSpend ?? Math.max(0, agent.capacity - agent.currentBalance);
    const percentage = (spend / agent.capacity) * 100;
    return percentage >= 80
      ? [{ agentId: agent.agentId, agentName: agent.agentName, percentage, exceeded: percentage >= 100 }]
      : [];
  });
}
