import * as crypto from 'crypto';
import { getLogger } from '../utils/logger';
import { getTTLConfig } from '../config/ttl-config';
import { SnapshotStorage } from './snapshot-storage';
import { getArchivalIndex, ArchivalStatus } from './archival-index';
import { getAuditService, AuditEventType } from '../services/audit-service';
import { BlockchainService } from '../services/blockchain-service';

const logger = getLogger('archiver');

/**
 * Entry archival data extracted from ledger/contract.
 */
export interface EntryToArchive {
  entryKey: string;
  entryType: string;
  expiryTimestamp: string;
  entryState: Record<string, any>;
  auditTrail: Array<{
    timestamp: string;
    action: string;
    actor: string;
    result: string;
  }>;
}

/**
 * Archival result tracking.
 */
export interface ArchivalResult {
  success: boolean;
  entryKey: string;
  snapshotHash?: string;
  txHash?: string;
  error?: string;
  durationMs: number;
}

/**
 * Archiver orchestrates the archival workflow:
 * 1. Detect expired entries ready for archival
 * 2. Create and redact snapshots
 * 3. Store snapshots off-chain
 * 4. Call mark_archived on-chain
 * 5. Record archival metadata
 */
export class Archiver {
  private snapshotStorage: SnapshotStorage;
  private archivalIndex = getArchivalIndex();
  private auditService = getAuditService();
  private blockchainService: BlockchainService;
  private encryptionKey: Buffer;

  constructor(blockchainService: BlockchainService) {
    this.blockchainService = blockchainService;
    this.snapshotStorage = new SnapshotStorage();

    // Load encryption key from environment or generate test key
    const keyHex = process.env.TTL_SNAPSHOT_ENCRYPTION_KEY;
    if (keyHex) {
      this.encryptionKey = Buffer.from(keyHex, 'hex');
    } else {
      // In production, this should be loaded from AWS Secrets Manager
      logger.warn('TTL_SNAPSHOT_ENCRYPTION_KEY not set; using default (test mode only)');
      this.encryptionKey = crypto.randomBytes(32);
    }
  }

