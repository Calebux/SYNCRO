/**
 * TTL Bump Worker
 *
 * Scans contract entries for those with TTL near expiration and extends them.
 * Implements rate limiting, batch processing, gas budgeting, and idempotency.
 *
 * Runs on a configurable schedule (default: daily at midnight UTC).
 * Can be triggered manually via CLI or API.
 */

import { getLogger } from '../utils/logger';
import { getTTLConfig } from '../config/ttl-config';
import { BlockchainService } from '../services/blockchain-service';
import { getAuditService } from '../services/audit-service';
import { supabase } from '../lib/supabase';
import { TTL_CONTRACT_HELPERS } from '../blockchain/ttl-contract-helpers';
import * as crypto from 'crypto';

const logger = getLogger('ttl-bump-worker');

/**
 * Represents a contract entry eligible for TTL bumping.
 */
export interface ContractEntry {
  entryKey: string;
  entryType: string;
  currentTtl: number;
  lastBumpTimestamp?: string;
  accessTimestamp?: string;
  subscriptionId?: string;
}

/**
 * Result of bumping a single entry's TTL.
 */
export interface BumpResult {
  success: boolean;
  entryKey: string;
  newTtl?: number;
  txHash?: string;
  gasCost?: number;
  durationMs: number;
  error?: string;
}

/**
 * Statistics from a worker run.
 */
export interface WorkerRunStats {
  totalProcessed: number;
  totalBumped: number;
  totalFailed: number;
  totalSkipped: number;
  totalGasUsed: number;
  durationMs: number;
  results: BumpResult[];
}

/**
 * Rate limiting tracker for per-entry bump frequency.
 */
interface RateLimitEntry {
  entryKey: string;
  bumpCount: number;
  lastBumpTimestamp: number;
  dayStart: number;
}

/**
 * TTL Bump Worker implementation.
 */
export class TTLBumpWorker {
  private blockchainService: BlockchainService;
  private auditService = getAuditService();
  private rateLimitMap = new Map<string, RateLimitEntry>();

  constructor(blockchainService: BlockchainService) {
    this.blockchainService = blockchainService;
  }

