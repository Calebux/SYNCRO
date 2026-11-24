/**
 * N+1 regression tests (issue #1095).
 *
 * These assert the property that matters: the number of database round-trips a
 * builder makes must not grow with the number of users it composes. Each test
 * runs the same code path for 1 user and for 50 and asserts the query count is
 * identical.
 */

jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  __esModule: true,
}));
jest.mock('../src/config/database', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../src/services/slack-service', () => ({ sendSlackAlert: jest.fn().mockResolvedValue(undefined) }));

const sendMail = jest.fn();
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn() },
}));

import { supabase } from '../src/config/database';
import { measureQueries } from '../src/utils/db-query-metrics';
import { buildMonthlySummaries } from '../src/services/monthly-summary';
import { AnalyticsService } from '../src/services/analytics-service';
import { checkBudgetAlertsForUsers } from '../src/services/budget-alert-service';
import { DigestService } from '../src/services/digest-service';
import nodemailer from 'nodemailer';

const mockFrom = supabase.from as jest.Mock;

/** Rows each table should return, keyed by table name. */
type TableRows = Record<string, unknown[]>;

/**
 * Minimal thenable stand-in for a PostgREST query builder: every filter method
 * returns `this`, and awaiting it resolves to the configured rows.
 */
function queryBuilder(rows: unknown[]) {
  const builder: any = {
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve),
  };

  for (const method of [
    'select', 'insert', 'upsert', 'update', 'delete',
    'eq', 'in', 'not', 'like', 'gte', 'lte', 'gt', 'lt',
    'order', 'range', 'limit',
  ]) {
    builder[method] = jest.fn(() => builder);
  }

  builder.single = jest.fn(() => Promise.resolve({ data: rows[0] ?? null, error: null }));
  builder.maybeSingle = jest.fn(() => Promise.resolve({ data: rows[0] ?? null, error: null }));

  return builder;
}

function stubTables(tables: TableRows): void {
  mockFrom.mockImplementation((table: string) => queryBuilder(tables[table] ?? []));
}

function userIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `user-${i}`);
}

const ONE_USER = 1;
const MANY_USERS = 50;

