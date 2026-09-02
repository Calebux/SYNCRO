/**
 * Central route registry — the single source of truth for the SYNCRO API surface.
 *
 * Every API route is declared here as a RouteDescriptor.  The 'ALL' method
 * mounts Express routers that handle multiple HTTP methods internally.
 *
 * The registry validates at startup that every route has an explicit auth
 * policy, then applies cross-cutting middleware (auth, rate-limit, validation)
 * uniformly at mount time.
 *
 * Migration note: routes that were previously Express routers are now
 * wrapped in descriptors with method: 'ALL'.  Auth is applied exclusively
 * from the descriptor — routers no longer apply authenticate/adminAuth
 * internally.
 */

import { RouteRegistry } from './registry';
import type { RouteDescriptor } from './registry/types';

// ── Service imports (for inline handlers) ─────────────────────────────────────
import { schedulerService } from '../services/scheduler';
import { reminderEngine } from '../services/reminder-engine';
import { monitoringService } from '../services/monitoring-service';
import { healthService } from '../services/health-service';
import { expiryService } from '../services/expiry-service';
import { blockchainReconciliationService } from '../services/blockchain-reconciliation-service';
import { isDraining } from '../lib/shutdown-state';
import logger from '../config/logger';

// ── Router imports ────────────────────────────────────────────────────────────
import subscriptionRoutes from '../routes/subscriptions';
import subscriptionShareRoutes from '../routes/subscription-shares';
import subscriptionDedupRoutes from '../routes/subscription-dedup';
import riskScoreRoutes from '../routes/risk-score';
import simulationRoutes from '../routes/simulation';
import merchantRoutes from '../routes/merchants';
import teamRoutes from '../routes/team';
import auditRoutes from '../routes/audit';
import webhookRoutes from '../routes/webhooks';
import complianceRoutes from '../routes/compliance';
import tagsRoutes from '../routes/tags';
import userRoutes from '../routes/user';
import sessionRoutes from '../routes/sessions';
import apiKeysRoutes from '../routes/api-keys';
import digestRoutes from '../routes/digest';
import mfaRoutes from '../routes/mfa';
import pushNotificationRoutes from '../routes/push-notifications';
import walletRoutes from '../routes/wallet';
import keyRotationRoutes from '../routes/key-rotation';
import privacyRoutes from '../routes/privacy';
import emailRescanRoutes from '../routes/email-rescan';
import cspViolationsRoutes from '../routes/csp-violations';
import giftCardLedgerRoutes from '../routes/gift-card-ledger';
import notificationDeadLetterRoutes from '../routes/notification-dead-letter';
import renewalDeadLetterRoutes from '../routes/renewal-dead-letter';
import telegramWebhookRoutes from '../routes/telegram-webhook';
import calendarRouter from '../routes/calendar';
import userPreferencesRoutes from '../routes/user-preferences';
import reminderSettingsRoutes from '../routes/reminder-settings';
import paymentsRoutes from '../routes/payments';
import paymentChannelsRoutes from '../routes/payment-channels';
import adminWebhookEventsRoutes from '../routes/admin/webhook-events';
import adminDeletionsRoutes from '../routes/admin-deletions';
import agentWalletsRoutes from '../routes/agent-wallets';
import privacyMetricsAdminRoutes from '../routes/admin/privacy-metrics';
import gmailRouter from '../routes/integrations/gmail';
import outlookRouter from '../routes/integrations/outlook';
import yahooRouter from '../routes/integrations/yahoo';
import icloudRouter from '../routes/integrations/icloud';
import slackRouter from '../routes/integrations/slack';
import metricsRoutes from '../routes/metrics';
import analyticsRoutes from '../routes/analytics';
import referralRoutes from '../routes/referrals';
import suggestionRoutes from '../routes/suggestions';
import { getQueueHealthMetrics } from '../routes/admin-queues';

