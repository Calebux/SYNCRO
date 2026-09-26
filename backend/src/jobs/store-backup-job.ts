/**
 * Meter store + indexer-adjacent backup job.
 * Repo path: backend/src/jobs/store-backup-job.ts
 *
 * Unlike the signed-state journal (near-real-time, per issue #1523's
 * requirement that it never be "backed up on a schedule that can lose the
 * newest state"), the meter store (channel_payments, meter_reserves) and the
 * indexer-adjacent view (pending_settlements submitted rows / contract_events
 * once that table exists) are lower-criticality per the issue's own ranking:
 * losing a few minutes to hours of usage/indexer data is recoverable by
 * re-deriving from chain or from the signed-state journal; losing the newest
 * signed state is not. A scheduled export is the right tool here.
 *
 * Wire this on a schedule (hourly is a reasonable starting point — tune
 * after you've picked an RPO in the ops doc) the same way channel-settlement-job.ts
 * or settlement-batch-job.ts are wired.
 */

import { supabase } from '../config/database';
import logger from '../config/logger';
import { env } from '../config/env';
import type { ReplicationSink } from './signed-state-replication-job';
import { LocalFileReplicationSink } from './signed-state-replication-job';

type BackupTable = 'channel_payments' | 'meter_reserves' | 'pending_settlements' | 'contract_events';

const TABLES_TO_BACK_UP: BackupTable[] = [
  'channel_payments',
  'meter_reserves',
  'pending_settlements',
  // contract_events referenced in settlement-reconciliation-service.ts as the
  // eventual indexer source of truth — include it here once that table
  // exists; harmless (empty export) if it doesn't yet.
  'contract_events',
];

const PAGE_SIZE = 1000;
const RETENTION_DAYS = Number(env.STORE_BACKUP_RETENTION_DAYS ?? 30);

export interface StoreBackupResult {
  table: BackupTable;
  rowsExported: number;
  key?: string;
  error?: string;
}

export class StoreBackupJob {
  constructor(private readonly sink: ReplicationSink) {}

  async run(): Promise<StoreBackupResult[]> {
    const results: StoreBackupResult[] = [];
    const runTimestamp = new Date().toISOString().replace(/[:.]/g, '-');

    for (const table of TABLES_TO_BACK_UP) {
      results.push(await this.backUpTable(table, runTimestamp));
    }

    const failed = results.filter((r) => r.error);
    if (failed.length > 0) {
      logger.error('Store backup job had failures', { failed });
    } else {
      logger.info('Store backup job completed', {
        tables: results.map((r) => ({ table: r.table, rows: r.rowsExported })),
      });
    }

    return results;
  }

  private async backUpTable(table: BackupTable, runTimestamp: string): Promise<StoreBackupResult> {
    try {
      const rows: Record<string, unknown>[] = [];
      let from = 0;

      // Page through the whole table rather than a single unbounded select —
      // these tables grow, and an unbounded query is itself an availability risk.
      for (;;) {
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .range(from, from + PAGE_SIZE - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;

        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      const key = `store-backups/${table}/${runTimestamp}.json`;
      await this.sink.put(key, JSON.stringify(rows));

      return { table, rowsExported: rows.length, key };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { table, rowsExported: 0, error: message };
    }
  }

  /**
   * Retention enforcement is intentionally left as a TODO against your real
   * object-store client (list + delete older than RETENTION_DAYS) — the
   * local-disk sink used for staging doesn't need it and a stub here would
   * just be guessed API calls against a store this repo doesn't have wired
   * up yet. RETENTION_DAYS is exposed so the policy is at least decided and
   * visible even before the enforcement code exists.
   */
  getRetentionDays(): number {
    return RETENTION_DAYS;
  }
}

export const storeBackupJob = new StoreBackupJob(
  new LocalFileReplicationSink(env.STORE_BACKUP_LOCAL_DIR ?? './store-backups'),
);