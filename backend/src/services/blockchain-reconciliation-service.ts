import { supabase } from '../config/database';
import logger from '../config/logger';
import { emitSecurityEvent } from './audit-service';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ReconciliationMismatch {
  subscriptionId: string;
  blockchainSubId: number;
  contractEventType: string;
  contractTxHash: string;
  contractLedger: number;
  contractProcessedAt: string;
  renewalHistoryId: string | null;
  mismatchType: 'missing_from_history' | 'hash_mismatch' | 'orphan_event';
  notes?: string;
}

export interface ReconciliationResult {
  runId: string;
  startedAt: string;
  completedAt: string;
  totalContractEvents: number;
  totalRenewalRecords: number;
  matched: number;
  mismatches: ReconciliationMismatch[];
  repaired: number;
}

// ─── Service ──────────────────────────────────────────────────────────────────

const RECONCILIATION_WINDOW_DAYS = 90;
const REPAIR_BATCH_SIZE = 50;

class BlockchainReconciliationService {
  /**
   * Run a full reconciliation between on-chain contract_events and
   * backend renewal_history.
   *
   * Process:
   *   1. Fetch all contract_events within the reconciliation window.
   *   2. Fetch all renewal_history records with a transaction_hash.
   *   3. Match by (transaction_hash, blockchain_sub_id → subscription_id).
   *   4. Report mismatches:
   *      a. Contract events with no matching renewal_history (orphan).
   *      b. Renewal records whose transaction_hash doesn't match any event.
   *   5. Optionally repair certain mismatches automatically.
   */
  async runReconciliation(
    windowDays: number = RECONCILIATION_WINDOW_DAYS,
    autoRepair: boolean = false,
  ): Promise<ReconciliationResult> {
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const cutoff = new Date(Date.now() - windowDays * 86400 * 1000).toISOString();

    logger.info(`Starting blockchain reconciliation run ${runId}`, { windowDays, autoRepair });

    // 1. Fetch contract events
    const { data: contractEvents, error: ceError } = await supabase
      .from('contract_events')
      .select('*')
      .gte('processed_at', cutoff)
      .order('processed_at', { ascending: false });

    if (ceError) {
      logger.error('Failed to fetch contract events for reconciliation:', ceError);
      throw new Error(`Reconciliation failed: ${ceError.message}`);
    }

    // 2. Fetch subscriptions to map blockchain_sub_id → subscription_id
    const { data: subscriptions, error: subError } = await supabase
      .from('subscriptions')
      .select('id, blockchain_sub_id')
      .not('blockchain_sub_id', 'is', null);

    if (subError) {
      logger.error('Failed to fetch subscriptions for reconciliation:', subError);
      throw new Error(`Reconciliation failed: ${subError.message}`);
    }

    const subMap = new Map<number, string>();
    for (const sub of subscriptions || []) {
      if (sub.blockchain_sub_id != null) {
        subMap.set(sub.blockchain_sub_id, sub.id);
      }
    }

    // 3. Fetch renewal history with transaction hashes
    const { data: renewalRecords, error: rhError } = await supabase
      .from('renewal_history')
      .select('id, subscription_id, transaction_hash, status')
      .not('transaction_hash', 'is', null)
      .gte('created_at', cutoff);

    if (rhError) {
      logger.error('Failed to fetch renewal history for reconciliation:', rhError);
      throw new Error(`Reconciliation failed: ${rhError.message}`);
    }

    // Build lookup: tx_hash → renewal_record
    const renewalByTxHash = new Map<string, any[]>();
    for (const record of renewalRecords || []) {
      if (record.transaction_hash) {
        const existing = renewalByTxHash.get(record.transaction_hash) || [];
        existing.push(record);
        renewalByTxHash.set(record.transaction_hash, existing);
      }
    }

    // 4. Match and detect mismatches
    const mismatches: ReconciliationMismatch[] = [];
    let matched = 0;
    const matchedTxHashes = new Set<string>();

    for (const event of contractEvents || []) {
      const subscriptionId = subMap.get(event.sub_id);

      const matchingRecords = event.tx_hash ? renewalByTxHash.get(event.tx_hash) : undefined;
      const matchingHistoryRecord = matchingRecords?.find(
        (r) => !subscriptionId || r.subscription_id === subscriptionId,
      );

      if (matchingHistoryRecord) {
        matched++;
        if (event.tx_hash) matchedTxHashes.add(event.tx_hash);
      } else if (subscriptionId) {
        // Contract event exists but no matching renewal_history
        mismatches.push({
          subscriptionId,
          blockchainSubId: event.sub_id,
          contractEventType: event.event_type,
          contractTxHash: event.tx_hash || '',
          contractLedger: event.ledger,
          contractProcessedAt: event.processed_at,
          renewalHistoryId: null,
          mismatchType: 'missing_from_history',
          notes: `Contract event ${event.event_type} for sub_id ${event.sub_id} has no matching renewal_history record`,
        });
      }
    }

    // 5. Find renewal records that have no matching contract event (orphans in reverse)
    const contractTxHashes = new Set((contractEvents || []).map((e) => e.tx_hash).filter(Boolean));
    for (const record of renewalRecords || []) {
      if (record.transaction_hash && !contractTxHashes.has(record.transaction_hash)) {
        const subscriptionId = record.subscription_id;
        mismatches.push({
          subscriptionId,
          blockchainSubId: 0,
          contractEventType: 'unknown',
          contractTxHash: record.transaction_hash,
          contractLedger: 0,
          contractProcessedAt: '',
          renewalHistoryId: record.id,
          mismatchType: 'orphan_event',
          notes: `Renewal history record ${record.id} has tx_hash ${record.transaction_hash} but no matching contract event`,
        });
      }
    }

    // 6. Auto-repair if requested
    let repaired = 0;
    if (autoRepair && mismatches.length > 0) {
      for (const mismatch of mismatches.slice(0, REPAIR_BATCH_SIZE)) {
        try {
          const repaired_ = await this.repairMismatch(mismatch);
          if (repaired_) repaired++;
        } catch (err) {
          logger.error(`Auto-repair failed for mismatch:`, { mismatch, err });
        }
      }
    }

    // 7. Emit a security event if mismatches were found
    if (mismatches.length > 0) {
      await emitSecurityEvent('auth.unauthorized_access', {
        severity: mismatches.length > 10 ? 'high' : 'medium',
        resourceType: 'blockchain',
        reason: `Blockchain reconciliation found ${mismatches.length} mismatches`,
        details: {
          runId,
          totalContractEvents: contractEvents?.length || 0,
          totalRenewalRecords: renewalRecords?.length || 0,
          matched,
          mismatches: mismatches.length,
          autoRepair: autoRepair ? `${repaired} repaired` : 'disabled',
        },
      });
    }

    const result: ReconciliationResult = {
      runId,
      startedAt,
      completedAt: new Date().toISOString(),
      totalContractEvents: contractEvents?.length || 0,
      totalRenewalRecords: renewalRecords?.length || 0,
      matched,
      mismatches,
      repaired,
    };

    logger.info(`Reconciliation ${runId} completed`, {
      total: result.totalContractEvents,
      matched: result.matched,
      mismatches: result.mismatches.length,
      repaired: result.repaired,
    });

    return result;
  }

  /**
   * Attempt to repair a single mismatch.
   *
   * For missing_from_history: the contract event already updated the
   * subscription state, so we just log it for review. In a full
   * production system this would create a repair ticket or call a
   * replay handler.
   *
   * For orphan_event: the renewal_history has a tx_hash that doesn't
   * match any contract event. This might mean the event was processed
   * before we started tracking, or the tx_hash is stale.
   */
  private async repairMismatch(mismatch: ReconciliationMismatch): Promise<boolean> {
    if (mismatch.mismatchType === 'missing_from_history' && mismatch.renewalHistoryId) {
      return false;
    }

    if (mismatch.mismatchType === 'orphan_event') {
      const { error } = await supabase
        .from('renewal_history')
        .update({ notes: `[reconciliation] Orphan event — no matching contract event found at ${new Date().toISOString()}` })
        .eq('id', mismatch.renewalHistoryId);

      if (error) {
        logger.error('Failed to annotate orphan renewal record:', error);
        return false;
      }
      return true;
    }
    return false;
  }
}

import crypto from 'crypto';

export const blockchainReconciliationService = new BlockchainReconciliationService();
