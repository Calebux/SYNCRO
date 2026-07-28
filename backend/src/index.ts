import express from 'express';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import swaggerUi from 'swagger-ui-express';
import * as bip39 from 'bip39';
import { resolveRelease, resolveEnvironment, scrubEvent, SENTRY_TAG_KEYS } from '../../shared/src/sentry';

// Load environment variables before importing other modules
dotenv.config();

// Sentry Initialization
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  release: resolveRelease(),
  environment: resolveEnvironment(),
  integrations: [nodeProfilingIntegration()],
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  profilesSampleRate: 0.1,
  initialScope: {
    tags: { [SENTRY_TAG_KEYS.service]: 'backend' },
  },
  beforeSend: scrubEvent,
});

import logger from './config/logger';
import { requestIdMiddleware } from './middleware/requestContext';
import { requestLoggerMiddleware } from './middleware/requestLogger';
import { schedulerService } from './services/scheduler';
import { reminderEngine } from './services/reminder-engine';
import { notificationPreferenceService } from './services/notification-preference-service';
import subscriptionRoutes from './routes/subscriptions';
import subscriptionShareRoutes from './routes/subscription-shares';
import subscriptionDedupRoutes from './routes/subscription-dedup';
import riskScoreRoutes from './routes/risk-score';
import simulationRoutes from './routes/simulation';
import merchantRoutes from './routes/merchants';
import teamRoutes from './routes/team';
import auditRoutes from './routes/audit';
import webhookRoutes from './routes/webhooks';
import complianceRoutes from './routes/compliance';
import tagsRoutes from './routes/tags';
import userRoutes from './routes/user';
import sessionRoutes from './routes/sessions';
import apiKeysRoutes from './routes/api-keys';
import digestRoutes from './routes/digest';
import mfaRoutes from './routes/mfa';
import pushNotificationRoutes from './routes/push-notifications';
import walletRoutes from './routes/wallet';
import keyRotationRoutes from './routes/key-rotation';
import privacyRoutes from './routes/privacy';
import emailRescanRoutes from './routes/email-rescan';
import gmailRouter from './routes/integrations/gmail'
import outlookRouter from './routes/integrations/outlook'
import yahooRouter from './routes/integrations/yahoo'
import icloudRouter from './routes/integrations/icloud'
import slackRouter from './routes/integrations/slack'
import cspViolationsRoutes from './routes/csp-violations'
import { createExchangeRatesRouter } from './routes/exchange-rates';
import { ExchangeRateService } from './services/exchange-rate/exchange-rate-service';
import { FiatRateProvider } from './services/exchange-rate/fiat-provider';
import { FrankfurterProvider } from './services/exchange-rate/frankfurter-provider';
import { CryptoRateProvider } from './services/exchange-rate/crypto-provider';
import { monitoringService } from './services/monitoring-service';
import type { FailedItemsResult } from './services/monitoring-service';
import { healthService } from './services/health-service';
import { dependencyHealthService } from './services/dependency-health-service';
import { eventListener } from './services/event-listener';
import { expiryService } from './services/expiry-service';
import { authenticate } from './middleware/auth'
import { adminAuth } from './middleware/admin';
import { createAdminLimiter, RateLimiterFactory } from './middleware/rate-limit-factory';
import { scheduleAutoResume, stopAutoResume } from './jobs/auto-resume';
import { startSettlementBatchJob, stopSettlementBatchJob } from './jobs/settlement-batch-job';
import { startStealthScanJob } from './jobs/stealth-scan-job';
import { startChannelMonitorJob } from './jobs/channel-monitor-job';
import { startChannelSettlementJob, stopChannelSettlementJob } from './jobs/channel-settlement-job';
import { startJobAlertMonitor, stopJobAlertMonitor } from './jobs/job-alert-monitor';
import { isDraining } from './lib/shutdown-state';
import { registerGracefulShutdown } from './lib/graceful-shutdown';
import giftCardLedgerRoutes from './routes/gift-card-ledger';
import notificationDeadLetterRoutes from './routes/notification-dead-letter';
import renewalDeadLetterRoutes from './routes/renewal-dead-letter';
import telegramWebhookRoutes from './routes/telegram-webhook';
import { telegramCommandService } from './services/telegram-command-service';
import calendarRouter from './routes/calendar';
import userPreferencesRoutes from './routes/user-preferences';
import reminderSettingsRoutes from './routes/reminder-settings';
import { blockchainReconciliationService } from './services/blockchain-reconciliation-service';
import paymentsRoutes from './routes/payments';
import paystackWebhookRoutes from './routes/paystack-webhook';
import stripeWebhookRoutes from './routes/stripe-webhook';
import paypalWebhookRoutes from './routes/paypal-webhook';
import adminDeletionsRoutes from './routes/admin-deletions';
import adminQueuesRoutes, { getQueueHealthMetrics } from './routes/admin-queues';
import agentWalletsRoutes from './routes/agent-wallets';
import paymentChannelsRoutes from './routes/payment-channels';
import { errorHandler } from './middleware/errorHandler';
import { swaggerSpec } from './swagger';
import privacyMetricsAdminRoutes from './routes/admin/privacy-metrics';
import metricsRoutes from './routes/metrics';


