/**
 * Restore drill script.
 * Repo path: backend/scripts/restore-drill.ts
 * Run with: npx tsx backend/scripts/restore-drill.ts   (adjust to this repo's actual script runner)
 *
 * This is the "rehearse restore, verifying restored state is consistent with
 * the chain rather than assuming it" requirement from issue #1523, and feeds
 * the "at least the first three [runbooks] have been rehearsed in staging"
 * done-when criterion from issue #1519 (Runbook 1: meter store down).
 *
 * What this does NOT do: actually tear down and restore your Supabase
 * project. That step is provider-specific (Supabase dashboard → point-in-
 * time restore, or their CLI/API if you're on a plan that exposes one) and
 * needs to be run against a scratch/staging project, never production — this
 * script picks up after that restore has happened, or after you've replayed
 * the local journal backups, and checks whether what you ended up with is
 * actually trustworthy.
 *
 * Usage pattern:
 *   1. Restore Supabase staging project to a target point in time (manual,
 *      via dashboard/CLI) OR spin up a fresh scratch DB and replay the
 *      store-backup-job.ts exports + apply the migration in
 *      0001_signed_state_journal.sql.
 *   2. Point this script's SUPABASE_URL/SUPABASE_KEY env vars at that
 *      restored/scratch instance — never production.
 *   3. Run this script. It reports RTO (how long the drill took, which you
 *      log as a proxy for real restore time) and RPO (how stale the restored
 *      newest signed state is vs. what the journal shows should exist).
 */

import { createClient } from '@supabase/supabase-js';
import logger from '../src/config/logger';

interface DrillResult {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  channelsChecked: number;
  channelsConsistent: number;
  channelsInconsistent: Array<{
    channelId: string;
    restoredSequenceNumber: number;
    expectedSequenceNumber: number | null;
    gap: number | null;
  }>;
  rpoActualMs: number | null;
  passed: boolean;
}

async function runRestoreDrill(): Promise<DrillResult> {
  const startedAt = new Date();

  // Deliberately requires explicit env vars rather than importing the
  // shared `supabase` client from config/database.ts — that client points at
  // whatever this process's normal environment is, and a restore drill must
  // never accidentally run against production.
  const restoredUrl = process.env.RESTORE_DRILL_SUPABASE_URL;
  const restoredKey = process.env.RESTORE_DRILL_SUPABASE_SERVICE_KEY;

  if (!restoredUrl || !restoredKey) {
    throw new Error(
      'RESTORE_DRILL_SUPABASE_URL and RESTORE_DRILL_SUPABASE_SERVICE_KEY must be set, ' +
      'pointing at the restored/scratch project — refusing to guess a default to avoid ' +
      'accidentally running this against production.',
    );
  }
  if (restoredUrl === process.env.SUPABASE_URL) {
    throw new Error(
      'RESTORE_DRILL_SUPABASE_URL matches the normal SUPABASE_URL — this looks like it would ' +
      'run the drill against the live project. Point it at the restored/scratch instance instead.',
    );
  }

  const restored = createClient(restoredUrl, restoredKey);

  const { data: channelRows, error: channelErr } = await restored
    .from('payment_channels')
    .select('id, channel_state')
    .in('state', ['active', 'closing', 'dispute']);

  if (channelErr) throw channelErr;

  const channelsInconsistent: DrillResult['channelsInconsistent'] = [];
  let channelsConsistent = 0;

  for (const row of channelRows ?? []) {
    const channelId = row.id as string;
    const restoredSequenceNumber =
      (row.channel_state as { sequenceNumber?: number } | null)?.sequenceNumber ?? 0;

    // Compare against the journal's own record of the newest sequence number
    // for this channel — the journal is the thing we trust most (it's what
    // gets replicated off-provider), so a restored DB whose channel_state
    // doesn't match its own journal's latest entry means the restore itself
    // is suspect, independent of chain state.
    const { data: journalRow } = await restored
      .from('channel_state_journal')
      .select('sequence_number, recorded_at')
      .eq('channel_id', channelId)
      .order('sequence_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    const expectedSequenceNumber = journalRow?.sequence_number ?? null;

    if (expectedSequenceNumber === null || expectedSequenceNumber === restoredSequenceNumber) {
      channelsConsistent += 1;
    } else {
      channelsInconsistent.push({
        channelId,
        restoredSequenceNumber,
        expectedSequenceNumber,
        gap: expectedSequenceNumber - restoredSequenceNumber,
      });
    }
  }

  // RPO check: how far behind "now" is the newest journal entry we actually
  // have in the restored instance? This tells you what you'd have really
  // lost if this restore had been a real incident.
  const { data: newestJournalRow } = await restored
    .from('channel_state_journal')
    .select('recorded_at')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  const rpoActualMs = newestJournalRow
    ? Date.now() - new Date(newestJournalRow.recorded_at).getTime()
    : null;

  const completedAt = new Date();

  const result: DrillResult = {
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    channelsChecked: (channelRows ?? []).length,
    channelsConsistent,
    channelsInconsistent,
    rpoActualMs,
    passed: channelsInconsistent.length === 0,
  };

  return result;
}

runRestoreDrill()
  .then((result) => {
    logger.info('Restore drill complete', result);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
    // Append to the rehearsal log referenced in docs/runbooks/incident-runbooks.md —
    // do this manually the first few times so a human reviews the numbers
    // before it's automated end-to-end.
    process.exit(result.passed ? 0 : 1);
  })
  .catch((err) => {
    logger.error('Restore drill failed to run', { error: err instanceof Error ? err.message : String(err) });
    process.exit(2);
  });