import {
  evaluateJobThresholds,
  getCriticalJobById,
  getCriticalJobConfigs,
  resolveSentryLevel,
} from '../src/config/job-alert-config';

describe('job-alert-config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.JOB_ALERT_REMINDER_PROCESSING_CONSECUTIVE_FAILURES_CRITICAL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getCriticalJobConfigs()', () => {
    it('includes all P1 page-severity critical jobs', () => {
      const configs = getCriticalJobConfigs();
      const pageJobs = configs.filter((j) => j.pagingSeverity === 'page' && j.critical);

      expect(pageJobs.map((j) => j.id)).toEqual(
        expect.arrayContaining([
          'reminder-processing',
          'reminder-scheduling',
          'reminder-retries',
          'notification-queue',
          'event-listener',
        ]),
      );
    });

    it('applies env overrides to thresholds', () => {
      process.env.JOB_ALERT_REMINDER_PROCESSING_CONSECUTIVE_FAILURES_CRITICAL = '5';

      const job = getCriticalJobById('reminder-processing');
      expect(job?.thresholds.critical.consecutiveFailures).toBe(5);
    });
  });

  describe('evaluateJobThresholds()', () => {
    it('returns no alerts when metrics are below thresholds', () => {
      const job = getCriticalJobById('reminder-processing')!;
      const alerts = evaluateJobThresholds(job, {
        consecutiveFailures: 0,
        failuresPerHour: 0,
        dlqCount24h: 0,
      });

      expect(alerts).toHaveLength(0);
    });

    it('emits warning alert when warning threshold is breached', () => {
      const job = getCriticalJobById('reminder-scheduling')!;
      const alerts = evaluateJobThresholds(job, {
        consecutiveFailures: 1,
        failuresPerHour: 0,
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0].level).toBe('warning');
      expect(alerts[0].pagingSeverity).toBe('page');
      expect(alerts[0].metric).toBe('consecutiveFailures');
    });

    it('emits critical alert instead of warning when critical threshold is breached', () => {
      const job = getCriticalJobById('reminder-scheduling')!;
      const alerts = evaluateJobThresholds(job, {
        consecutiveFailures: 2,
        failuresPerHour: 0,
      });

      expect(alerts.some((a) => a.level === 'critical' && a.metric === 'consecutiveFailures')).toBe(
        true,
      );
      expect(alerts.some((a) => a.level === 'warning' && a.metric === 'consecutiveFailures')).toBe(
        false,
      );
    });

    it('evaluates DLQ thresholds for notification pipeline jobs', () => {
      const job = getCriticalJobById('notification-queue')!;
      const alerts = evaluateJobThresholds(job, {
        consecutiveFailures: 0,
        failuresPerHour: 0,
        dlqCount24h: 15,
      });

      expect(alerts.some((a) => a.level === 'critical' && a.metric === 'dlqCount24h')).toBe(true);
    });

    it('includes runbook section reference and dedicated runbook path on every alert', () => {
      const job = getCriticalJobById('event-listener')!;
      const alerts = evaluateJobThresholds(job, {
        consecutiveFailures: 10,
        failuresPerHour: 0,
      });

      expect(alerts[0].runbookSection).toBe('event-listener');
      expect(alerts[0].runbook).toBe('docs/ops/event-listener-runbook.md');
    });

    it('defines dedicated ops runbook for every job config', () => {
      const configs = getCriticalJobConfigs();
      for (const config of configs) {
        expect(config.runbook).toMatch(/^docs\/ops\/.+-runbook\.md$/);
      }
    });
  });

  describe('resolveSentryLevel()', () => {
    it('maps P1 critical failures to error level', () => {
      expect(resolveSentryLevel('page', 'critical')).toBe('error');
    });

    it('maps P3 warnings to info level', () => {
      expect(resolveSentryLevel('warn', 'warning')).toBe('info');
    });
  });
});
