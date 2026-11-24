import type {
  PaidCallMetrics,
  SliMetrics,
} from './sli-metrics-service';
import type { SorobanRpcEndpointHealth } from '@syncro/shared/soroban-rpc-pool';

export type PublicComponentStatus =
  | 'operational'
  | 'degraded'
  | 'major_outage'
  | 'unknown';

export interface PublicStatusComponent {
  id: 'gateway' | 'settlement' | 'soroban_rpc';
  name: string;
  status: PublicComponentStatus;
  metrics: Record<string, number | null>;
}

export interface PublicStatusSnapshot {
  status: PublicComponentStatus;
  components: PublicStatusComponent[];
  updated_at: string;
}

export function buildPublicStatusSnapshot(
  metrics: SliMetrics,
  rpcHealth: SorobanRpcEndpointHealth[],
  updatedAt = new Date().toISOString(),
): PublicStatusSnapshot {
  const paidCall = metrics.paid_call_metrics;
  const admission = getAdmissionSuccessRate(paidCall);
  const backlog = paidCall.unsettled_value_per_channel;
  const oldestBacklogHours = backlog.reduce(
    (oldest, channel) => Math.max(oldest, channel.channelAgeHours),
    0,
  );
  const settlementMetrics = paidCall.settlement_submission;
  const settlementSuccessRate =
    settlementMetrics.totalSubmissions > 0
      ? settlementMetrics.submissionSuccessRatePct
      : null;
  const settlementStatus: PublicComponentStatus =
    paidCall.reconciliation_delta.blocked ||
    (settlementSuccessRate !== null && settlementSuccessRate < 95)
      ? 'major_outage'
      : (settlementSuccessRate !== null && settlementSuccessRate < 99.5) || oldestBacklogHours > 24
        ? 'degraded'
        : settlementSuccessRate === null
          ? 'unknown'
          : 'operational';

  const healthyRpcCount = rpcHealth.filter((endpoint) => endpoint.healthy).length;
  const knownRpcLedgers = rpcHealth
    .map((endpoint) => endpoint.latestLedger)
    .filter((ledger): ledger is number => typeof ledger === 'number');
  const rpcStatus: PublicComponentStatus =
    rpcHealth.length === 0
      ? 'unknown'
      : healthyRpcCount === 0
        ? 'major_outage'
        : healthyRpcCount < rpcHealth.length
          ? 'degraded'
          : 'operational';

  const components: PublicStatusComponent[] = [
    {
      id: 'gateway',
      name: 'Gateway',
      status:
        admission === null
          ? 'unknown'
          : admission >= 99.9
            ? 'operational'
            : admission >= 95
              ? 'degraded'
              : 'major_outage',
      metrics: { admission_success_rate_pct: admission },
    },
    {
      id: 'settlement',
      name: 'Settlement',
      status: settlementStatus,
      metrics: {
        unsettled_channels: backlog.length,
        oldest_unsettled_hours: roundToTwoDecimals(oldestBacklogHours),
        submission_success_rate_pct: settlementSuccessRate,
      },
    },
    {
      id: 'soroban_rpc',
      name: 'Soroban RPC',
      status: rpcStatus,
      metrics: {
        healthy_providers: healthyRpcCount,
        total_providers: rpcHealth.length,
        latest_ledger: knownRpcLedgers.length > 0 ? Math.max(...knownRpcLedgers) : null,
      },
    },
  ];

  return {
    status: worstStatus(components.map((component) => component.status)),
    components,
    updated_at: updatedAt,
  };
}

function getAdmissionSuccessRate(metrics: PaidCallMetrics): number | null {
  const meter = metrics.meter_reserve_and_commit;
  const rejections = metrics.admission_rejections_by_reason;
  const totalDecisions = meter.totalReserves + rejections.unauthenticated + rejections.upstream_error;
  if (totalDecisions === 0) return null;

  const successfulAdmissions = Math.max(0, meter.totalReserves - meter.reserveFailures);
  return roundToTwoDecimals((successfulAdmissions / totalDecisions) * 100);
}

function worstStatus(statuses: PublicComponentStatus[]): PublicComponentStatus {
  const severity: Record<PublicComponentStatus, number> = {
    operational: 0,
    unknown: 1,
    degraded: 2,
    major_outage: 3,
  };
  return statuses.reduce(
    (worst, current) => (severity[current] > severity[worst] ? current : worst),
    'operational',
  );
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}
