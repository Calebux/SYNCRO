import express from 'express';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import swaggerUi from 'swagger-ui-express';
import * as bip39 from 'bip39';

// Load environment variables before importing other modules
dotenv.config();

// Sentry Initialization
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  integrations: [nodeProfilingIntegration()],
  tracesSampleRate: 0.1,
  profilesSampleRate: 0.1,
});

import logger from './config/logger';
import { requestIdMiddleware } from './middleware/requestContext';
import { requestLoggerMiddleware } from './middleware/requestLogger';
import { schedulerService } from './services/scheduler';
import { reminderEngine } from './services/reminder-engine';
import { notificationPreferenceService } from './services/notification-preference-service';
import subscriptionRoutes from './routes/subscriptions';
import riskScoreRoutes from './routes/risk-score';
import simulationRoutes from './routes/simulation';
import merchantRoutes from './routes/merchants';
import teamRoutes from './routes/team';
import auditRoutes from './routes/audit';
import webhookRoutes from './routes/webhooks';
import complianceRoutes from './routes/compliance';
import tagsRoutes from './routes/tags';
import userRoutes from './routes/user';
import apiKeysRoutes from './routes/api-keys';
import digestRoutes from './routes/digest';
import mfaRoutes from './routes/mfa';
import pushNotificationRoutes from './routes/push-notifications';
import walletRoutes from './routes/wallet';
import emailRescanRoutes from './routes/email-rescan';
import gmailRouter from './routes/integrations/gmail'
import outlookRouter from './routes/integrations/outlook'
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
import { eventListener } from './services/event-listener';
import { expiryService } from './services/expiry-service';
import { authenticate } from './middleware/auth'
import { adminAuth } from './middleware/admin';
import { createAdminLimiter, RateLimiterFactory } from './middleware/rate-limit-factory';
import { scheduleAutoResume } from './jobs/auto-resume';
import giftCardLedgerRoutes from './routes/gift-card-ledger';
import notificationDeadLetterRoutes from './routes/notification-dead-letter';
import telegramWebhookRoutes from './routes/telegram-webhook';
import { telegramCommandService } from './services/telegram-command-service';
import calendarRouter from './routes/calendar';
import userPreferencesRoutes from './routes/user-preferences';
import reminderSettingsRoutes from './routes/reminder-settings';
import { errorHandler } from './middleware/errorHandler';
import { swaggerSpec } from './swagger';

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

// Basic Middlewares
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request context and logging
app.use(requestIdMiddleware);
app.use(requestLoggerMiddleware);

// Public Endpoints
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Swagger Documentation
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api/docs.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// API Routes
app.use('/api/keys', apiKeysRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/risk-score', riskScoreRoutes);
app.use('/api/simulation', simulationRoutes);
app.use('/api/merchants', merchantRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/integrations/gmail', authenticate, gmailRouter);
app.use('/api/integrations/outlook', authenticate, outlookRouter);
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
app.use('/api/digest', digestRoutes);
app.use('/api/mfa', mfaRoutes);
app.use('/api/notifications/push', pushNotificationRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/notifications/dead-letter', notificationDeadLetterRoutes);
app.use('/api/exchange-rates', createExchangeRatesRouter(exchangeRateService));
app.use('/api/gift-card-ledger', giftCardLedgerRoutes);
app.use('/api/telegram', telegramWebhookRoutes);
app.use('/api/calendar', calendarRouter);
app.use('/api/user-preferences', authenticate, userPreferencesRoutes);
app.use('/api/reminder-settings', authenticate, reminderSettingsRoutes);

app.get('/api/reminders/status', (req, res) => {
  const status = schedulerService.getStatus();
  res.json(status);
});

// Admin Monitoring Endpoints
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

app.get('/api/admin/metrics/ops-summary', createAdminLimiter(), adminAuth, async (req, res) => {
  try {
    const w = req.query.window as string;
    const windowHours = w ? parseInt(w, 10) : 24;
    if (isNaN(windowHours) || windowHours < 1 || windowHours > 720) {
      return res.status(400).json({ error: 'window must be between 1 and 720 hours' });
    }
    const [subscriptions, renewals, activity, trials, throughput, latency, retries] =
      await Promise.all([
        monitoringService.getSubscriptionMetrics(),
        monitoringService.getRenewalMetrics(),
        monitoringService.getAgentActivity(),
        monitoringService.getTrialMetrics(),
        monitoringService.getThroughputMetrics(windowHours),
        monitoringService.getLatencyMetrics(windowHours),
        monitoringService.getRetryMetrics(windowHours),
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
      db_pool: monitoringService.getPoolMetrics(),
    });
  } catch (error) {
    logger.error('Error fetching ops summary:', error);
    res.status(500).json({ error: 'Failed to fetch ops summary' });
  }
});

app.get('/api/admin/health', createAdminLimiter(), adminAuth, async (req, res) => {
  try {
    const includeHistory = req.query.history !== 'false';
    const health = await healthService.getAdminHealth(includeHistory, eventListener.getHealth());
    const statusCode = health.status === 'unhealthy' ? 503 : 200;
    res.status(statusCode).json({
      ...health,
      db_pool: monitoringService.getPoolMetrics(),
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
function startHealthSnapshotInterval() {
  setInterval(() => {
    healthService.recordSnapshot().catch(() => {});
  }, HEALTH_SNAPSHOT_INTERVAL_MS);
  setTimeout(() => healthService.recordSnapshot().catch(() => {}), 5000);
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

  telegramCommandService.init();
  if (process.env.TELEGRAM_BOT_TOKEN && !process.env.TELEGRAM_WEBHOOK_SECRET) {
    logger.warn('[Telegram] TELEGRAM_WEBHOOK_SECRET not set — webhook origin is unverified');
  }
});

// Graceful shutdown
const shutdown = () => {
  logger.info('Shutting down gracefully');
  schedulerService.stop();
  telegramCommandService.stop();
  eventListener.stop();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