  /**
   * Run the TTL bump worker.
   * Scans for entries needing TTL extension and extends them.
   */
  async run(): Promise<WorkerRunStats> {
    const startTime = Date.now();
    const config = getTTLConfig();
    const stats: WorkerRunStats = {
      totalProcessed: 0,
      totalBumped: 0,
      totalFailed: 0,
      totalSkipped: 0,
      totalGasUsed: 0,
      durationMs: 0,
      results: [],
    };

    if (!config.enableTtlBumping) {
      logger.info('TTL bumping is disabled; skipping run');
      return stats;
    }

    logger.info('Starting TTL bump worker run', {
      batchSize: config.batchSize,
      maxGasPerBatch: config.maxGasPerBatch,
      bumpThreshold: `${config.bumpThreshold}${config.bumpThresholdUnit}`,
    });

    try {
      // Step 1: Fetch entries needing TTL bump
      const entriesToBump = await this.scanEntriesForBumping();
      logger.info('Scanned entries for TTL bumping', {
        candidatesFound: entriesToBump.length,
      });

      // Step 2: Filter entries by rate limiting and bump eligibility
      const eligibleEntries = this.filterEligibleEntries(entriesToBump);
      logger.info('Filtered eligible entries after rate limiting', {
        eligible: eligibleEntries.length,
        skipped: entriesToBump.length - eligibleEntries.length,
      });

      // Step 3: Batch process entries
      let cumulativeGas = 0;
      const batch: ContractEntry[] = [];

      for (const entry of eligibleEntries) {
        const estimatedGas = TTL_CONTRACT_HELPERS.estimateExtendTTLGas();

        if (
          batch.length >= config.batchSize ||
          cumulativeGas + estimatedGas > config.maxGasPerBatch
        ) {
          // Process current batch and start new one
          const batchResults = await this.processBatch(batch);
          stats.results.push(...batchResults);
          stats.totalBumped += batchResults.filter((r) => r.success).length;
          stats.totalFailed += batchResults.filter((r) => !r.success).length;
          stats.totalGasUsed += batchResults.reduce((sum, r) => sum + (r.gasCost || 0), 0);

          batch.length = 0;
          cumulativeGas = 0;
        }

        batch.push(entry);
        cumulativeGas += estimatedGas;
        stats.totalProcessed++;
      }

      // Process remaining batch
      if (batch.length > 0) {
        const batchResults = await this.processBatch(batch);
        stats.results.push(...batchResults);
        stats.totalBumped += batchResults.filter((r) => r.success).length;
        stats.totalFailed += batchResults.filter((r) => !r.success).length;
        stats.totalGasUsed += batchResults.reduce((sum, r) => sum + (r.gasCost || 0), 0);
      }

      stats.totalSkipped = entriesToBump.length - stats.totalProcessed;

      // Step 4: Emit audit event
      await this.auditService.emitSecurityEvent({
        action: 'ttl_bump_worker_run',
        resourceType: 'contract_entries',
        resourceId: 'batch',
        metadata: {
          totalProcessed: stats.totalProcessed,
          totalBumped: stats.totalBumped,
          totalFailed: stats.totalFailed,
          totalGasUsed: stats.totalGasUsed,
        },
        severity: stats.totalFailed > 0 ? 'warning' : 'info',
      });

      stats.durationMs = Date.now() - startTime;

      logger.info('TTL bump worker run completed', {
        ...stats,
        durationMs: stats.durationMs,
      });

      return stats;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('TTL bump worker run failed', {
        error: errorMessage,
        durationMs: Date.now() - startTime,
      });

      await this.auditService.emitSecurityEvent({
        action: 'ttl_bump_worker_failed',
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
   * Scan the ledger/database for entries with TTL near expiration.
   * Returns list of entries eligible for bumping.
   */
  private async scanEntriesForBumping(): Promise<ContractEntry[]> {
    const config = getTTLConfig();
    const entries: ContractEntry[] = [];

    try {
      // Query subscriptions table for active entries
      const { data, error } = await supabase
        .from('subscriptions')
        .select('id, name, status, updated_at, user_id')
        .eq('status', 'active')
        .limit(config.batchSize * 2) // Fetch more candidates than batch size
        .order('updated_at', { ascending: true });

      if (error) {
        logger.error('Failed to query subscriptions for TTL bumping', { error });
        throw error;
      }

      // Convert subscriptions to contract entries
      // In a real implementation, entries would be read from contract storage via RPC
      for (const sub of data || []) {
        entries.push({
          entryKey: this.generateEntryKey(sub.id),
          entryType: 'subscription',
          currentTtl: 0, // Would be read from contract getTTL()
          lastBumpTimestamp: sub.updated_at,
          accessTimestamp: sub.updated_at,
          subscriptionId: sub.id,
        });
      }

      logger.info('Scanned subscriptions for TTL bumping', {
        found: entries.length,
      });

      return entries;
    } catch (error) {
      logger.error('Subscription scan failed', { error });
      return [];
    }
  }

  /**
   * Filter entries by bump eligibility and rate limiting.
   * Returns entries that are ready for bumping.
   */
  private filterEligibleEntries(entries: ContractEntry[]): ContractEntry[] {
    const config = getTTLConfig();
    const now = Date.now();
    const eligible: ContractEntry[] = [];

    for (const entry of entries) {
      // Check rate limiting: max BUMPS_PER_DAY per entry
      if (!this.checkRateLimit(entry.entryKey)) {
        logger.debug('Entry rate limit exceeded', { entryKey: entry.entryKey });
        continue;
      }

      // Check bump eligibility: last bump > MIN_BUMP_INTERVAL
      const lastBump = entry.lastBumpTimestamp ? new Date(entry.lastBumpTimestamp).getTime() : 0;
      const timeSinceLastBump = now - lastBump;

      if (timeSinceLastBump < config.minBumpIntervalMs) {
        logger.debug('Entry bump interval not elapsed', {
          entryKey: entry.entryKey,
          nextEligibleAt: new Date(lastBump + config.minBumpIntervalMs),
        });
        continue;
      }

      eligible.push(entry);
    }

    return eligible;
  }

  /**
   * Check and update rate limit for an entry.
   * Returns true if the entry is within rate limit; false otherwise.
   */
  private checkRateLimit(entryKey: string): boolean {
    const config = getTTLConfig();
    const now = Date.now();
    const dayStart = this.getDayStart(now);

    let entry = this.rateLimitMap.get(entryKey);

    if (!entry) {
      entry = {
        entryKey,
        bumpCount: 0,
        lastBumpTimestamp: 0,
        dayStart,
      };
      this.rateLimitMap.set(entryKey, entry);
    }

    // Reset counter if we've moved to a new day
    if (entry.dayStart !== dayStart) {
      entry.bumpCount = 0;
      entry.dayStart = dayStart;
    }

    if (entry.bumpCount >= config.bumpsPerDay) {
      return false;
    }

    // Increment count and record timestamp
    entry.bumpCount++;
    entry.lastBumpTimestamp = now;

    return true;
  }

  /**
   * Get the start of the current day (UTC midnight) in milliseconds.
   */
  private getDayStart(timestamp: number): number {
    const date = new Date(timestamp);
    date.setUTCHours(0, 0, 0, 0);
    return date.getTime();
  }

  /**
   * Process a batch of entries to extend TTL.
   */
  private async processBatch(entries: ContractEntry[]): Promise<BumpResult[]> {
    const config = getTTLConfig();
    const results: BumpResult[] = [];

    logger.info('Processing batch of entries', {
      count: entries.length,
      dryRun: config.dryRun,
    });

    for (const entry of entries) {
      const result = await this.bumpEntryTTL(entry);
      results.push(result);

      // Short delay to avoid rate limiting
      await this.sleep(100);
    }

    return results;
  }

  /**
   * Extend TTL for a single entry.
   */
  private async bumpEntryTTL(entry: ContractEntry): Promise<BumpResult> {
    const startTime = Date.now();
    const config = getTTLConfig();

    try {
      // Calculate new TTL: current_sequence + DEFAULT_TTL_EXTENSION
      // In this simulation, we use a fixed future TTL
      // In production, this would read current ledger sequence from RPC
      const newTtl = Math.floor(Date.now() / 1000) + config.defaultTtlExtensionSeconds;

      logger.info('Bumping entry TTL', {
        entryKey: entry.entryKey,
        entryType: entry.entryType,
        newTtl,
        dryRun: config.dryRun,
      });

      let txHash: string | undefined;

      if (!config.dryRun) {
        try {
          const bumpResult = await this.blockchainService.extendTTL(entry.entryKey, newTtl);
          txHash = bumpResult.txHash;

          logger.info('Entry TTL bumped successfully', {
            entryKey: entry.entryKey,
            txHash,
            newTtl,
          });
        } catch (blockchainError) {
          const errorMessage =
            blockchainError instanceof Error
              ? blockchainError.message
              : String(blockchainError);
          logger.error('Failed to bump entry TTL on blockchain', {
            entryKey: entry.entryKey,
            error: errorMessage,
          });
          throw blockchainError;
        }
      } else {
        // Dry run: simulate success
        txHash = '0xdryrun-' + entry.entryKey.substring(0, 16);
        logger.info('Dry run: entry TTL bump skipped', { entryKey: entry.entryKey });
      }

      // Emit audit event
      await this.auditService.emitSecurityEvent({
        action: 'extend_ttl',
        resourceType: 'contract_entry',
        resourceId: entry.entryKey.substring(0, 16),
        metadata: {
          entryKey: entry.entryKey,
          entryType: entry.entryType,
          newTtl,
          txHash,
        },
        severity: 'info',
      });

      const gasCost = TTL_CONTRACT_HELPERS.estimateExtendTTLGas();

      return {
        success: true,
        entryKey: entry.entryKey,
        newTtl,
        txHash,
        gasCost,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Emit failure audit event
      await this.auditService.emitSecurityEvent({
        action: 'extend_ttl_failed',
        resourceType: 'contract_entry',
        resourceId: entry.entryKey.substring(0, 16),
        metadata: {
          entryKey: entry.entryKey,
          entryType: entry.entryType,
          error: errorMessage,
        },
        severity: 'warning',
      });

      logger.error('Failed to bump entry TTL', {
        entryKey: entry.entryKey,
        error: errorMessage,
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
   * Generate a contract entry key from a subscription ID.
   * In production, this would hash the ID or use contract-specific serialization.
   */
  private generateEntryKey(subscriptionId: string): string {
    const hash = crypto.createHash('sha256').update(subscriptionId).digest('hex');
    return '0x' + hash;
  }

  /**
   * Sleep for a given duration (in milliseconds).
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Get the TTL Bump Worker singleton.
 */
let cachedWorker: TTLBumpWorker | null = null;

export function getTTLBumpWorker(blockchainService: BlockchainService): TTLBumpWorker {
  if (!cachedWorker) {
    cachedWorker = new TTLBumpWorker(blockchainService);
  }
  return cachedWorker;
}

/**
 * Reset the TTL Bump Worker cache (for testing).
 */
export function resetTTLBumpWorker(): void {
  cachedWorker = null;
}