const app = express();
const PORT = process.env.PORT || 3001;

// Validate Admin API Key
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
if (!ADMIN_API_KEY && process.env.NODE_ENV === 'production') {
  throw new Error('ADMIN_API_KEY environment variable is required in production.');
}

// Exchange Rate Service Setup
// Provider fallback order:
//   1. FiatRateProvider    — ExchangeRate-API (primary fiat source)
//   2. FrankfurterProvider — Frankfurter/ECB  (secondary fiat fallback)
//   3. CryptoRateProvider  — CoinGecko        (crypto: XLM, USDC)
// If a provider fails, the service continues with the remaining providers.
// If all providers fail, stale cache is used; if no cache exists, static
// hardcoded rates are returned and the response is marked stale.
const exchangeRateService = new ExchangeRateService([
  new FiatRateProvider(),
  new FrankfurterProvider(),
  new CryptoRateProvider(),
]);

// Sentry Request Handler
app.use(Sentry.Handlers.requestHandler());

// CORS configuration
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', FRONTEND_URL);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key, If-Match');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Payment webhooks require raw body for cryptographic signature verification
app.use('/api/webhooks/paystack', express.raw({ type: 'application/json' }), paystackWebhookRoutes);
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookRoutes);
app.use('/api/webhooks/paypal', express.raw({ type: 'application/json' }), paypalWebhookRoutes);

// Basic Middlewares
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request context and logging
app.use(requestIdMiddleware);
app.use(requestLoggerMiddleware);

// Reject new work while draining for graceful shutdown
app.use((req, res, next) => {
  if (isDraining()) {
    res.setHeader('Connection', 'close');
    return res.status(503).json({
      status: 'draining',
      message: 'Server is shutting down',
      timestamp: new Date().toISOString(),
    });
  }
  next();
});

// Health & Readiness Endpoints (No Auth Required)
// Liveness probe - indicates if the process is alive
app.get('/health/live', (req, res) => {
  if (isDraining()) {
    return res.status(503).json({
      status: 'draining',
      timestamp: new Date().toISOString(),
      message: 'Server is shutting down',
    });
  }
  const status = dependencyHealthService.getLiveness();
  res.status(200).json(status);
});

// Readiness probe - indicates if the service is ready to accept traffic
app.get('/health/ready', async (req, res) => {
  if (isDraining()) {
    return res.status(503).json({
      status: 'draining',
      timestamp: new Date().toISOString(),
      message: 'Server is shutting down',
    });
  }
  try {
    const status = await dependencyHealthService.getReadiness();
    const httpStatus = status.status === 'ready' ? 200 : 503;
    res.status(httpStatus).json(status);
  } catch (error) {
    logger.error('Readiness check failed:', error);
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      message: 'Readiness check failed',
    });
  }
});