// ── Exchange rate service (factory pattern) ───────────────────────────────────
import { createExchangeRatesRouter } from '../routes/exchange-rates';
import { ExchangeRateService } from '../services/exchange-rate/exchange-rate-service';
import { FiatRateProvider } from '../services/exchange-rate/fiat-provider';
import { FrankfurterProvider } from '../services/exchange-rate/frankfurter-provider';
import { CryptoRateProvider } from '../services/exchange-rate/crypto-provider';

// ══════════════════════════════════════════════════════════════════════════════
// SERVICE INSTANCES
// ══════════════════════════════════════════════════════════════════════════════

const exchangeRateService = new ExchangeRateService([
  new FiatRateProvider(),
  new FrankfurterProvider(),
  new CryptoRateProvider(),
]);

// ══════════════════════════════════════════════════════════════════════════════
// ROUTE DESCRIPTORS
//
// Every API route is a descriptor.  The 'ALL' method is used for Express
// routers that handle multiple HTTP methods internally.  The registry
// applies auth and rate-limit from the descriptor.
//
// Auth assignments:
//   'user'   — authenticated user endpoints
//   'admin'  — admin-only endpoints
//   'public' — mixed auth or no auth required
// ══════════════════════════════════════════════════════════════════════════════

const ALL_ROUTES: RouteDescriptor[] = [
  // ── SLI Metrics ──────────────────────────────────────────────────────────
  {
    method: 'GET',
    path: '/metrics',
    version: 'v1',
    auth: 'public',
    tags: ['Metrics'],
    summary: 'Core SLI metrics (Prometheus / JSON)',
    handler: metricsRoutes,
  },

  // ── Reminder status (inline) ──────────────────────────────────────────────
  {
    method: 'GET',
    path: '/reminders/status',
    version: 'v1',
    auth: 'public',
    tags: ['Reminders'],
    summary: 'Scheduler status',
    handler: (_req, res) => {
      res.json(schedulerService.getStatus());
    },
  },

  // ── Core API routes ─────────────────────────────────────────────────────
  {
    method: 'ALL',
    path: '/subscriptions',
    version: 'v1',
    auth: 'user',
    tags: ['Subscriptions'],
    summary: 'Subscription management',
    auditEvent: 'subscription.accessed',
    handler: subscriptionRoutes,
  },
  {
    method: 'ALL',
    path: '/subscriptions',
    version: 'v1',
    auth: 'public',
    tags: ['Subscriptions'],
    summary: 'Subscription sharing (public + authenticated)',
    auditEvent: 'subscription_share.accessed',
    handler: subscriptionShareRoutes,
  },
  {
    method: 'ALL',
    path: '/subscriptions',
    version: 'v1',
    auth: 'user',
    tags: ['Subscriptions'],
    summary: 'Subscription deduplication',
    auditEvent: 'subscription_dedup.accessed',
    handler: subscriptionDedupRoutes,
  },
  {
    method: 'ALL',
    path: '/risk-score',
    version: 'v1',
    auth: 'user',
    tags: ['Risk Score'],
    summary: 'Risk scoring',
    handler: riskScoreRoutes,
  },
  {
    method: 'ALL',
    path: '/simulation',
    version: 'v1',
    auth: 'user',
    rateLimit: 'simulation',
    tags: ['Simulation'],
    summary: 'Billing simulation',
    handler: simulationRoutes,
  },
  {
    method: 'ALL',
    path: '/merchants',
    version: 'v1',
    auth: 'public',
    tags: ['Merchants'],
    summary: 'Merchant management (public reads, admin writes)',
    handler: merchantRoutes,
  },
  {
    method: 'ALL',
    path: '/team',
    version: 'v1',
    auth: 'user',
    tags: ['Team'],
    summary: 'Team management',
    auditEvent: 'team.accessed',
    handler: teamRoutes,
  },
  {
    method: 'ALL',
    path: '/audit',
    version: 'v1',
    auth: 'user',
    tags: ['Audit'],
    summary: 'Audit trail',
    auditEvent: 'audit.accessed',
    handler: auditRoutes,
  },
  {
    method: 'ALL',
    path: '/webhooks',
    version: 'v1',
    auth: 'user',
    tags: ['Webhooks'],
    summary: 'Webhook management',
    auditEvent: 'webhook.accessed',
    handler: webhookRoutes,
  },
  {
    method: 'ALL',
    path: '/compliance',
    version: 'v1',
    auth: 'public',
    tags: ['Compliance'],
    summary: 'Compliance & data export (mixed auth)',
    handler: complianceRoutes,
  },
  {
    method: 'ALL',
    path: '/tags',
    version: 'v1',
    auth: 'user',
    tags: ['Tags'],
    summary: 'Tag management',
    handler: tagsRoutes,
  },
  {
    method: 'ALL',
    path: '/user',
    version: 'v1',
    auth: 'user',
    tags: ['User'],
    summary: 'User profile & account',
    handler: userRoutes,
  },
  {
    method: 'ALL',
    path: '/sessions',
    version: 'v1',
    auth: 'user',
    tags: ['Sessions'],
    summary: 'Session management',
    handler: sessionRoutes,
  },
  {
    method: 'ALL',
    path: '/keys',
    version: 'v1',
    auth: 'user',
    tags: ['API Keys'],
    summary: 'API key management',
    handler: apiKeysRoutes,
  },
  {
    method: 'ALL',
    path: '/digest',
    version: 'v1',
    auth: 'user',
    tags: ['Digest'],
    summary: 'Email digest preferences',
    handler: digestRoutes,
  },
  {
    method: 'ALL',
    path: '/mfa',
    version: 'v1',
    auth: 'user',
    tags: ['MFA'],
    summary: 'Multi-factor authentication',
    auditEvent: 'mfa.accessed',
    handler: mfaRoutes,
  },
  {
    method: 'ALL',
    path: '/notifications/push',
    version: 'v1',
    auth: 'user',
    tags: ['Notifications'],
    summary: 'Push notification subscriptions',
    handler: pushNotificationRoutes,
  },
  {
    method: 'ALL',
    path: '/wallet',
    version: 'v1',
    auth: 'user',
    tags: ['Wallet'],
    summary: 'Wallet verification & status',
    handler: walletRoutes,
  },
  {
    method: 'ALL',
    path: '/key-rotation',
    version: 'v1',
    auth: 'user',
    tags: ['Key Rotation'],
    summary: 'Encryption key rotation',
    handler: keyRotationRoutes,
  },
  {
    method: 'ALL',
    path: '/privacy',
    version: 'v1',
    auth: 'user',
    tags: ['Privacy'],
    summary: 'Privacy & stealth addresses',
    handler: privacyRoutes,
  },
  {
    method: 'ALL',
    path: '/csp-violations',
    version: 'v1',
    auth: 'public',
    tags: ['CSP Violations'],
    summary: 'CSP violation reporting (mixed auth)',
    handler: cspViolationsRoutes,
  },
  {
    method: 'ALL',
    path: '/notifications/dead-letter',
    version: 'v1',
    auth: 'user',
    tags: ['Notifications'],
    summary: 'Notification dead-letter queue',
    handler: notificationDeadLetterRoutes,
  },
  {
    method: 'ALL',
    path: '/renewals/dead-letter',
    version: 'v1',
    auth: 'user',
    tags: ['Renewals'],
    summary: 'Renewal dead-letter queue',
    handler: renewalDeadLetterRoutes,
  },
  {
    method: 'ALL',
    path: '/exchange-rates',
    version: 'v1',
    auth: 'user',
    tags: ['Exchange Rates'],
    summary: 'Fiat & crypto exchange rates',
    handler: createExchangeRatesRouter(exchangeRateService),
  },
  {
    method: 'ALL',
    path: '/gift-card-ledger',
    version: 'v1',
    auth: 'user',
    tags: ['Gift Card Ledger'],
    summary: 'Gift card balance & history',
    handler: giftCardLedgerRoutes,
  },
  {
    method: 'ALL',
    path: '/telegram',
    version: 'v1',
    auth: 'public',
    tags: ['Telegram'],
    summary: 'Telegram webhook (verified inline)',
    handler: telegramWebhookRoutes,
  },
  {
    method: 'ALL',
    path: '/calendar',
    version: 'v1',
    auth: 'public',
    tags: ['Calendar'],
    summary: 'Calendar feed & preferences (mixed auth)',
    handler: calendarRouter,
  },
  {
    method: 'ALL',
    path: '/user-preferences',
    version: 'v1',
    auth: 'user',
    tags: ['User Preferences'],
    summary: 'Notification preferences & quiet hours',
    handler: userPreferencesRoutes,
  },
  {
    method: 'ALL',
    path: '/reminder-settings',
    version: 'v1',
    auth: 'user',
    tags: ['Reminder Settings'],
    summary: 'Reminder configuration',
    handler: reminderSettingsRoutes,
  },

  // ── Payment routes ────────────────────────────────────────────────────────
  {
    method: 'ALL',
    path: '/payments',
    version: 'v1',
    auth: 'user',
    tags: ['Payments'],
    summary: 'Payment processing (Paystack)',
    auditEvent: 'payment.accessed',
    handler: paymentsRoutes,
  },
  {
    method: 'ALL',
    path: '/payment-channels',
    version: 'v1',
    auth: 'user',
    tags: ['Payment Channels'],
    summary: 'Payment channel management',
    auditEvent: 'payment_channel.accessed',
    handler: paymentChannelsRoutes,
  },

  // ── Integration routes ────────────────────────────────────────────────────
  {
    method: 'ALL',
    path: '/integrations/gmail',
    version: 'v1',
    auth: 'user',
    tags: ['Integrations'],
    summary: 'Gmail integration',
    handler: gmailRouter,
  },
  {
    method: 'ALL',
    path: '/integrations/outlook',
    version: 'v1',
    auth: 'user',
    tags: ['Integrations'],
    summary: 'Outlook integration',
    handler: outlookRouter,
  },
  {
    method: 'ALL',
    path: '/integrations/yahoo',
    version: 'v1',
    auth: 'user',
    tags: ['Integrations'],
    summary: 'Yahoo integration',
    handler: yahooRouter,
  },
  {
    method: 'ALL',
    path: '/integrations/icloud',
    version: 'v1',
    auth: 'user',
    tags: ['Integrations'],
    summary: 'iCloud integration',
    handler: icloudRouter,
  },
  {
    method: 'ALL',
    path: '/integrations/slack',
    version: 'v1',
    auth: 'user',
    tags: ['Integrations'],
    summary: 'Slack integration',
    handler: slackRouter,
  },
  {
    method: 'ALL',
    path: '/integrations/email',
    version: 'v1',
    auth: 'user',
    tags: ['Integrations'],
    summary: 'Email rescan',
    handler: emailRescanRoutes,
  },

  // ── Admin routes ──────────────────────────────────────────────────────────
  {
    method: 'ALL',
    path: '/admin/webhook-events',
    version: 'v1',
    auth: 'user',
    tags: ['Admin'],
    summary: 'Webhook event management (owner/admin)',
    handler: adminWebhookEventsRoutes,
  },
  {
    method: 'ALL',
    path: '/admin/deletions',
    version: 'v1',
    auth: 'admin',
    rateLimit: 'admin',
    tags: ['Admin'],
    summary: 'Account deletion processing',
    handler: adminDeletionsRoutes,
  },
  {
    method: 'ALL',
    path: '/admin/agent-wallets',
    version: 'v1',
    auth: 'admin',
    rateLimit: 'admin',
    tags: ['Admin'],
    summary: 'Agent wallet rotation',
    handler: agentWalletsRoutes,
  },
  {
    method: 'ALL',
    path: '/admin',
    version: 'v1',
    auth: 'admin',
    rateLimit: 'admin',
    tags: ['Admin'],
    summary: 'Privacy metrics (admin)',
    handler: privacyMetricsAdminRoutes,
  },

  // ── Inbound webhook ingestion ────────────────────────────────────────────────
  // Webhook routes (stripe, paystack, paypal) are mounted BEFORE express.json()
  // in index.ts because they require raw body for signature verification.
  // They are documented in the OpenAPI spec via externalDescriptors below.

  // ── Analytics ───────────────────────────────────────────────────────────────
  {
    method: 'ALL',
    path: '/analytics',
    version: 'v1',
    auth: 'user',
    tags: ['Analytics'],
    summary: 'Spend analytics & forecasting',
    handler: analyticsRoutes,
  },

  // ── Referrals ───────────────────────────────────────────────────────────────
  {
    method: 'ALL',
    path: '/referrals',
    version: 'v1',
    auth: 'user',
    tags: ['Referrals'],
    summary: 'Referral codes, stats & validation',
    handler: referralRoutes,
  },

  // ── Suggestions ─────────────────────────────────────────────────────────────
  {
    method: 'ALL',
    path: '/suggestions',
    version: 'v1',
    auth: 'user',
    tags: ['Suggestions'],
    summary: 'Money-saving suggestions',
    handler: suggestionRoutes,
  },
];

