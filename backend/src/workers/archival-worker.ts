/**
 * Archival Worker
 *
 * Detects expired contract entries and archives them by:
 * 1. Creating off-chain snapshots
 * 2. Computing snapshot hashes
 * 3. Calling mark_archived on-chain
 * 4. Recording archival metadata
 *
 * Runs on a configurable schedule (default: daily at 2 AM UTC).
 * Can be triggered manually via CLI or API.
 */

import { getLogger } from '../utils/logger';
import { getTTLConfig } from '../config/ttl-config';
import { Archiver, EntryToArchive, ArchivalResult } from '../archival';
import { getArchivalIndex, ArchivalStatus } from '../archival';
import { BlockchainService } from '../services/blockchain-service';
import { getAuditService } from '../services/audit-service';
import { supabase } from '../lib/supabase';

const logger = getLogger('archival-worker');

/**
 * Statistics from an archival worker run.
 */
export interface ArchivalWorkerStats {
  totalScanned: number;
  totalArchived: number;
  totalFailed: number;
  totalSkipped: number;
  durationMs: number;
  results: ArchivalResult[];
}

/**
 * Archival Worker implementation.
 */
export class ArchivalWorker {
  private archiver: Archiver;
  private archivalIndex = getArchivalIndex();
  private auditService = getAuditService();

  constructor(blockchainService: BlockchainService) {
    this.archiver = new Archiver(blockchainService);
  }

  /**
   * Run the archival worker.
   * Scans for expired entries and archives them.
   */
  async run(): Promise<ArchivalWorkerStats> {
    const startTime = Date.now();
    const config = getTTLConfig();
    const stats: ArchivalWorkerStats = {
      totalScanned: 0,
      totalArchived: 0,
      totalFailed: 0,
      totalSkipped: 0,
      durationMs: 0,
      results: [],
    };

    if (!config.enableArchival) {
      logger.info('Archival is disabled; skipping run');
      return stats;
    }

    logger.info('Starting archival worker run', {
      batchSize: config.batchSize,
      gracePeriod: `${config.archivalGracePeriod}${config.archivalGracePeriodUnit}`,
    });

    try {
      // Step 1: Scan for expired entries ready for archival
      const expiredEntries = await this.scanExpiredEntries();
      stats.totalScanned = expiredEntries.length;

      logger.info('Scanned for expired entries', {
        count: expiredEntries.length,
      });

      if (expiredEntries.length === 0) {
        logger.info('No expired entries ready for archival');
        return stats;
      }

      // Step 2: Archive entries in batch
      const results = await this.archiver.archiveEntriesBatch(
        expiredEntries,
        process.env.WORKER_ID || 'archival-worker',
      );

      stats.results = results;
      stats.totalArchived = results.filter((r) => r.success).length;
      stats.totalFailed = results.filter((r) => !r.success).length;
      stats.totalSkipped = stats.totalScanned - stats.totalArchived - stats.totalFailed;

      // Step 3: Emit audit event
      await this.auditService.emitSecurityEvent({
        action: 'archival_worker_run',
        resourceType: 'contract_entries',
        resourceId: 'batch',
        metadata: {
          totalScanned: stats.totalScanned,
          totalArchived: stats.totalArchived,
          totalFailed: stats.totalFailed,
        },
        severity: stats.totalFailed > 0 ? 'warning' : 'info',
      });

      stats.durationMs = Date.now() - startTime;

      logger.info('Archival worker run completed', {
        ...stats,
        durationMs: stats.durationMs,
      });

      return stats;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Archival worker run failed', {
        error: errorMessage,
        durationMs: Date.now() - startTime,
      });

      await this.auditService.emitSecurityEvent({
        action: 'archival_worker_failed',
        resourceType: 'contract_entries',
        resourceId: 'batch',
        metadata: {
          error: errorMessage,
        },
        severity: 'error',
      });

      throw error;
    }
  }

  /**
   * Scan for expired entries that are ready for archival.
   * Ready means: TTL expired AND grace period elapsed AND not yet archived.
   */
  private async scanExpiredEntries(): Promise<EntryToArchive[]> {
    const config = getTTLConfig();
    const gracePeriodMs = config.archivalGracePeriodMs;
    const now = new Date();
    const gracePeriodDeadline = new Date(now.getTime() - gracePeriodMs);

    const entries: EntryToArchive[] = [];

    try {
      // Query for cancelled or expired subscriptions
      const { data, error } = await supabase
        .from('subscriptions')
        .select('id, name, status, created_at, updated_at, price, billing_cycle, user_id')
        .in('status', ['expired', 'cancelled'])
        .lt('updated_at', gracePeriodDeadline.toISOString())
        .limit(config.batchSize)
        .order('updated_at', { ascending: true });

      if (error) {
        logger.error('Failed to query expired subscriptions for archival', { error });
        throw error;
      }

      // Convert subscriptions to entry data
      for (const sub of data || []) {
        const archivalIndex = getArchivalIndex();
        const alreadyArchived = await archivalIndex.isArchived(sub.id);

        if (!alreadyArchived) {
          entries.push({
            entryKey: sub.id,
            entryType: 'subscription',
            expiryTimestamp: sub.updated_at,
            entryState: {
              subscriptionId: sub.id,
              name: sub.name,
              status: sub.status,
              price: sub.price,
              billingCycle: sub.billing_cycle,
              createdAt: sub.created_at,
              updatedAt: sub.updated_at,
            },
            auditTrail: [
              {
                timestamp: sub.updated_at,
                action: 'subscription_' + sub.status,
                actor: sub.user_id || 'system',
                result: 'success',
              },
            ],
          });
        }
      }

      logger.info('Scanned subscriptions for archival', {
        found: entries.length,
        gracePeriodDeadline: gracePeriodDeadline.toISOString(),
      });

      return entries;
    } catch (error) {
      logger.error('Subscription scan for archival failed', { error });
      return [];
    }
  }
}

/**
 * Get the Archival Worker singleton.
 */
let cachedWorker: ArchivalWorker | null = null;

export function getArchivalWorker(blockchainService: BlockchainService): ArchivalWorker {
  if (!cachedWorker) {
    cachedWorker = new ArchivalWorker(blockchainService);
  }
  return cachedWorker;
}

/**
 * Reset the Archival Worker cache (for testing).
 */
export function resetArchivalWorker(): void {
  cachedWorker = null;
}
