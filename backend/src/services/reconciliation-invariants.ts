/**
 * backend/src/services/reconciliation-invariants.ts
 *
 * Place at: backend/src/services/reconciliation-invariants.ts (new file)
 *
 * Implements the three invariants from issue #1278 as executable checks,
 * classifies every discrepancy it finds, and applies the automated
 * resolution where it's safe to do so (queues the rest for manual review).
 *
 * ── ASSUMPTIONS (adjust the four lines below to match your real code) ──
 * This file expects three things to already exist in the repo. Wire the
 * imports to whatever your actual exports are named:
 *
 *   1. A Supabase (or Postgres) client, e.g. `backend/src/lib/supabase.ts`
 *      exporting `supabase`.
 *   2. From blockchain-reconciliation-service.ts: a function that returns
 *      confirmed on-chain renewal events for a block/time range, and one
 *      that reads a contract/escrow balance. Named below as
 *      `getConfirmedOnChainRenewals` and `getOnChainBalance` — rename the
 *      imports to your real exports.
 *   3. From reorg-handler.ts: a way to know whether a given block height
 *      is still canonical (not reorged out) and what the current "safe"
 *      (finalized) height is. Named below as `isBlockCanonical` and
 *      `getSafeBlockHeight`.
 *
 * If your actual service files export different names, this file is the
 * ONLY place you need to edit — everything downstream (job, alerts,
 * routes) consumes `runInvariantChecks` and doesn't care about the chain
 * client internals.
 */

import { supabase } from '../lib/supabase'; // ADJUST: your Supabase client export
import {
  getConfirmedOnChainRenewals, // ADJUST: rename to your real export
  getOnChainBalance,           // ADJUST: rename to your real export
} from './blockchain-reconciliation-service';
import {
  isBlockCanonical,   // ADJUST: rename to your real export
  getSafeBlockHeight, // ADJUST: rename to your real export
} from './reorg-handler';
import {
  DiscrepancyRecord,
  DiscrepancyType,
  InvariantType,
  ReconciliationRunResult,
  ResolutionAction,
} from '../types/reconciliation';

/** How many confirmations before we stop calling a tx "pending". */
const CONFIRMATION_THRESHOLD_BLOCKS = 3;

/** Balance tolerance, in the contract's smallest unit (e.g. stroops). */
const BALANCE_TOLERANCE = BigInt(process.env.RECON_BALANCE_TOLERANCE ?? '10000');

// ---------------------------------------------------------------------------
// Backend renewal record shape — ADJUST field names to your actual schema.
// ---------------------------------------------------------------------------
interface BackendRenewalRecord {
  id: string;
  subscription_id: string;
  status: 'pending' | 'confirmed' | 'failed';
  tx_hash: string | null;
  block_height: number | null;
  amount: string; // stored as text/numeric to avoid float precision loss
  contract_id: string;
  created_at: string;
}

