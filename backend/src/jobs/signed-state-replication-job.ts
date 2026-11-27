/**
 * Signed-state off-provider replication job.
 * Repo path: backend/src/jobs/signed-state-replication-job.ts
 *
 * Ships rows from channel_state_journal (see migration
 * 0001_signed_state_journal.sql) to a second, non-Supabase location as soon
 * as they land, then marks them replicated_at.
 *
 * This does NOT by itself give zero RPO — Supabase's own Point-in-Time
 * Recovery / WAL archiving is what protects you against most failure modes
 * (bad deploy, accidental delete, node failure) with true zero RPO, because
 * it's synchronous at the database layer. This job exists for the failure
 * modes PITR doesn't cover: the Supabase project itself becoming unavailable,
 * account-level issues, or wanting a copy you control outside the provider.
 * Run it on the tightest interval your job scheduler supports (the other
 * jobs in this directory look cron-scheduled — every 5-15s here, not the
 * daily/hourly cadence appropriate for the meter/indexer backup job).
 *
 * Wire this into whatever runs settlement-batch-job.ts / channel-settlement-job.ts
 * (cron, a queue worker, etc.) — this file only exports the run function.
 */

import { supabase } from '../config/database';
import logger from '../config/logger';
import { env } from '../config/env';

// ─── Sink abstraction ─────────────────────────────────────────────────────
// Swap LocalFileReplicationSink for your actual object-store client (S3,
// GCS, R2 — whatever this repo already uses elsewhere for file storage).
// Keeping this behind an interface means the job logic doesn't need to
// change when you plug in the real client.

export interface ReplicationSink {
  /** Write one journal batch. Key should be stable/idempotent — same batch
   *  retried after a crash must produce the same key, not a duplicate. */
  put(key: string, body: string): Promise<void>;
}

/**
 * Local-disk sink for staging rehearsals and for running this job before a
 * real off-provider target is wired up. NOT sufficient for production durability
 * on its own — a local disk on the same host as the app is not "a second
 * location." Replace with S3/GCS/R2 before relying on this for prod.
 */
export class LocalFileReplicationSink implements ReplicationSink {
  constructor(private readonly baseDir: string) {}

  async put(key: string, body: string): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const fullPath = path.join(this.baseDir, key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, body, 'utf-8');
  }
}

interface JournalRow {
  id: number;
  channel_id: string;
  user_id: string;
  sequence_number: number;
  channel_state: Record<string, unknown>;
  channel_row_state: string;
  recorded_at: string;
}

export interface ReplicationRunResult {
  shipped: number;
  batches: number;
  oldestUnshippedAgeMs: number | null;
  error?: string;
}

const BATCH_SIZE = Number(env.SIGNED_STATE_REPLICATION_BATCH_SIZE ?? 500);

export class SignedStateReplicationJob {
  constructor(private readonly sink: ReplicationSink) {}

  async run(): Promise<ReplicationRunResult> {
    try {
      const { data: rows, error } = await supabase
        .from('channel_state_journal')
        .select('id, channel_id, user_id, sequence_number, channel_state, channel_row_state, recorded_at')
        .is('replicated_at', null)
        .order('id', { ascending: true })
        .limit(BATCH_SIZE);

      if (error) throw error;

      const pending = (rows ?? []) as JournalRow[];
      if (pending.length === 0) {
        return { shipped: 0, batches: 0, oldestUnshippedAgeMs: null };
      }

      const oldestUnshippedAgeMs =
        Date.now() - new Date(pending[0]!.recorded_at).getTime();

      // Key includes the id range so retries after a crash overwrite the
      // same object instead of creating duplicates (idempotent put).
      const firstId = pending[0]!.id;
      const lastId = pending[pending.length - 1]!.id;
      const key = `signed-state-journal/${firstId}-${lastId}.json`;

      await this.sink.put(key, JSON.stringify(pending));

      const ids = pending.map((r) => r.id);
      const nowIso = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('channel_state_journal')
        .update({ replicated_at: nowIso })
        .in('id', ids);

      if (updateError) throw updateError;

      logger.info('Signed-state journal batch replicated', {
        shipped: pending.length,
        firstId,
        lastId,
        oldestUnshippedAgeMs,
      });

      return { shipped: pending.length, batches: 1, oldestUnshippedAgeMs };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Signed-state replication run failed', { error: message });
      return { shipped: 0, batches: 0, oldestUnshippedAgeMs: null, error: message };
    }
  }

  /**
   * Alerting hook: call this from your monitoring job. If the oldest
   * unreplicated row is older than the tolerated lag, that's your RPO
   * being violated in real time, not just at restore time.
   */
  async getReplicationLagMs(): Promise<number | null> {
    const { data, error } = await supabase
      .from('channel_state_journal')
      .select('recorded_at')
      .is('replicated_at', null)
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return Date.now() - new Date(data.recorded_at).getTime();
  }
}

// Default instance wired to local-disk sink — replace the sink argument
// with your real object-store client before deploying to production.
export const signedStateReplicationJob = new SignedStateReplicationJob(
  new LocalFileReplicationSink(env.SIGNED_STATE_REPLICATION_LOCAL_DIR ?? './signed-state-journal-backup'),
);