// ══════════════════════════════════════════════════════════════════════════════
// BUILDER — creates and configures the registry
// ══════════════════════════════════════════════════════════════════════════════

export function buildRouteRegistry(): RouteRegistry {
  const registry = new RouteRegistry('/api');

  registry.register(
    ...ALL_ROUTES,
    ...buildAdminMetricDescriptors(),
    ...buildAdminOpDescriptors(),
  );

  return registry;
}

/**
 * Build inline admin metric routes as descriptors.
 */
export function buildAdminMetricDescriptors(): RouteDescriptor[] {
  const adminMetricRoutes: Array<{
    method: 'GET';
    path: string;
    summary: string;
    handler: (req: any, res: any) => Promise<void>;
  }> = [
    {
      method: 'GET',
      path: '/admin/metrics/subscriptions',
      summary: 'Subscription metrics',
      handler: async (_req, res) => {
        try {
          const metrics = await monitoringService.getSubscriptionMetrics();
          res.json(metrics);
        } catch {
          res.status(500).json({ error: 'Failed to fetch subscription metrics' });
        }
      },
    },
    {
      method: 'GET',
      path: '/admin/metrics/renewals',
      summary: 'Renewal metrics',
      handler: async (_req, res) => {
        try {
          const metrics = await monitoringService.getRenewalMetrics();
          res.json(metrics);
        } catch {
          res.status(500).json({ error: 'Failed to fetch renewal metrics' });
        }
      },
    },
    {
      method: 'GET',
      path: '/admin/metrics/activity',
      summary: 'Agent activity',
      handler: async (_req, res) => {
        try {
          const metrics = await monitoringService.getAgentActivity();
          res.json(metrics);
        } catch {
          res.status(500).json({ error: 'Failed to fetch agent activity' });
        }
      },
    },
    {
      method: 'GET',
      path: '/admin/metrics/throughput',
      summary: 'Throughput metrics',
      handler: async (req, res) => {
        try {
          const w = req.query.window as string;
          const windowHours = w ? parseInt(w, 10) : 24;
          if (isNaN(windowHours) || windowHours < 1 || windowHours > 720) {
            return res.status(400).json({ error: 'window must be between 1 and 720 hours' });
          }
          const metrics = await monitoringService.getThroughputMetrics(windowHours);
          res.json(metrics);
        } catch (error) {
          logger.error('Error fetching throughput metrics:', error);
          res.status(500).json({ error: 'Failed to fetch throughput metrics' });
        }
      },
    },
    {
      method: 'GET',
      path: '/admin/metrics/latency',
      summary: 'Latency metrics',
      handler: async (req, res) => {
        try {
          const w = req.query.window as string;
          const windowHours = w ? parseInt(w, 10) : 24;
          if (isNaN(windowHours) || windowHours < 1 || windowHours > 720) {
            return res.status(400).json({ error: 'window must be between 1 and 720 hours' });
          }
          const metrics = await monitoringService.getLatencyMetrics(windowHours);
          res.json(metrics);
        } catch (error) {
          logger.error('Error fetching latency metrics:', error);
          res.status(500).json({ error: 'Failed to fetch latency metrics' });
        }
      },
    },
    {
      method: 'GET',
      path: '/admin/metrics/retries',
      summary: 'Retry metrics',
      handler: async (req, res) => {
        try {
          const w = req.query.window as string;
          const windowHours = w ? parseInt(w, 10) : 24;
          if (isNaN(windowHours) || windowHours < 1 || windowHours > 720) {
            return res.status(400).json({ error: 'window must be between 1 and 720 hours' });
          }
          const metrics = await monitoringService.getRetryMetrics(windowHours);
          res.json(metrics);
        } catch (error) {
          logger.error('Error fetching retry metrics:', error);
          res.status(500).json({ error: 'Failed to fetch retry metrics' });
        }
      },
    },
    {
      method: 'GET',
      path: '/admin/metrics/failed-items',
      summary: 'Failed items',
      handler: async (req, res) => {
        try {
          const type = req.query.type as string;
          if (!type || !['reminder', 'renewal', 'blockchain'].includes(type)) {
            return res.status(400).json({
              error: 'type is required and must be one of: reminder, renewal, blockchain',
            });
          }
          const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
          const offset = parseInt(req.query.offset as string) || 0;
          const result = await monitoringService.getFailedItems(
            type as 'reminder' | 'renewal' | 'blockchain',
            limit,
            offset,
          );
          res.json(result);
        } catch (error) {
          logger.error('Error fetching failed items:', error);
          res.status(500).json({ error: 'Failed to fetch failed items' });
        }
      },
    },
    {
      method: 'GET',
      path: '/admin/metrics/query-cache',
      summary: 'Query cache metrics',
      handler: async (_req, res) => {
        try {
          const metrics = await monitoringService.getQueryCacheMetrics();
          res.json(metrics);
        } catch (error) {
          logger.error('Error fetching query cache metrics:', error);
          res.status(500).json({ error: 'Failed to fetch query cache metrics' });
        }
      },
    },
    {
      method: 'GET',
      path: '/admin/metrics/renewal-locks',
      summary: 'Renewal lock metrics',
      handler: async (_req, res) => {
        try {
          const metrics = await monitoringService.getRenewalLockMetrics();
          res.json(metrics);
        } catch (error) {
          logger.error('Error fetching renewal lock metrics:', error);
          res.status(500).json({ error: 'Failed to fetch renewal lock metrics' });
        }
      },
    },
    {
      method: 'GET',
      path: '/admin/metrics/api-latency',
      summary: 'API latency metrics',
      handler: async (_req, res) => {
        try {
          const metrics = await monitoringService.getApiLatencyMetrics();
          res.json(metrics);
        } catch (error) {
          logger.error('Error fetching API latency metrics:', error);
          res.status(500).json({ error: 'Failed to fetch API latency metrics' });
        }
      },
    },
    {
      method: 'GET',
      path: '/admin/metrics/ops-summary',
      summary: 'Full ops summary',
      handler: async (req, res) => {
        try {
          const w = req.query.window as string;
          const windowHours = w ? parseInt(w, 10) : 24;
          if (isNaN(windowHours) || windowHours < 1 || windowHours > 720) {
            return res.status(400).json({ error: 'window must be between 1 and 720 hours' });
          }
          const [subscriptions, renewals, activity, trials, throughput, latency, retries, apiLatency] =
            await Promise.all([
              monitoringService.getSubscriptionMetrics(),
              monitoringService.getRenewalMetrics(),
              monitoringService.getAgentActivity(),
              monitoringService.getTrialMetrics(),
              monitoringService.getThroughputMetrics(windowHours),
              monitoringService.getLatencyMetrics(windowHours),
              monitoringService.getRetryMetrics(windowHours),
              monitoringService.getApiLatencyMetrics(),
            ]);
          res.json({
            generated_at: new Date().toISOString(),
            window_hours: windowHours,
            subscriptions,
            renewals,
            activity,
            trials,
            throughput,
            latency,
            retries,
            api_latency: apiLatency,
            db_pool: monitoringService.getPoolMetrics(),
          });
        } catch (error) {
          logger.error('Error fetching ops summary:', error);
          res.status(500).json({ error: 'Failed to fetch ops summary' });
        }
      },
    },
  ];

  return adminMetricRoutes.map((r) => ({
    ...r,
    version: 'v1' as const,
    auth: 'admin' as const,
    rateLimit: 'admin' as const,
    tags: ['Admin'],
  }));
}

