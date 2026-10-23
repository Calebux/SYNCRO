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
  stopOutboxPublisher: () => void;
  clearHealthSnapshotInterval: () => void;
  /** Stop accepting new paid calls (e.g. flip a gate / reject new metered requests). */
  stopAcceptingPaidCalls?: () => void;
  /** Flush unflushed meter write-ahead log entries to durable storage. */
  flushMeterWal?: () => Promise<void>;
  /** Drain queued settlement channel states / pending settlement batches. */
  drainSettlementBatcher?: () => Promise<void>;
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

async function runWithDeadline(
  phase: string,
  fn: () => Promise<void>,
  timeoutMs: number,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      recordPhase(`${phase}_timeout`);
      logger.warn(`${phase} exceeded ${timeoutMs}ms — continuing shutdown`);
      resolve();
    }, timeoutMs);
  });

  try {
    await Promise.race([fn(), timeout]);
  } catch (error) {
    recordPhase(`${phase}_failed`);
    logger.error(`${phase} failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
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
      // Stop accepting new paid calls first so no new usage enters the WAL.
      if (deps.stopAcceptingPaidCalls) {
        recordPhase('stop_accepting_paid_calls');
        try {
          deps.stopAcceptingPaidCalls();
        } catch (error) {
          logger.error('Failed to stop accepting paid calls', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      recordPhase('stop_background_jobs');
      deps.stopBackgroundJobs();
      deps.stopEventListener();
      deps.stopTelegram();
      deps.stopOutboxPublisher();
      deps.clearHealthSnapshotInterval();

      recordPhase('bullmq_shutdown_start');
      await shutdownNotificationQueue();
      recordPhase('bullmq_shutdown_complete');

      // Drain in-flight paid calls with a deadline before flushing usage.
      recordPhase('http_drain_start');
      await closeServerWithTimeout(server);

      // Persist unflushed meter WAL entries and queued settlement states.
      if (deps.flushMeterWal) {
        recordPhase('meter_wal_flush_start');
        await runWithDeadline('meter_wal_flush', deps.flushMeterWal, DRAIN_TIMEOUT_MS);
        recordPhase('meter_wal_flush_complete');
      }

      if (deps.drainSettlementBatcher) {
        recordPhase('settlement_drain_start');
        await runWithDeadline(
          'settlement_drain',
          deps.drainSettlementBatcher,
          DRAIN_TIMEOUT_MS,
        );
        recordPhase('settlement_drain_complete');
      }

      recordPhase('redis_shutdown_start');
      await redisStoreInstance.shutdown();
      recordPhase('redis_shutdown_complete');

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
