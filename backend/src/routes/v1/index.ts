import express from 'express';
import subscriptionRoutes from '../subscriptions';
import riskScoreRoutes from '../risk-score';
import simulationRoutes from '../simulation';
import merchantRoutes from '../merchants';
import teamRoutes from '../team';
import digestRoutes from '../digest';
import pushNotificationsRoutes from '../push-notifications';
import userRoutes from '../user';
import integrationRoutes from '../integrations';

import { schedulerService } from '../../services/scheduler';
import { reminderEngine } from '../../services/reminder-engine';
import { monitoringService } from '../../services/monitoring-service';
import { healthService } from '../../services/health-service';
import { expiryService } from '../../services/expiry-service';
import { adminAuth } from '../../middleware/admin';
import logger from '../../config/logger';

const v1Router = express.Router();

// Standard API Routes
v1Router.use('/subscriptions', subscriptionRoutes);
v1Router.use('/risk-score', riskScoreRoutes);
v1Router.use('/simulation', simulationRoutes);
v1Router.use('/merchants', merchantRoutes);
v1Router.use('/team', teamRoutes);
v1Router.use('/digest', digestRoutes);
v1Router.use('/push-notifications', pushNotificationsRoutes);
v1Router.use('/user', userRoutes);
v1Router.use('/integrations', integrationRoutes);

// Auth alias (some parts of frontend might use /api/v1/auth)
v1Router.use('/auth', userRoutes);

// Reminders Routes
v1Router.get('/reminders/status', (req: express.Request, res: express.Response) => {
  const status = schedulerService.getStatus();
  res.json(status);
});

v1Router.post('/reminders/process', adminAuth, async (req: express.Request, res: express.Response) => {
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

v1Router.post('/reminders/schedule', adminAuth, async (req: express.Request, res: express.Response) => {
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

v1Router.post('/reminders/retry', adminAuth, async (req: express.Request, res: express.Response) => {
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

// Admin Metrics Endpoints
v1Router.get('/admin/metrics/subscriptions', adminAuth, async (req: express.Request, res: express.Response) => {
  try {
    const metrics = await monitoringService.getSubscriptionMetrics();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch subscription metrics' });
  }
});

v1Router.get('/admin/metrics/renewals', adminAuth, async (req: express.Request, res: express.Response) => {
  try {
    const metrics = await monitoringService.getRenewalMetrics();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch renewal metrics' });
  }
});

v1Router.get('/admin/metrics/activity', adminAuth, async (req: express.Request, res: express.Response) => {
  try {
    const metrics = await monitoringService.getAgentActivity();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch agent activity' });
  }
});

v1Router.get('/admin/health', adminAuth, async (req: express.Request, res: express.Response) => {
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

v1Router.post('/admin/expiry/process', adminAuth, async (req: express.Request, res: express.Response) => {
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

export default v1Router;