interface OnChainRenewalEvent {
  txHash: string;
  blockHeight: number;
  contractId: string;
  subscriptionId: string;
  amount: string;
  ledgerCloseTime: string; // ISO timestamp of the block
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

async function fetchBackendRenewals(windowStart: Date, windowEnd: Date): Promise<BackendRenewalRecord[]> {
  const { data, error } = await supabase
    .from('subscription_renewals') // ADJUST: your renewals table name
    .select('id, subscription_id, status, tx_hash, block_height, amount, contract_id, created_at')
    .gte('created_at', windowStart.toISOString())
    .lte('created_at', windowEnd.toISOString());

  if (error) {
    throw new Error(`[reconciliation] failed to fetch backend renewals: ${error.message}`);
  }
  return data ?? [];
}

async function fetchAllBackendRenewalsUnbounded(): Promise<BackendRenewalRecord[]> {
  // Full sweep — no time bound, paginate if your table is large.
  const { data, error } = await supabase
    .from('subscription_renewals')
    .select('id, subscription_id, status, tx_hash, block_height, amount, contract_id, created_at');

  if (error) {
    throw new Error(`[reconciliation] failed to fetch full renewal set: ${error.message}`);
  }
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Invariant 1: every backend renewal record has a confirmed on-chain tx
// ---------------------------------------------------------------------------
async function checkBackendHasChainConfirmation(
  records: BackendRenewalRecord[],
  safeHeight: number,
): Promise<DiscrepancyRecord[]> {
  const discrepancies: DiscrepancyRecord[] = [];

  for (const record of records) {
    if (record.status !== 'confirmed') continue; // only confirmed records assert this invariant

    if (!record.tx_hash) {
      discrepancies.push(makeDiscrepancy({
        invariant: InvariantType.BACKEND_HAS_CHAIN_CONFIRMATION,
        discrepancyType: DiscrepancyType.MISSING_ONCHAIN_TX,
        severity: 'critical',
        renewalRecordId: record.id,
        contractId: record.contract_id,
        backendAmount: record.amount,
        details: { reason: 'backend marked confirmed with no tx_hash recorded' },
        resolutionAction: ResolutionAction.MANUAL_REVIEW_REQUIRED,
      }));
      continue;
    }

    const onChainEvent = await findOnChainEventByTxHash(record.tx_hash);

    if (!onChainEvent) {
      discrepancies.push(makeDiscrepancy({
        invariant: InvariantType.BACKEND_HAS_CHAIN_CONFIRMATION,
        discrepancyType: DiscrepancyType.MISSING_ONCHAIN_TX,
        severity: 'critical',
        renewalRecordId: record.id,
        txHash: record.tx_hash,
        contractId: record.contract_id,
        backendAmount: record.amount,
        details: { reason: 'no on-chain event found for recorded tx_hash' },
        resolutionAction: ResolutionAction.MANUAL_REVIEW_REQUIRED,
      }));
      continue;
    }

    // Reorg check: was the block this tx was recorded in re-orged out?
    if (record.block_height && !(await isBlockCanonical(record.block_height))) {
      discrepancies.push(makeDiscrepancy({
        invariant: InvariantType.BACKEND_HAS_CHAIN_CONFIRMATION,
        discrepancyType: DiscrepancyType.REORGED_OUT,
        severity: 'high',
        renewalRecordId: record.id,
        txHash: record.tx_hash,
        contractId: record.contract_id,
        details: { recordedBlockHeight: record.block_height },
        resolutionAction: ResolutionAction.AUTO_REPLAY_FROM_CANONICAL,
      }));
      continue;
    }

    // Confirmation depth check.
    const confirmations = safeHeight - onChainEvent.blockHeight;
    if (confirmations < CONFIRMATION_THRESHOLD_BLOCKS) {
      discrepancies.push(makeDiscrepancy({
        invariant: InvariantType.BACKEND_HAS_CHAIN_CONFIRMATION,
        discrepancyType: DiscrepancyType.UNCONFIRMED_ONCHAIN_TX,
        severity: 'low',
        renewalRecordId: record.id,
        txHash: record.tx_hash,
        contractId: record.contract_id,
        details: { confirmations, required: CONFIRMATION_THRESHOLD_BLOCKS },
        resolutionAction: ResolutionAction.AUTO_WAIT_FOR_CONFIRMATION,
      }));
      continue;
    }

    // Amount check.
    if (onChainEvent.amount !== record.amount) {
      discrepancies.push(makeDiscrepancy({
        invariant: InvariantType.BACKEND_HAS_CHAIN_CONFIRMATION,
        discrepancyType: DiscrepancyType.AMOUNT_MISMATCH,
        severity: 'critical',
        renewalRecordId: record.id,
        txHash: record.tx_hash,
        contractId: record.contract_id,
        backendAmount: record.amount,
        onChainAmount: onChainEvent.amount,
        details: {},
        resolutionAction: ResolutionAction.MANUAL_REVIEW_REQUIRED,
      }));
    }
  }

  return discrepancies;
}

// ---------------------------------------------------------------------------
// Invariant 2: every on-chain renewal event has a backend record
// ---------------------------------------------------------------------------
async function checkChainHasBackendRecord(
  onChainEvents: OnChainRenewalEvent[],
  backendRecordsByTx: Map<string, BackendRenewalRecord>,
): Promise<DiscrepancyRecord[]> {
  const discrepancies: DiscrepancyRecord[] = [];

  for (const event of onChainEvents) {
    const match = backendRecordsByTx.get(event.txHash);
    if (!match) {
      discrepancies.push(makeDiscrepancy({
        invariant: InvariantType.CHAIN_HAS_BACKEND_RECORD,
        discrepancyType: DiscrepancyType.MISSING_BACKEND_RECORD,
        severity: 'high',
        txHash: event.txHash,
        contractId: event.contractId,
        onChainAmount: event.amount,
        details: { subscriptionId: event.subscriptionId, blockHeight: event.blockHeight },
        resolutionAction: ResolutionAction.AUTO_REINDEX,
      }));
    }
  }

  return discrepancies;
}

// ---------------------------------------------------------------------------
// Invariant 3: balances agree within tolerance
// ---------------------------------------------------------------------------
async function checkBalanceWithinTolerance(contractIds: string[]): Promise<DiscrepancyRecord[]> {
  const discrepancies: DiscrepancyRecord[] = [];

  for (const contractId of contractIds) {
    const onChainBalance = BigInt(await getOnChainBalance(contractId));
    const ledgerBalance = BigInt(await getBackendLedgerBalance(contractId));
    const delta = onChainBalance > ledgerBalance
      ? onChainBalance - ledgerBalance
      : ledgerBalance - onChainBalance;

    if (delta > BALANCE_TOLERANCE) {
      discrepancies.push(makeDiscrepancy({
        invariant: InvariantType.BALANCE_WITHIN_TOLERANCE,
        discrepancyType: DiscrepancyType.BALANCE_MISMATCH,
        severity: delta > BALANCE_TOLERANCE * BigInt(10) ? 'critical' : 'medium',
        contractId,
        onChainAmount: onChainBalance.toString(),
        backendAmount: ledgerBalance.toString(),
        details: { deltaAbs: delta.toString(), tolerance: BALANCE_TOLERANCE.toString() },
        resolutionAction: ResolutionAction.MANUAL_REVIEW_REQUIRED,
      }));
    }
  }

  return discrepancies;
}

async function getBackendLedgerBalance(contractId: string): Promise<string> {
  // ADJUST: replace with your real ledger-balance aggregation query.
  const { data, error } = await supabase.rpc('sum_ledger_balance_for_contract', { contract_id: contractId });
  if (error) throw new Error(`[reconciliation] ledger balance query failed: ${error.message}`);
  return String(data ?? '0');
}

async function findOnChainEventByTxHash(txHash: string): Promise<OnChainRenewalEvent | null> {
  const events = await getConfirmedOnChainRenewals({ txHash });
  return events[0] ?? null;
}

function makeDiscrepancy(
  input: Omit<DiscrepancyRecord, 'detectedAt' | 'resolutionStatus'>,
): DiscrepancyRecord {
  return {
    ...input,
    detectedAt: new Date().toISOString(),
    resolutionStatus: 'pending',
  };
}

// ---------------------------------------------------------------------------
// Automated resolution — only for actions marked safe in the registry.
// Anything MANUAL_REVIEW_REQUIRED is written but never auto-mutated.
// ---------------------------------------------------------------------------
export async function applyAutomatedResolution(discrepancy: DiscrepancyRecord): Promise<DiscrepancyRecord> {
  switch (discrepancy.resolutionAction) {
    case ResolutionAction.AUTO_WAIT_FOR_CONFIRMATION:
      // No-op: the next run will re-check and either resolve or escalate.
      return { ...discrepancy, resolutionStatus: 'pending' };

    case ResolutionAction.AUTO_REINDEX:
      if (discrepancy.txHash) {
        await triggerReindex(discrepancy.txHash);
      }
      return { ...discrepancy, resolutionStatus: 'auto_resolved', resolvedAt: new Date().toISOString() };

    case ResolutionAction.AUTO_REPLAY_FROM_CANONICAL:
      if (discrepancy.renewalRecordId) {
        await replayRecordFromCanonicalChain(discrepancy.renewalRecordId);
      }
      return { ...discrepancy, resolutionStatus: 'auto_resolved', resolvedAt: new Date().toISOString() };

    case ResolutionAction.AUTO_MARK_FAILED:
      if (discrepancy.renewalRecordId) {
        await supabase
          .from('subscription_renewals')
          .update({ status: 'failed' })
          .eq('id', discrepancy.renewalRecordId);
      }
      return { ...discrepancy, resolutionStatus: 'auto_resolved', resolvedAt: new Date().toISOString() };

    case ResolutionAction.MANUAL_REVIEW_REQUIRED:
    default:
      return { ...discrepancy, resolutionStatus: 'unresolved' };
  }
}

async function triggerReindex(txHash: string): Promise<void> {
  // ADJUST: call your indexer's targeted re-ingest for a single tx/block range.
  // Example: await indexer.reindexTransaction(txHash);
  console.warn(`[reconciliation] AUTO_REINDEX stub — wire up indexer.reindexTransaction("${txHash}")`);
}

async function replayRecordFromCanonicalChain(renewalRecordId: string): Promise<void> {
  // ADJUST: re-derive the record from the canonical chain after a reorg.
  // Typically: mark old record superseded, re-run ingestion for that subscription.
  console.warn(`[reconciliation] AUTO_REPLAY_FROM_CANONICAL stub for record ${renewalRecordId}`);
}

// ---------------------------------------------------------------------------
// Public entry points consumed by the scheduler
// ---------------------------------------------------------------------------

export async function runInvariantChecks(mode: 'sliding_window' | 'full_sweep', windowMinutes = 60): Promise<ReconciliationRunResult> {
  const runId = crypto.randomUUID();
  const startedAt = new Date();

  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - windowMinutes * 60_000);

  const backendRecords = mode === 'full_sweep'
    ? await fetchAllBackendRenewalsUnbounded()
    : await fetchBackendRenewals(windowStart, windowEnd);

  const safeHeight = await getSafeBlockHeight();

  const onChainEvents = await getConfirmedOnChainRenewals(
    mode === 'full_sweep' ? {} : { since: windowStart.toISOString() },
  );

  const backendRecordsByTx = new Map(
    backendRecords.filter((r) => r.tx_hash).map((r) => [r.tx_hash as string, r]),
  );

  const contractIds = [...new Set(backendRecords.map((r) => r.contract_id))];

  const [invariant1, invariant2, invariant3] = await Promise.all([
    checkBackendHasChainConfirmation(backendRecords, safeHeight),
    checkChainHasBackendRecord(onChainEvents, backendRecordsByTx),
    checkBalanceWithinTolerance(contractIds),
  ]);

  const rawDiscrepancies = [...invariant1, ...invariant2, ...invariant3];

  const resolved = await Promise.all(rawDiscrepancies.map(applyAutomatedResolution));

  await persistDiscrepancies(resolved);

  const finishedAt = new Date();
  const latestChainEventTime = onChainEvents.length
    ? Math.max(...onChainEvents.map((e) => new Date(e.ledgerCloseTime).getTime()))
    : finishedAt.getTime();

  const result: ReconciliationRunResult = {
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    mode,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    recordsChecked: backendRecords.length,
    discrepanciesFound: resolved,
    reconciliationLagMs: finishedAt.getTime() - latestChainEventTime,
  };

  await persistRunResult(result);

  return result;
}

async function persistDiscrepancies(discrepancies: DiscrepancyRecord[]): Promise<void> {
  if (discrepancies.length === 0) return;
  const { error } = await supabase.from('reconciliation_discrepancies').insert(
    discrepancies.map((d) => ({
      detected_at: d.detectedAt,
      invariant: d.invariant,
      discrepancy_type: d.discrepancyType,
      severity: d.severity,
      renewal_record_id: d.renewalRecordId ?? null,
      tx_hash: d.txHash ?? null,
      contract_id: d.contractId ?? null,
      backend_amount: d.backendAmount ?? null,
      on_chain_amount: d.onChainAmount ?? null,
      details: d.details,
      resolution_action: d.resolutionAction,
      resolution_status: d.resolutionStatus,
      resolved_at: d.resolvedAt ?? null,
      resolution_notes: d.resolutionNotes ?? null,
    })),
  );
  if (error) {
    console.error(`[reconciliation] failed to persist discrepancies: ${error.message}`);
  }
}

async function persistRunResult(result: ReconciliationRunResult): Promise<void> {
  const { error } = await supabase.from('reconciliation_runs').insert({
    id: result.runId,
    started_at: result.startedAt,
    finished_at: result.finishedAt,
    mode: result.mode,
    window_start: result.windowStart ?? null,
    window_end: result.windowEnd ?? null,
    records_checked: result.recordsChecked,
    discrepancies_found: result.discrepanciesFound.length,
    reconciliation_lag_ms: result.reconciliationLagMs,
  });
  if (error) {
    console.error(`[reconciliation] failed to persist run result: ${error.message}`);
  }
}