  /**
   * Archive a single entry.
   * Returns ArchivalResult with success/failure details.
   */
  async archiveEntry(entry: EntryToArchive, operatorId: string): Promise<ArchivalResult> {
    const startTime = Date.now();
    const config = getTTLConfig();

    try {
      logger.info('Starting archival for entry', { entryKey: entry.entryKey, entryType: entry.entryType });

      // Step 1: Check if already archived
      const existing = await this.archivalIndex.getArchivalByEntryKey(entry.entryKey);
      if (existing && existing.status === ArchivalStatus.Archived) {
        logger.info('Entry already archived; skipping', { entryKey: entry.entryKey });
        return {
          success: true,
          entryKey: entry.entryKey,
          snapshotHash: existing.snapshotHash,
          txHash: existing.txHash,
          durationMs: Date.now() - startTime,
        };
      }

      // Step 2: Create snapshot
      const snapshot = this.createSnapshot(entry);
      const snapshotJson = JSON.stringify(snapshot);

      // Step 3: Redact sensitive fields if configured
      if (config.redactSensitiveFields) {
        snapshot.entryState = SnapshotStorage.redactSensitiveFields(snapshot.entryState);
      }

      // Step 4: Compute snapshot hash
      const snapshotHash = SnapshotStorage.computeSnapshotHash(snapshot);
      logger.info('Snapshot hash computed', { entryKey: entry.entryKey, snapshotHash });

      // Step 5: Store snapshot off-chain
      const snapshotPath = this.generateSnapshotPath(entry.entryKey);
      await this.snapshotStorage.storeSnapshot(
        snapshotPath,
        snapshot,
        config.snapshotEncryption ? this.encryptionKey : undefined,
      );

      logger.info('Snapshot stored', {
        entryKey: entry.entryKey,
        snapshotPath,
        snapshotHash,
      });

      // Step 6: Call mark_archived on-chain
      let txHash: string | undefined;
      let txSequence: number | undefined;

      if (!config.dryRun) {
        try {
          const markResult = await this.blockchainService.markArchived(
            entry.entryKey,
            snapshotHash,
            operatorId,
          );
          txHash = markResult.txHash;
          txSequence = markResult.sequence;

          logger.info('Marked archived on-chain', {
            entryKey: entry.entryKey,
            txHash,
            txSequence,
          });
        } catch (onChainError) {
          logger.error('Failed to mark archived on-chain; rolling back snapshot', {
            entryKey: entry.entryKey,
            error: onChainError,
          });

          // Rollback: delete the snapshot since on-chain mark failed
          await this.snapshotStorage.deleteSnapshot(snapshotPath).catch((deleteErr) => {
            logger.error('Failed to rollback snapshot', {
              entryKey: entry.entryKey,
              error: deleteErr,
            });
          });

          throw onChainError;
        }
      } else {
        // Dry run: simulate success
        txHash = '0xdryrun-' + entry.entryKey.substring(0, 16);
        txSequence = 0;
        logger.info('Dry run: mark_archived skipped', { entryKey: entry.entryKey });
      }

      // Step 7: Record archival metadata
      const retentionExpiresAt = new Date(
        Date.now() + config.archivalRetentionWindowMs,
      ).toISOString();

      await this.archivalIndex.insertArchival(
        entry.entryKey,
        entry.entryType,
        snapshotPath,
        snapshotHash,
        txHash!,
        txSequence!,
        entry.expiryTimestamp,
        operatorId,
        retentionExpiresAt,
      );

      logger.info('Archival metadata recorded', {
        entryKey: entry.entryKey,
        retentionExpiresAt,
      });

      // Step 8: Emit audit event
      await this.auditService.emitSecurityEvent({
        action: 'archival_snapshot_created',
        resourceType: 'contract_entry',
        resourceId: entry.entryKey.substring(0, 16),
        metadata: {
          entryKey: entry.entryKey,
          entryType: entry.entryType,
          snapshotHash,
          txHash,
          snapshotPath,
        },
        severity: 'info',
      });

      logger.info('Archival completed successfully', {
        entryKey: entry.entryKey,
        snapshotHash,
        txHash,
        durationMs: Date.now() - startTime,
      });

      return {
        success: true,
        entryKey: entry.entryKey,
        snapshotHash,
        txHash,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Archival failed', {
        entryKey: entry.entryKey,
        error: errorMessage,
        durationMs: Date.now() - startTime,
      });

      // Emit failure audit event
      await this.auditService.emitSecurityEvent({
        action: 'archival_snapshot_failed',
        resourceType: 'contract_entry',
        resourceId: entry.entryKey.substring(0, 16),
        metadata: {
          entryKey: entry.entryKey,
          entryType: entry.entryType,
          error: errorMessage,
        },
        severity: 'error',
      });

      return {
        success: false,
        entryKey: entry.entryKey,
        error: errorMessage,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Archive multiple entries in batch.
   * Respects rate limiting and batch constraints.
   */
  async archiveEntriesBatch(entries: EntryToArchive[], operatorId: string): Promise<ArchivalResult[]> {
    const config = getTTLConfig();
    const results: ArchivalResult[] = [];

    logger.info('Starting batch archival', {
      count: entries.length,
      maxBatchSize: config.batchSize,
    });

    for (const entry of entries.slice(0, config.batchSize)) {
      const result = await this.archiveEntry(entry, operatorId);
      results.push(result);

      // Short delay between entries to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const successCount = results.filter((r) => r.success).length;
    logger.info('Batch archival completed', {
      total: results.length,
      succeeded: successCount,
      failed: results.length - successCount,
    });

    return results;
  }

  /**
   * Create a snapshot object from entry data.
   */
  private createSnapshot(entry: EntryToArchive): Record<string, any> {
    return {
      archivalMetadata: {
        entryKey: entry.entryKey,
        entryType: entry.entryType,
        archivalVersion: '1.0',
        archivalTimestamp: new Date().toISOString(),
        expiryTimestamp: entry.expiryTimestamp,
        operatorId: process.env.WORKER_ID || 'archival-worker',
      },
      entryState: entry.entryState,
      auditTrail: entry.auditTrail,
    };
  }

  /**
   * Generate a storage path for a snapshot.
   * Format: archival/{entryKeyPrefix}/{entryKey}
   */
  private generateSnapshotPath(entryKey: string): string {
    const prefix = entryKey.substring(0, 16).toLowerCase();
    return `archival/${prefix}/${entryKey}`;
  }

  /**
   * Retrieve an archived snapshot (for restore/audit).
   */
  async retrieveArchivedSnapshot(entryKey: string): Promise<Record<string, any> | null> {
    const record = await this.archivalIndex.getArchivalByEntryKey(entryKey);
    if (!record) {
      logger.warn('Archival record not found', { entryKey });
      return null;
    }

    try {
      const snapshot = await this.snapshotStorage.retrieveSnapshot(
        record.snapshotPath,
        getTTLConfig().snapshotEncryption ? this.encryptionKey : undefined,
      );

      // Verify snapshot hash
      const computedHash = SnapshotStorage.computeSnapshotHash(snapshot);
      if (computedHash !== record.snapshotHash) {
        logger.error('Snapshot hash mismatch', {
          entryKey,
          expected: record.snapshotHash,
          computed: computedHash,
        });
        throw new Error('Snapshot integrity check failed');
      }

      logger.info('Archived snapshot retrieved successfully', { entryKey });
      return snapshot;
    } catch (error) {
      logger.error('Failed to retrieve archived snapshot', { entryKey, error });
      throw error;
    }
  }
}

/**
 * Get the Archiver singleton (requires BlockchainService).
 */
let cachedArchiver: Archiver | null = null;

export function getArchiver(blockchainService: BlockchainService): Archiver {
  if (!cachedArchiver) {
    cachedArchiver = new Archiver(blockchainService);
  }
  return cachedArchiver;
}

/**
 * Reset the Archiver cache (for testing).
 */
export function resetArchiver(): void {
  cachedArchiver = null;
}
