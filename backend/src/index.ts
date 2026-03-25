import express from 'express';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
// Load environment variables before importing other modules
dotenv.config();

import logger from './config/logger';
import { requestIdMiddleware } from './middleware/requestContext';
import { requestLoggerMiddleware } from './middleware/requestLogger';
import { schedulerService } from './services/scheduler';
import { reminderEngine } from './services/reminder-engine';
import subscriptionRoutes from './routes/subscriptions';
import riskScoreRoutes from './routes/risk-score';
import simulationRoutes from './routes/simulation';
import merchantRoutes from './routes/merchants';
import teamRoutes from './routes/team';
import auditRoutes from './routes/audit';
import { authLimiter, keyCreationLimiter } from './middleware/rateLimit';
import { monitoringService } from './services/monitoring-service';
import { healthService } from './services/health-service';
import { eventListener } from './services/event-listener';
import { expiryService } from './services/expiry-service';

const app = express();
const PORT = process.env.PORT || 3001;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'development-admin-key';

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

// Middleware
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request tracing — must come before routes so every log line carries requestId
app.use(requestIdMiddleware);
app.use(requestLoggerMiddleware);


import { adminAuth } from './middleware/admin';

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/risk-score', riskScoreRoutes);
app.use('/api/simulation', simulationRoutes);
app.use('/api/merchants', merchantRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/audit', auditRoutes);

// Rate limit auth endpoints (covers /api/auth/login, /api/auth/refresh etc)
app.use('/api/auth', authLimiter);

// Rate limit API key creation
app.post('/api/keys', keyCreationLimiter, (req, res) => {
  // This is a placeholder for the /api/keys endpoint if it's implemented here or elsewhere
  res.status(404).json({ error: 'Not implemented' });
});

// API Routes (Public/Standard)
app.get('/api/reminders/status', (req, res) => {
  const status = schedulerService.getStatus();
  res.json(status);
});

// Admin Monitoring Endpoints (Read-only)
app.get('/api/admin/metrics/subscriptions', adminAuth, async (req, res) => {
  try {
    const metrics = await monitoringService.getSubscriptionMetrics();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch subscription metrics' });
  }
});

app.get('/api/admin/metrics/renewals', adminAuth, async (req, res) => {
  try {
    const metrics = await monitoringService.getRenewalMetrics();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch renewal metrics' });
  }
});

app.get('/api/admin/metrics/activity', adminAuth, async (req, res) => {
  try {
    const metrics = await monitoringService.getAgentActivity();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch agent activity' });
  }
});

// Protocol Health Monitor: unified admin health (metrics, alerts, history)
app.get('/api/admin/health', adminAuth, async (req, res) => {
  try {
    const includeHistory = req.query.history !== 'false';
    const health = await healthService.getAdminHealth(includeHistory);
    const statusCode = health.status === 'unhealthy' ? 503 : 200;
    res.status(statusCode).json(health);
  } catch (error) {
    logger.error('Error fetching admin health:', error);
    res.status(500).json({ error: 'Failed to fetch health status' });
  }
});

// Manual trigger endpoints (for testing/admin - Should eventually be protected)
app.post('/api/reminders/process', adminAuth, async (req, res) => {
  try {
    await reminderEngine.processReminders();
    res.json({ success: true, message: 'Reminders processed' });
  } catch (error) {
    logger.error('Error processing reminders:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post('/api/reminders/schedule', adminAuth, async (req, res) => {
  try {
    const daysBefore = req.body.daysBefore || [7, 3, 1];
    await reminderEngine.scheduleReminders(daysBefore);
    res.json({ success: true, message: 'Reminders scheduled' });
  } catch (error) {
    logger.error('Error scheduling reminders:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post('/api/reminders/retry', adminAuth, async (req, res) => {
  try {
    await reminderEngine.processRetries();
    res.json({ success: true, message: 'Retries processed' });
  } catch (error) {
    logger.error('Error processing retries:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Protocol Health Monitor: record metrics snapshot periodically (historical storage)
const HEALTH_SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
function startHealthSnapshotInterval() {
  setInterval(() => {
    healthService.recordSnapshot().catch(() => {});
  }, HEALTH_SNAPSHOT_INTERVAL_MS);
  // Record one snapshot shortly after startup
  setTimeout(() => healthService.recordSnapshot().catch(() => {}), 5000);
}

app.post('/api/admin/expiry/process', adminAuth, async (req, res) => {
  try {
    const result = await expiryService.processExpiries();
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Error processing expiries:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});


// Start server
const server = app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // Start scheduler
  schedulerService.start();

  // Start health metrics snapshot loop
  startHealthSnapshotInterval();

  // Start event listener
  eventListener.start().catch(err => {
    logger.error('Failed to start event listener:', err);
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  schedulerService.stop();
  eventListener.stop();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  schedulerService.stop();
  eventListener.stop();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

