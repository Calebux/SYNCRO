import * as Sentry from '@sentry/node';
import { jobAlertService } from '../src/services/job-alert-service';
import { supabase } from '../src/config/database';

jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
}));

jest.mock('../src/config/database', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

jest.mock('../src/config/logger', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  __esModule: true,
}));

const createCountQuery = (count: number) => ({
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  gte: jest.fn().mockResolvedValue({ count, error: null }),
});

describe('JobAlertService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jobAlertService.resetForTests();
    process.env.JOB_ALERT_COOLDOWN_MS = '0';

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'notification_dead_letter_queue') {
        return createCountQuery(0);
      }
      if (table === 'webhook_deliveries') {
        return createCountQuery(0);
      }
      return createCountQuery(0);
    });
  });

  describe('recordJobOutcome()', () => {
    it('tracks consecutive failures and resets on success', () => {
      jobAlertService.recordJobOutcome('reminder-scheduling', false, new Error('boom'));
      jobAlertService.recordJobOutcome('reminder-scheduling', false, new Error('boom again'));

      let metrics = jobAlertService.getRuntimeMetrics('reminder-scheduling');
      expect(metrics.consecutiveFailures).toBe(2);

      jobAlertService.recordJobOutcome('reminder-scheduling', true);
      metrics = jobAlertService.getRuntimeMetrics('reminder-scheduling');
      expect(metrics.consecutiveFailures).toBe(0);
    });

    it('emits Sentry alert with dedicated ops runbook when critical threshold is breached', async () => {
      jobAlertService.recordJobOutcome('reminder-scheduling', false, new Error('fail 1'));
      jobAlertService.recordJobOutcome('reminder-scheduling', false, new Error('fail 2'));

      await jobAlertService.checkAndEmitAlerts();

      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining('Reminder Scheduling'),
        expect.objectContaining({
          tags: expect.objectContaining({
            alert_type: 'job_failure',
            job_id: 'reminder-scheduling',
            paging_severity: 'page',
          }),
          contexts: expect.objectContaining({
            job_alert: expect.objectContaining({
              runbook_section: 'reminder-scheduling',
              runbook: 'docs/ops/reminder-scheduling-runbook.md',
            }),
          }),
        }),
      );
    });

    it('deduplicates alerts within cooldown window', () => {
      process.env.JOB_ALERT_COOLDOWN_MS = '60000';

      jobAlertService.recordJobOutcome('reminder-scheduling', false, new Error('fail 1'));
      jobAlertService.recordJobOutcome('reminder-scheduling', false, new Error('fail 2'));
      const firstCallCount = (Sentry.captureMessage as jest.Mock).mock.calls.length;

      jobAlertService.recordJobOutcome('reminder-scheduling', false, new Error('fail 3'));
      expect((Sentry.captureMessage as jest.Mock).mock.calls.length).toBe(firstCallCount);
    });
  });

  describe('runMonitoredJob()', () => {
    it('records success when handler completes', async () => {
      await jobAlertService.runMonitoredJob('expiry-processing', async () => 'ok');
      expect(jobAlertService.getRuntimeMetrics('expiry-processing').consecutiveFailures).toBe(0);
    });

    it('records failure and rethrows when handler throws', async () => {
      await expect(
        jobAlertService.runMonitoredJob('expiry-processing', async () => {
          throw new Error('expiry failed');
        }),
      ).rejects.toThrow('expiry failed');

      expect(jobAlertService.getRuntimeMetrics('expiry-processing').consecutiveFailures).toBe(1);
    });
  });

  describe('evaluateAllJobAlerts()', () => {
    it('includes DLQ-based alerts when counts exceed thresholds', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'notification_dead_letter_queue') {
          return createCountQuery(20);
        }
        return createCountQuery(0);
      });

      const alerts = await jobAlertService.evaluateAllJobAlerts();
      const notificationAlert = alerts.find(
        (a) => a.jobId === 'notification-queue' && a.metric === 'dlqCount24h',
      );

      expect(notificationAlert).toBeDefined();
      expect(notificationAlert?.level).toBe('critical');
    });
  });
});
