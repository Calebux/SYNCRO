import { describe, expect, it } from '@jest/globals';
import {
  buildPublicStatusSnapshot,
  type PublicComponentStatus,
} from '../src/services/public-status-service';
import type { SliMetrics } from '../src/services/sli-metrics-service';

const metrics = (overrides: Partial<SliMetrics['paid_call_metrics']> = {}): SliMetrics => ({
  renewal_success_rate_pct: 100,
  webhook_processing_lag_ms: { avg_ms: 0, p95_ms: 0 },
  notification_queue_depth: { total: 0, active: 0, waiting: 0, delayed: 0, failed: 0 },
  dead_letter_counts: {
    notification_dlq_24h: 0,
    renewal_dlq_24h: 0,
    webhook_dlq_24h: 0,
    total_dlq_24h: 0,
  },
  settlement_signer_balance: null,
  calculated_at: '2026-11-24T00:00:00.000Z',
  paid_call_metrics: {
    admission_latency_by_step_ms: {
      identityResolutionMs: { p50: 0, p95: 0, p99: 0 },
      scopeReadMs: { p50: 0, p95: 0, p99: 0 },
      capCheckMs: { p50: 0, p95: 0, p99: 0 },
      meterReserveMs: { p50: 0, p95: 0, p99: 0 },
    },
    admission_rejections_by_reason: {
      unauthenticated: 0,
      missing_scope: 0,
      cap_exceeded: 0,
      invalid_payment_proof: 0,
      meter_reserve_failed: 0,
      upstream_error: 0,
      total: 0,
    },
    meter_reserve_and_commit: {
      reserveSuccessRatePct: 100,
      commitSuccessRatePct: 100,
      reserveFailures: 0,
      commitFailures: 0,
      totalReserves: 0,
      totalCommits: 0,
    },
    unsettled_value_per_channel: [],
    unsettled_value_total: 0,
    settlement_submission: {
      submissionSuccessRatePct: 100,
      totalSubmissions: 0,
      successfulSubmissions: 0,
      failedSubmissions: 0,
    },
    indexer_lag_ms: { latestLedger: 0, latestProcessedLedger: 0, lagMs: 0, lagBlocks: 0 },
    reconciliation_delta: {
      totalDelta: 0,
      channelsOutOfTolerance: 0,
      deltasByCause: {},
      blocked: false,
    },
    ...overrides,
  },
});

const rpcEndpoint = (healthy: boolean, latestLedger = 100) => ({
  url: 'https://rpc.example.test',
  healthy,
  score: healthy ? 1 : -1,
  consecutiveFailures: healthy ? 0 : 1,
  latestLedger,
});

function componentStatus(
  snapshot: ReturnType<typeof buildPublicStatusSnapshot>,
  id: 'gateway' | 'settlement' | 'soroban_rpc',
): PublicComponentStatus {
  return snapshot.components.find((component) => component.id === id)!.status;
}

describe('buildPublicStatusSnapshot', () => {
  it('computes admission success from accepted reserves and system-side rejection reasons', () => {
    const snapshot = buildPublicStatusSnapshot(
      metrics({
        meter_reserve_and_commit: {
          reserveSuccessRatePct: 90,
          commitSuccessRatePct: 100,
          reserveFailures: 1,
          commitFailures: 0,
          totalReserves: 99,
          totalCommits: 0,
        },
        admission_rejections_by_reason: {
          unauthenticated: 1,
          missing_scope: 30,
          cap_exceeded: 20,
          invalid_payment_proof: 10,
          meter_reserve_failed: 1,
          upstream_error: 0,
          total: 62,
        },
      }),
      [rpcEndpoint(true)],
    );

    expect(snapshot.components[0].metrics.admission_success_rate_pct).toBe(98);
    expect(componentStatus(snapshot, 'gateway')).toBe('degraded');
    expect(JSON.stringify(snapshot)).not.toContain('channelId');
  });

  it('reports absent admission samples and RPC providers as unknown, not healthy', () => {
    const snapshot = buildPublicStatusSnapshot(metrics(), []);

    expect(snapshot.components[0].metrics.admission_success_rate_pct).toBeNull();
    expect(componentStatus(snapshot, 'gateway')).toBe('unknown');
    expect(componentStatus(snapshot, 'soroban_rpc')).toBe('unknown');
  });

  it('does not report settlement as operational without submission samples', () => {
    const snapshot = buildPublicStatusSnapshot(
      metrics({
        unsettled_value_per_channel: [{
          channelId: 'private-channel-id',
          userId: 'private-user-id',
          providerId: 'private-provider-id',
          unsettledValue: 100,
          lastSettledAt: null,
          channelAgeHours: 2,
        }],
      }),
      [rpcEndpoint(true)],
    );

    expect(componentStatus(snapshot, 'settlement')).toBe('unknown');
  });

  it('degrades settlement and RPC when the backlog exceeds the SLO or a provider is down', () => {
    const snapshot = buildPublicStatusSnapshot(
      metrics({
        unsettled_value_per_channel: [{
          channelId: 'private-channel-id',
          userId: 'private-user-id',
          providerId: 'private-provider-id',
          unsettledValue: 100,
          lastSettledAt: null,
          channelAgeHours: 25,
        }],
        settlement_submission: {
          submissionSuccessRatePct: 99,
          totalSubmissions: 100,
          successfulSubmissions: 99,
          failedSubmissions: 1,
        },
      }),
      [rpcEndpoint(true), { ...rpcEndpoint(false), latestLedger: undefined }],
    );

    expect(componentStatus(snapshot, 'settlement')).toBe('degraded');
    expect(componentStatus(snapshot, 'soroban_rpc')).toBe('degraded');
    expect(snapshot.status).toBe('degraded');
    expect(JSON.stringify(snapshot)).not.toContain('private-user-id');
  });
});