// Full health endpoint with dependency status (used by smoke tests and blue-green pipeline)
app.get('/health', async (req, res) => {
  if (isDraining()) {
    return res.status(503).json({
      status: 'draining',
      timestamp: new Date().toISOString(),
      message: 'Server is shutting down',
    });
  }
  try {
    const readiness = await dependencyHealthService.getReadiness();
    const liveness = dependencyHealthService.getLiveness();
    const queueHealth = await getQueueHealthMetrics();
    const overallStatus = readiness.status === 'ready' && queueHealth.healthy ? 'ok' : 'degraded';
    const httpStatus = readiness.status === 'ready' ? 200 : 503;
    res.status(httpStatus).json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime_ms: liveness.uptime_ms,
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      dependencies: readiness.dependencies,
      queues: queueHealth.queues,
      message: readiness.message,
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      message: 'Health check failed',
    });
  }
});

// Core SLIs Metrics Endpoint (Prometheus / JSON)
app.use('/metrics', metricsRoutes);
app.use('/api/metrics', metricsRoutes);

// Swagger Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api-docs.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});
// Legacy aliases
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api/docs.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// API Routes
app.use('/api/keys', apiKeysRoutes);
app.use('/api/subscriptions', subscriptionShareRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/subscriptions', subscriptionDedupRoutes);
app.use('/api/risk-score', riskScoreRoutes);
app.use('/api/simulation', simulationRoutes);
app.use('/api/merchants', merchantRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/integrations/gmail', authenticate, gmailRouter)
app.use('/api/integrations/outlook', authenticate, outlookRouter)
app.use('/api/integrations/yahoo', authenticate, yahooRouter)
app.use('/api/integrations/icloud', authenticate, icloudRouter)
app.use('/api/integrations/slack', authenticate, slackRouter);
app.use('/api/integrations/email', authenticate, emailRescanRoutes);
// No blanket `authenticate` here: POST / is called server-to-server by the
// Next.js CSP report handler (gated by its own X-Internal-Request check);
// the admin-only routes (stats/refresh-stats/user) apply authenticate
// themselves within csp-violations.ts.
app.use('/api/csp-violations', cspViolationsRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/compliance', complianceRoutes);
app.use('/api/tags', tagsRoutes);
app.use('/api/user', userRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/digest', digestRoutes);
app.use('/api/mfa', mfaRoutes);
app.use('/api/notifications/push', pushNotificationRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/key-rotation', keyRotationRoutes);
app.use('/api/privacy', privacyRoutes);
app.use('/api/notifications/dead-letter', notificationDeadLetterRoutes);
app.use('/api/renewals/dead-letter', renewalDeadLetterRoutes);
app.use('/api/exchange-rates', createExchangeRatesRouter(exchangeRateService));
app.use('/api/gift-card-ledger', giftCardLedgerRoutes);
app.use('/api/payments', authenticate, paymentsRoutes);
app.use('/api/payment-channels', authenticate, paymentChannelsRoutes);
app.use('/api/telegram', telegramWebhookRoutes);
app.use('/api/calendar', calendarRouter);
app.use('/api/user-preferences', authenticate, userPreferencesRoutes);
app.use('/api/reminder-settings', authenticate, reminderSettingsRoutes);

app.get('/api/reminders/status', (req, res) => {
  const status = schedulerService.getStatus();
  res.json(status);
});

// Admin Monitoring Endpoints
app.use('/admin/queues', adminQueuesRoutes);
app.use('/api/admin/deletions', adminDeletionsRoutes);
app.use('/api/admin/agent-wallets', createAdminLimiter(), agentWalletsRoutes);
app.use('/api/admin', privacyMetricsAdminRoutes);


app.get('/api/admin/metrics/subscriptions', createAdminLimiter(), adminAuth, async (req, res) => {
  try {
    const metrics = await monitoringService.getSubscriptionMetrics();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch subscription metrics' });
  }
});

app.get('/api/admin/metrics/renewals', createAdminLimiter(), adminAuth, async (req, res) => {
  try {
    const metrics = await monitoringService.getRenewalMetrics();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch renewal metrics' });
  }
});

app.get('/api/admin/metrics/activity', createAdminLimiter(), adminAuth, async (req, res) => {
  try {
    const metrics = await monitoringService.getAgentActivity();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch agent activity' });
  }
});

// ── Issue #99: Async ops dashboard metrics ───────────────────────────────────

app.get('/api/admin/metrics/throughput', createAdminLimiter(), adminAuth, async (req, res) => {
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
});

app.get('/api/admin/metrics/latency', createAdminLimiter(), adminAuth, async (req, res) => {
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
});

app.get('/api/admin/metrics/retries', createAdminLimiter(), adminAuth, async (req, res) => {
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
});

app.get('/api/admin/metrics/failed-items', createAdminLimiter(), adminAuth, async (req, res) => {
  try {
    const type = req.query.type as string;
    if (!type || !['reminder', 'renewal', 'blockchain'].includes(type)) {
      return res.status(400).json({
        error: 'type is required and must be one of: reminder, renewal, blockchain',
      });
    }
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const result: FailedItemsResult = await monitoringService.getFailedItems(
      type as 'reminder' | 'renewal' | 'blockchain',
      limit,
      offset,
    );
    res.json(result);
  } catch (error) {
    logger.error('Error fetching failed items:', error);
    res.status(500).json({ error: 'Failed to fetch failed items' });
  }
});

app.get('/api/admin/metrics/query-cache', createAdminLimiter(), adminAuth, async (_req, res) => {
  try {
    const metrics = await monitoringService.getQueryCacheMetrics();
    res.json(metrics);
  } catch (error) {
    logger.error('Error fetching query cache metrics:', error);
    res.status(500).json({ error: 'Failed to fetch query cache metrics' });
  }
});

app.get('/api/admin/metrics/renewal-locks', createAdminLimiter(), adminAuth, async (_req, res) => {
  try {
    const metrics = await monitoringService.getRenewalLockMetrics();
    res.json(metrics);
  } catch (error) {
    logger.error('Error fetching renewal lock metrics:', error);
    res.status(500).json({ error: 'Failed to fetch renewal lock metrics' });
  }
});

app.get('/api/admin/metrics/api-latency', createAdminLimiter(), adminAuth, async (req, res) => {
  try {
    const metrics = await monitoringService.getApiLatencyMetrics();
    res.json(metrics);
  } catch (error) {
    logger.error('Error fetching API latency metrics:', error);
    res.status(500).json({ error: 'Failed to fetch API latency metrics' });
  }
});

app.get('/api/admin/metrics/ops-summary', createAdminLimiter(), adminAuth, async (req, res) => {
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
});

app.get('/api/admin/health', createAdminLimiter(), adminAuth, async (req, res) => {
  try {
    if (isDraining()) {
      return res.status(503).json({
        status: 'draining',
        timestamp: new Date().toISOString(),
        message: 'Server is shutting down',
      });
    }
    const includeHistory = req.query.history !== 'false';
    const health = await healthService.getAdminHealth(includeHistory, eventListener.getHealth());
    const queueHealth = await getQueueHealthMetrics();
    const statusCode = health.status === 'unhealthy' ? 503 : 200;
    res.status(statusCode).json({
      ...health,
      db_pool: monitoringService.getPoolMetrics(),
      queues: queueHealth,
    });
  } catch (error) {
    logger.error('Error fetching admin health:', error);
    res.status(500).json({ error: 'Failed to fetch health status' });
  }
});

// Admin Process Triggers
app.post('/api/reminders/process', createAdminLimiter(), adminAuth, async (req, res) => {
  try {
    await reminderEngine.processReminders();
    res.json({ success: true, message: 'Reminders processed' });
  } catch (error) {
    logger.error('Error processing reminders:', error);
    res.status(500).json({ success: false, error: 'Failed to process reminders' });
  }
});

app.post('/api/reminders/schedule', createAdminLimiter(), adminAuth, async (req, res) => {
  try {
    const daysBefore = req.body.daysBefore || [7, 3, 1];
    await reminderEngine.scheduleReminders(daysBefore);
    res.json({ success: true, message: 'Reminders scheduled' });
  } catch (error) {
    logger.error('Error scheduling reminders:', error);
    res.status(500).json({ success: false, error: 'Failed to schedule reminders' });
  }
});

app.post('/api/reminders/retry', createAdminLimiter(), adminAuth, async (req, res) => {
  try {
    await reminderEngine.processRetries();
    res.json({ success: true, message: 'Retries processed' });
  } catch (error) {
    logger.error('Error processing retries:', error);
    res.status(500).json({ success: false, error: 'Failed to process retries' });
  }
});

app.post('/api/admin/expiry/process', createAdminLimiter(), adminAuth, async (req, res) => {
  try {
    const result = await expiryService.processExpiries();
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Error processing expiries:', error);
    res.status(500).json({ success: false, error: 'Failed to process expiries' });
  }
});

// ── Blockchain Reconciliation Endpoints ──────────────────────────────────────

app.post('/api/admin/reconciliation/run', createAdminLimiter(), adminAuth, async (req, res) => {
  try {
    const windowDays = parseInt(req.query.window_days as string) || 90;
    const autoRepair = req.query.auto_repair === 'true';
    const result = await blockchainReconciliationService.runReconciliation(windowDays, autoRepair);
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Error running blockchain reconciliation:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Reconciliation failed',
    });
  }
});

// Error Handlers
app.use(Sentry.Handlers.errorHandler());
app.use(errorHandler);

// Helper Functions (Mnemonic)
export function generateMnemonic(): string {
  return bip39.generateMnemonic(128);
}
export function validateMnemonic(mnemonic: string): boolean {
  if (!mnemonic || typeof mnemonic !== 'string') return false;
  const words = mnemonic.trim().split(/\s+/);
  if (words.length !== 12) return false;
  return bip39.validateMnemonic(words.join(' '));
}

// Health Metrics Snapshot Loop
const HEALTH_SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000;
let healthSnapshotInterval: ReturnType<typeof setInterval> | null = null;
let healthSnapshotTimeout: ReturnType<typeof setTimeout> | null = null;

function startHealthSnapshotInterval() {
  healthSnapshotInterval = setInterval(() => {
    healthService.recordSnapshot().catch(() => { });
  }, HEALTH_SNAPSHOT_INTERVAL_MS);
  healthSnapshotTimeout = setTimeout(() => healthService.recordSnapshot().catch(() => { }), 5000);
}

function clearHealthSnapshotInterval() {
  if (healthSnapshotInterval) {
    clearInterval(healthSnapshotInterval);
    healthSnapshotInterval = null;
  }
  if (healthSnapshotTimeout) {
    clearTimeout(healthSnapshotTimeout);
    healthSnapshotTimeout = null;
  }
}

// Start Server
const server = app.listen(PORT, async () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // Validation
  const criticalEnvVars = ['SOROBAN_CONTRACT_ADDRESS', 'STELLAR_NETWORK_URL'];
  for (const envVar of criticalEnvVars) {
    if (!process.env[envVar]) {
      logger.warn(`${envVar} not configured — EventListener will be disabled`);
    }
  }

  // Initializations
  try {
    await RateLimiterFactory.initializeRedisStore();
    logger.info('Rate limiting initialized successfully');
  } catch (error) {
    logger.warn('Rate limiting initialization failed, using memory store:', error);
  }

  startHealthSnapshotInterval();
  await eventListener.start();
  const elHealth = eventListener.getHealth();
  if (elHealth.status === 'disabled') {
    logger.warn('EventListener is disabled');
  } else {
    logger.info('EventListener started', { status: elHealth.status });
  }

  scheduleAutoResume();
  startSettlementBatchJob();
  startStealthScanJob();
  startChannelMonitorJob();
  startChannelSettlementJob();
  startJobAlertMonitor();

  telegramCommandService.init();
  if (process.env.TELEGRAM_BOT_TOKEN && !process.env.TELEGRAM_WEBHOOK_SECRET) {
    logger.warn('[Telegram] TELEGRAM_WEBHOOK_SECRET not set — webhook origin is unverified');
  }
});

registerGracefulShutdown(server, {
  stopBackgroundJobs: () => {
    schedulerService.stop();
    stopAutoResume();
    stopSettlementBatchJob();
    stopChannelSettlementJob();
    stopJobAlertMonitor();
  },
  stopEventListener: () => eventListener.stop(),
  stopTelegram: () => telegramCommandService.stop(),
  clearHealthSnapshotInterval,
});