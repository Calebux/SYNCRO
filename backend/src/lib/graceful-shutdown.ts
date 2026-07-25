import type { Server } from 'node:http';
import * as Sentry from '@sentry/node';
import logger from '../config/logger';
import { redisStoreInstance } from './redis-store';
import { beginDrain, getShutdownTimeline, recordPhase } from './shutdown-state';
import { shutdownNotificationQueue } from '../jobs/notification-queue';

export const DRAIN_TIMEOUT_MS = 30_000;

export interface GracefulShutdownDeps {
  stopBackgroundJobs: () => void;
  stopEventListener: () => void;
  stopTelegram: () => void;
  clearHealthSnapshotInterval: () => void;
}

let shuttingDown = false;

function closeServerWithTimeout(server: Server): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      recordPhase('http_drain_timeout_forced_close');
      logger.warn(`HTTP drain exceeded ${DRAIN_TIMEOUT_MS}ms — forcing connection close`);
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      resolve();
    }, DRAIN_TIMEOUT_MS);

    server.close((err) => {
      clearTimeout(timer);
      if (err) {
        logger.error('Error closing HTTP server', { error: err.message });
      }
      recordPhase('http_server_closed');
      resolve();
    });
  });
}

export function registerGracefulShutdown(
  server: Server,
  deps: GracefulShutdownDeps,
): void {
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      logger.warn(`Received ${signal} during shutdown — ignoring duplicate signal`);
      return;
    }
    shuttingDown = true;

    beginDrain();
    recordPhase(`signal_${signal.toLowerCase()}_received`);
    logger.info(`Graceful shutdown initiated (${signal})`);

    try {
      recordPhase('stop_background_jobs');
      deps.stopBackgroundJobs();
      deps.stopEventListener();
      deps.stopTelegram();
      deps.clearHealthSnapshotInterval();

      recordPhase('bullmq_shutdown_start');
      await shutdownNotificationQueue();
      recordPhase('bullmq_shutdown_complete');

      recordPhase('redis_shutdown_start');
      await redisStoreInstance.shutdown();
      recordPhase('redis_shutdown_complete');

      recordPhase('http_drain_start');
      await closeServerWithTimeout(server);

      recordPhase('sentry_flush_start');
      await Sentry.close(2_000);
      recordPhase('shutdown_complete');

      logger.info('Graceful shutdown complete', {
        timeline: getShutdownTimelineForLog(),
      });
      process.exit(0);
    } catch (error) {
      recordPhase('shutdown_failed');
      logger.error('Graceful shutdown failed', {
        error: error instanceof Error ? error.message : String(error),
        timeline: getShutdownTimelineForLog(),
      });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

function getShutdownTimelineForLog(): Array<{ phase: string; elapsedMs: number }> {
  return getShutdownTimeline().map((entry) => ({
    phase: entry.phase,
    elapsedMs: entry.elapsedMs,
  }));
}