/**
 * Build inline admin operational routes as descriptors.
 */
export function buildAdminOpDescriptors(): RouteDescriptor[] {
  const ops: Array<{
    method: 'GET' | 'POST';
    path: string;
    summary: string;
    handler: (req: any, res: any) => Promise<void>;
  }> = [
    {
      method: 'GET',
      path: '/admin/health',
      summary: 'Admin health status',
      handler: async (req, res) => {
        try {
          if (isDraining()) {
            return res.status(503).json({ status: 'draining', timestamp: new Date().toISOString(), message: 'Server is shutting down' });
          }
          const includeHistory = req.query.history !== 'false';
          const health = await healthService.getAdminHealth(includeHistory, undefined);
          const queueHealth = await getQueueHealthMetrics();
          const statusCode = health.status === 'unhealthy' ? 503 : 200;
          res.status(statusCode).json({ ...health, db_pool: monitoringService.getPoolMetrics(), queues: queueHealth });
        } catch (error) {
          logger.error('Error fetching admin health:', error);
          res.status(500).json({ error: 'Failed to fetch health status' });
        }
      },
    },
    {
      method: 'POST',
      path: '/reminders/process',
      summary: 'Process reminders',
      handler: async (_req, res) => {
        try {
          await reminderEngine.processReminders();
          res.json({ success: true, message: 'Reminders processed' });
        } catch (error) {
          logger.error('Error processing reminders:', error);
          res.status(500).json({ success: false, error: 'Failed to process reminders' });
        }
      },
    },
    {
      method: 'POST',
      path: '/reminders/schedule',
      summary: 'Schedule reminders',
      handler: async (req, res) => {
        try {
          const daysBefore = req.body.daysBefore || [7, 3, 1];
          await reminderEngine.scheduleReminders(daysBefore);
          res.json({ success: true, message: 'Reminders scheduled' });
        } catch (error) {
          logger.error('Error scheduling reminders:', error);
          res.status(500).json({ success: false, error: 'Failed to schedule reminders' });
        }
      },
    },
    {
      method: 'POST',
      path: '/reminders/retry',
      summary: 'Process retries',
      handler: async (_req, res) => {
        try {
          await reminderEngine.processRetries();
          res.json({ success: true, message: 'Retries processed' });
        } catch (error) {
          logger.error('Error processing retries:', error);
          res.status(500).json({ success: false, error: 'Failed to process retries' });
        }
      },
    },
    {
      method: 'POST',
      path: '/admin/expiry/process',
      summary: 'Process expiries',
      handler: async (_req, res) => {
        try {
          const result = await expiryService.processExpiries();
          res.json({ success: true, data: result });
        } catch (error) {
          logger.error('Error processing expiries:', error);
          res.status(500).json({ success: false, error: 'Failed to process expiries' });
        }
      },
    },
    {
      method: 'POST',
      path: '/admin/reconciliation/run',
      summary: 'Run blockchain reconciliation',
      handler: async (req, res) => {
        try {
          const windowDays = parseInt(req.query.window_days as string) || 90;
          const autoRepair = req.query.auto_repair === 'true';
          const result = await blockchainReconciliationService.runReconciliation(windowDays, autoRepair);
          res.json({ success: true, data: result });
        } catch (error) {
          logger.error('Error running blockchain reconciliation:', error);
          res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Reconciliation failed' });
        }
      },
    },
  ];

  return ops.map((r) => ({
    ...r,
    version: 'v1' as const,
    auth: 'admin' as const,
    rateLimit: 'admin' as const,
    tags: ['Admin', 'Reminders'],
  }));
}
