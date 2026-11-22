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

export const FORECAST_ALERT_WINDOW_HOURS = 24;

/** Human-readable time until a projected exhaustion, e.g. "3 hours". */
export function formatTimeToExhaustion(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return 'No projection';
  if (hours <= 0) return 'Now';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} days`;
}

export interface SpendForecastAlert {
  agentId: string;
  agentName: string;
  hoursToCap: number;
}

/** Agents projected to exhaust their cap inside the window (excludes already exhausted). */
export function getSpendForecastAlerts(
  agents: CapUtilization[],
  windowHours: number = FORECAST_ALERT_WINDOW_HOURS,
): SpendForecastAlert[] {
  return agents.flatMap((agent) => {
    const hours = agent.hoursToCap;
    if (hours === null || hours === undefined || !Number.isFinite(hours)) return [];
    if (hours <= 0 || hours > windowHours) return [];
    return [{ agentId: agent.agentId, agentName: agent.agentName, hoursToCap: hours }];
  });
}
