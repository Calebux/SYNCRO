import express from 'express';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import * as bip39 from 'bip39';
import { resolveRelease, resolveEnvironment, scrubEvent, SENTRY_TAG_KEYS } from '../../shared/src/sentry';
import { validateEnv, env } from './config/env';

// Load environment variables before importing other modules
dotenv.config();
validateEnv();

// Sentry Initialization
Sentry.init({
  dsn: env.SENTRY_DSN,
  release: resolveRelease(),
  environment: resolveEnvironment(),
  integrations: [nodeProfilingIntegration()],
  tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
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
<<<<<<< HEAD
=======
import { container } from './services/container';
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
>>>>>>> main
import { monitoringService } from './services/monitoring-service';
import { dependencyHealthService } from './services/dependency-health-service';
import { eventListener } from './services/event-listener';
import { RateLimiterFactory } from './middleware/rate-limit-factory';
import { scheduleAutoResume, stopAutoResume } from './jobs/auto-resume';
import { startSettlementBatchJob, stopSettlementBatchJob } from './jobs/settlement-batch-job';
import { startStealthScanJob } from './jobs/stealth-scan-job';
import { startChannelMonitorJob } from './jobs/channel-monitor-job';
import { startChannelSettlementJob, stopChannelSettlementJob } from './jobs/channel-settlement-job';
import { startJobAlertMonitor, stopJobAlertMonitor } from './jobs/job-alert-monitor';
import { startWebhookRetryJob, stopWebhookRetryJob } from './jobs/webhook-retry-job';
import { isDraining } from './lib/shutdown-state';
import { registerGracefulShutdown } from './lib/graceful-shutdown';
import { telegramCommandService } from './services/telegram-command-service';
import { registerWebhookHandlers } from './services/webhook-handlers';
import { errorHandler } from './middleware/errorHandler';

// ── Route Registry ────────────────────────────────────────────────────────────
// The registry is the single source of truth for the API surface.
// It replaces manual app.use wiring with declarative route descriptors.
import { buildRouteRegistry } from './routes/route-registry';
import { generateOpenApiFromRegistry } from './routes/registry/openapi';

const app = express();
const PORT = env.PORT;

// Validate Admin API Key
const ADMIN_API_KEY = env.ADMIN_API_KEY;

// Sentry Request Handler
app.use(Sentry.Handlers.requestHandler());

// CORS configuration
const FRONTEND_URL = env.FRONTEND_URL;
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

// Inbound webhook handlers must be registered before any delivery is ingested
// (issue #1283): an unregistered event type is treated as a successful no-op.
registerWebhookHandlers();

// Payment webhooks require raw body for cryptographic signature verification.
// These are mounted BEFORE express.json() so they receive the raw buffer.
import paystackWebhookRoutes from './routes/paystack-webhook';
import stripeWebhookRoutes from './routes/stripe-webhook';
import paypalWebhookRoutes from './routes/paypal-webhook';
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

// ── Health & Readiness Endpoints (No Auth Required) ──────────────────────────

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
    const { getQueueHealthMetrics } = await import('./routes/admin-queues');
    const queueHealth = await getQueueHealthMetrics();
    const overallStatus = readiness.status === 'ready' && queueHealth.healthy ? 'ok' : 'degraded';
    const httpStatus = readiness.status === 'ready' ? 200 : 503;
    res.status(httpStatus).json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime_ms: liveness.uptime_ms,
      version: '1.0.0',
      environment: env.NODE_ENV,
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

// Core SLIs Metrics Endpoint (Prometheus / JSON) — mounted by registry at /api/metrics

// ── Route Registry ────────────────────────────────────────────────────────────
// The registry validates all descriptors at startup (auth must be explicit),
// applies cross-cutting middleware uniformly, and mounts everything.

const registry = buildRouteRegistry();
registry.mount(app);

// Admin queues UI (Bull Board) — mounted at /admin/queues, outside /api
// Auth and rate-limit are applied from the descriptor at /api/admin/queues
// in the registry.  This mount exposes the Bull Board UI at its own path.
import adminQueuesRoutes from './routes/admin-queues';
app.use('/admin/queues', adminQueuesRoutes);

// Generate OpenAPI spec from the registry
// Webhook routes (stripe, paystack, paypal) are mounted before express.json()
// in index.ts for raw body access, so we pass them as external descriptors.
import type { RouteDescriptor } from './routes/registry';

const webhookDescriptors: RouteDescriptor[] = [
  {
    method: 'POST',
    path: '/webhooks/stripe',
    version: 'v1',
    auth: 'public',
    rawBody: true,
    tags: ['Webhooks'],
    summary: 'Stripe webhook ingestion',
    description: 'Inbound webhook endpoint for Stripe. Requires raw body for signature verification.',
    handler: stripeWebhookRoutes,
  },
  {
    method: 'POST',
    path: '/webhooks/paystack',
    version: 'v1',
    auth: 'public',
    rawBody: true,
    tags: ['Webhooks'],
    summary: 'Paystack webhook ingestion',
    description: 'Inbound webhook endpoint for Paystack. Requires raw body for signature verification.',
    handler: paystackWebhookRoutes,
  },
  {
    method: 'POST',
    path: '/webhooks/paypal',
    version: 'v1',
    auth: 'public',
    rawBody: true,
    tags: ['Webhooks'],
    summary: 'PayPal webhook ingestion',
    description: 'Inbound webhook endpoint for PayPal. Requires raw body for signature verification.',
    handler: paypalWebhookRoutes,
  },
];

<<<<<<< HEAD
const registryOpenApi = generateOpenApiFromRegistry(registry, {}, webhookDescriptors);
app.get('/api/openapi.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(registryOpenApi);
=======
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
    await container.reminderEngine.processReminders();
    res.json({ success: true, message: 'Reminders processed' });
  } catch (error) {
    logger.error('Error processing reminders:', error);
    res.status(500).json({ success: false, error: 'Failed to process reminders' });
  }
});

app.post('/api/reminders/schedule', createAdminLimiter(), adminAuth, async (req, res) => {
  try {
    const daysBefore = req.body.daysBefore || [7, 3, 1];
    await container.reminderEngine.scheduleReminders(daysBefore);
    res.json({ success: true, message: 'Reminders scheduled' });
  } catch (error) {
    logger.error('Error scheduling reminders:', error);
    res.status(500).json({ success: false, error: 'Failed to schedule reminders' });
  }
});

app.post('/api/reminders/retry', createAdminLimiter(), adminAuth, async (req, res) => {
  try {
    await container.reminderEngine.processRetries();
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
>>>>>>> main
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
    monitoringService.recordSnapshot().catch(() => { });
  }, HEALTH_SNAPSHOT_INTERVAL_MS);
  healthSnapshotTimeout = setTimeout(() => monitoringService.recordSnapshot().catch(() => { }), 5000);
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
  logger.info(`Environment: ${env.NODE_ENV}`);

  // Validation
  const criticalEnvVars = ['SOROBAN_CONTRACT_ADDRESS', 'STELLAR_NETWORK_URL'] as const;
  for (const envVar of criticalEnvVars) {
    if (!env[envVar]) {
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

  // Log the route inventory
  logger.info(registry.generateInventory());

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
  startWebhookRetryJob();

  telegramCommandService.init();
  if (env.TELEGRAM_BOT_TOKEN && !env.TELEGRAM_WEBHOOK_SECRET) {
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
    stopWebhookRetryJob();
  },
  stopEventListener: () => eventListener.stop(),
  stopTelegram: () => telegramCommandService.stop(),
  clearHealthSnapshotInterval,
});