describe('N+1 query audit (issue #1095)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // `resetMocks` wipes implementations between tests, so re-arm the SMTP mock.
    sendMail.mockResolvedValue({ messageId: 'test-message-id' });
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
  });

  describe('buildMonthlySummaries', () => {
    function stub(count: number) {
      const ids = userIds(count);
      stubTables({
        users: ids.map((id) => ({ id, email: `${id}@example.com` })),
        profiles: ids.map((id) => ({ id, currency: 'USD' })),
        subscriptions: ids.map((id) => ({ user_id: id, price: 10 })),
      });
      return ids;
    }

    it('uses a constant number of queries regardless of user count', async () => {
      const one = await measureQueries(() => buildMonthlySummaries(stub(ONE_USER)));
      jest.clearAllMocks();
      const many = await measureQueries(() => buildMonthlySummaries(stub(MANY_USERS)));

      // Before batching this path cost 3 queries per user (users, profiles,
      // subscriptions) — 3 for 1 user and 150 for 50.
      expect(one.metrics.total).toBe(3);
      expect(many.metrics.total).toBe(3);
      expect(many.metrics.byTable).toEqual({ users: 1, profiles: 1, subscriptions: 1 });
    });

    it('fans subscription rows back out to the right user', async () => {
      stubTables({
        users: [
          { id: 'a', email: 'a@example.com' },
          { id: 'b', email: 'b@example.com' },
        ],
        profiles: [{ id: 'a', currency: 'EUR' }],
        subscriptions: [
          { user_id: 'a', price: 10 },
          { user_id: 'a', price: 5 },
          { user_id: 'b', price: 7 },
        ],
      });

      const summaries = await buildMonthlySummaries(['a', 'b']);

      expect(summaries.get('a')!.totalMonthlySpend).toBe(15);
      expect(summaries.get('a')!.currency).toBe('EUR');
      expect(summaries.get('a')!.userEmail).toBe('a@example.com');
      expect(summaries.get('b')!.totalMonthlySpend).toBe(7);
      // Falls back to USD when the user has no profile row.
      expect(summaries.get('b')!.currency).toBe('USD');
    });

    it('issues no queries for an empty user list', async () => {
      stubTables({});
      const { metrics } = await measureQueries(() => buildMonthlySummaries([]));
      expect(metrics.total).toBe(0);
    });
  });

  describe('AnalyticsService.getSummaries', () => {
    const service = new AnalyticsService();

    function stub(count: number) {
      const ids = userIds(count);
      stubTables({
        subscriptions: ids.map((id) => ({
          id: `sub-${id}`,
          user_id: id,
          name: 'Netflix',
          price: 12,
          billing_cycle: 'monthly',
          status: 'active',
          category: 'Entertainment',
          created_at: '2020-01-01T00:00:00.000Z',
          next_billing_date: null,
        })),
        monthly_budgets: ids.map((id) => ({
          id: `budget-${id}`,
          user_id: id,
          category: null,
          budget_limit: 100,
        })),
      });
      return ids;
    }

    it('uses a constant number of queries regardless of user count', async () => {
      const one = await measureQueries(() => service.getSummaries(stub(ONE_USER)));
      jest.clearAllMocks();
      const many = await measureQueries(() => service.getSummaries(stub(MANY_USERS)));

      // Before batching: 3 queries per user — 3 for 1 user and 150 for 50.
      expect(one.metrics.total).toBe(3);
      expect(many.metrics.total).toBe(3);
      expect(many.metrics.byTable).toEqual({ subscriptions: 1, monthly_budgets: 1, suggestions: 1 });
    });

    it('computes the same summary as the single-user path', async () => {
      stub(1);
      const batched = await service.getSummaries(['user-0']);
      const single = await service.getSummary('user-0');

      expect(single).toEqual(batched.get('user-0'));
      expect(single.total_monthly_spend).toBe(12);
      expect(single.active_subscriptions).toBe(1);
      expect(single.budget_status.overall_limit).toBe(100);
      expect(single.budget_status.percentage).toBeCloseTo(12);
    });

    it('keeps one user\'s subscriptions out of another\'s summary', async () => {
      stubTables({
        subscriptions: [
          { id: 's1', user_id: 'a', name: 'A', price: 10, billing_cycle: 'monthly', status: 'active', category: null, created_at: '2020-01-01T00:00:00.000Z', next_billing_date: null },
          { id: 's2', user_id: 'b', name: 'B', price: 90, billing_cycle: 'monthly', status: 'active', category: null, created_at: '2020-01-01T00:00:00.000Z', next_billing_date: null },
        ],
        monthly_budgets: [],
      });

      const summaries = await service.getSummaries(['a', 'b']);

      expect(summaries.get('a')!.total_monthly_spend).toBe(10);
      expect(summaries.get('b')!.total_monthly_spend).toBe(90);
    });
  });

  describe('AnalyticsService.checkBudgetThresholds', () => {
    const service = new AnalyticsService();

    function stub(count: number) {
      const ids = userIds(count);
      stubTables({
        subscriptions: ids.map((id) => ({
          id: `sub-${id}`,
          user_id: id,
          name: 'Netflix',
          price: 95,
          billing_cycle: 'monthly',
          status: 'active',
          category: null,
          created_at: '2020-01-01T00:00:00.000Z',
          next_billing_date: null,
        })),
        monthly_budgets: ids.map((id) => ({
          id: `budget-${id}`,
          user_id: id,
          category: null,
          budget_limit: 100,
        })),
        notifications: [],
      });
      return ids;
    }

    it('uses a constant number of queries regardless of user count', async () => {
      const one = await measureQueries(() => service.checkBudgetThresholds(stub(ONE_USER)));
      jest.clearAllMocks();
      const many = await measureQueries(() => service.checkBudgetThresholds(stub(MANY_USERS)));

      // Before batching: 4 queries per alerting user — 4 for 1 and 200 for 50.
      expect(one.metrics.total).toBe(5);
      expect(many.metrics.total).toBe(5);
      expect(many.metrics.byTable).toEqual({
        subscriptions: 1,
        monthly_budgets: 1,
        suggestions: 1,
        notifications: 2,
      });
    });

    it('skips users who were already notified this month', async () => {
      const ids = stub(2);
      const month = new Date().toISOString().substring(0, 7);
      stubTables({
        subscriptions: ids.map((id) => ({
          id: `sub-${id}`, user_id: id, name: 'N', price: 95, billing_cycle: 'monthly',
          status: 'active', category: null, created_at: '2020-01-01T00:00:00.000Z', next_billing_date: null,
        })),
        monthly_budgets: ids.map((id) => ({ id: `b-${id}`, user_id: id, category: null, budget_limit: 100 })),
        notifications: [{ user_id: 'user-0', message: `already sent ${month}` }],
      });

      await service.checkBudgetThresholds(ids);

      const notificationCalls = mockFrom.mock.results
        .filter((_, i) => mockFrom.mock.calls[i][0] === 'notifications')
        .map((r) => r.value);
      const inserted = notificationCalls.flatMap((b) => b.insert.mock.calls.flat());

      expect(inserted).toHaveLength(1);
      expect(inserted[0]).toHaveLength(1);
      expect(inserted[0][0].user_id).toBe('user-1');
    });

    it('issues no queries when nobody breaches their budget', async () => {
      stubTables({
        subscriptions: [{
          id: 's', user_id: 'a', name: 'N', price: 1, billing_cycle: 'monthly',
          status: 'active', category: null, created_at: '2020-01-01T00:00:00.000Z', next_billing_date: null,
        }],
        monthly_budgets: [{ id: 'b', user_id: 'a', category: null, budget_limit: 1000 }],
      });

      const { metrics } = await measureQueries(() => service.checkBudgetThresholds(['a']));

      // Only the three summary queries — no dedup read and no insert.
      expect(metrics.total).toBe(3);
    });
  });

  describe('checkBudgetAlertsForUsers', () => {
    function stub(count: number) {
      const ids = userIds(count);
      stubTables({
        profiles: ids.map((id) => ({ id, monthly_budget: 100, budget_alert_threshold: 80 })),
        subscriptions: ids.map((id) => ({ user_id: id, price: 120, billing_cycle: 'monthly' })),
        budget_alert_logs: [],
        notifications: [],
        teams: [],
        team_members: [],
      });
      return ids;
    }

    it('uses a constant number of queries regardless of user count', async () => {
      const one = await measureQueries(() => checkBudgetAlertsForUsers(stub(ONE_USER)));
      jest.clearAllMocks();
      const many = await measureQueries(() => checkBudgetAlertsForUsers(stub(MANY_USERS)));

      // Before batching: 5–8 queries per user — up to 400 for 50 users.
      expect(one.metrics.total).toBe(many.metrics.total);
      expect(many.metrics.total).toBeLessThanOrEqual(8);
    });

    it('does not re-alert users who already got that alert this month', async () => {
      stubTables({
        profiles: [
          { id: 'a', monthly_budget: 100, budget_alert_threshold: 80 },
          { id: 'b', monthly_budget: 100, budget_alert_threshold: 80 },
        ],
        subscriptions: [
          { user_id: 'a', price: 120, billing_cycle: 'monthly' },
          { user_id: 'b', price: 120, billing_cycle: 'monthly' },
        ],
        budget_alert_logs: [
          { user_id: 'a', alert_type: 'budget_exceeded' },
          { user_id: 'a', alert_type: 'budget_warning' },
        ],
        notifications: [],
        teams: [],
        team_members: [],
      });

      await checkBudgetAlertsForUsers(['a', 'b']);

      const notificationBuilders = mockFrom.mock.results
        .filter((_, i) => mockFrom.mock.calls[i][0] === 'notifications')
        .map((r) => r.value);
      const inserted = notificationBuilders.flatMap((b) => b.insert.mock.calls.flat());

      expect(inserted).toHaveLength(1);
      expect(inserted[0].map((row: { user_id: string }) => row.user_id)).toEqual(['b']);
    });

    it('still sends a warning when only the exceeded alert was already sent', async () => {
      // Preserves the original per-user fall-through: an already-sent
      // "exceeded" alert drops through to the "warning" branch.
      stubTables({
        profiles: [{ id: 'a', monthly_budget: 100, budget_alert_threshold: 80 }],
        subscriptions: [{ user_id: 'a', price: 120, billing_cycle: 'monthly' }],
        budget_alert_logs: [{ user_id: 'a', alert_type: 'budget_exceeded' }],
        notifications: [],
        teams: [],
        team_members: [],
      });

      await checkBudgetAlertsForUsers(['a']);

      const notificationBuilders = mockFrom.mock.results
        .filter((_, i) => mockFrom.mock.calls[i][0] === 'notifications')
        .map((r) => r.value);
      const inserted = notificationBuilders.flatMap((b) => b.insert.mock.calls.flat());

      expect(inserted[0][0].type).toBe('budget_warning');
    });

    it('normalizes yearly prices to a monthly figure', async () => {
      stubTables({
        // $1200/yr = $100/mo, exactly at the budget → exceeded alert.
        profiles: [{ id: 'a', monthly_budget: 100, budget_alert_threshold: 80 }],
        subscriptions: [{ user_id: 'a', price: 1200, billing_cycle: 'yearly' }],
        budget_alert_logs: [],
        notifications: [],
        teams: [],
        team_members: [],
      });

      await checkBudgetAlertsForUsers(['a']);

      const notificationBuilders = mockFrom.mock.results
        .filter((_, i) => mockFrom.mock.calls[i][0] === 'notifications')
        .map((r) => r.value);
      const inserted = notificationBuilders.flatMap((b) => b.insert.mock.calls.flat());

      expect(inserted[0][0].type).toBe('budget_exceeded');
      expect(inserted[0][0].metadata.current).toBe(100);
    });

    it('issues a single profiles query when no user has a budget', async () => {
      stubTables({ profiles: [] });
      const { metrics } = await measureQueries(() => checkBudgetAlertsForUsers());
      expect(metrics.total).toBe(1);
    });
  });

  describe('DigestService.runMonthlyDigest', () => {
    const service = new DigestService();

    function stub(count: number) {
      const ids = userIds(count);
      stubTables({
        user_preferences: ids.map((id) => ({
          user_id: id,
          digest_enabled: true,
          digest_day: 1,
          include_year_to_date: true,
          updated_at: '2026-01-01T00:00:00.000Z',
        })),
        users: ids.map((id) => ({ id, email: `${id}@example.com` })),
        profiles: ids.map((id) => ({ id, currency: 'USD' })),
        subscriptions: ids.map((id) => ({ user_id: id, price: 10 })),
        digest_audit_log: [],
      });
      return ids;
    }

    it('uses a constant number of queries regardless of user count', async () => {
      stub(ONE_USER);
      const one = await measureQueries(() => service.runMonthlyDigest());
      jest.clearAllMocks();
      stub(MANY_USERS);
      const many = await measureQueries(() => service.runMonthlyDigest());

      // Before batching, each page cost 1 + 4N queries: the page read, then a
      // redundant preferences re-read, three summary lookups and one audit
      // insert per user (201 queries for a 50-user page). Now it is a fixed 5:
      // the page read, three batched summary reads and one batched audit insert.
      expect(one.metrics.total).toBe(5);
      expect(many.metrics.total).toBe(5);
      expect(many.metrics.byTable).toEqual({
        user_preferences: 1,
        users: 1,
        profiles: 1,
        subscriptions: 1,
        digest_audit_log: 1,
      });
    });

    it('sends one email per digest-enabled user', async () => {
      stub(3);
      const result = await service.runMonthlyDigest();

      expect(sendMail).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ total: 3, sent: 3, skipped: 0, failed: 0 });
    });

    it('counts users with no email on file as failures without sending', async () => {
      stubTables({
        user_preferences: [{ user_id: 'a', digest_enabled: true }, { user_id: 'b', digest_enabled: true }],
        users: [{ id: 'a', email: 'a@example.com' }],
        profiles: [],
        subscriptions: [],
        digest_audit_log: [],
      });

      const result = await service.runMonthlyDigest();

      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ total: 2, sent: 1, skipped: 0, failed: 1 });
    });
  });
});
