/**
 * blockchain/indexer.ts
 *
 * Reliable Soroban event indexer that:
 *  1. Polls the RPC for new ledgers on a configurable interval.
 *  2. Detects gaps (missed blocks) by comparing the stored cursor against
 *     the latest ledger and back-fills them in bounded batches.
 *  3. Persists every on-chain event to `blockchain_logs` so the table is
 *     never missing a transaction.
 *  4. Normalizes contract topics into a canonical dotted path so downstream
 *     consumers can rely on stable event names across contracts.
 *  5. Uses exponential back-off with jitter on transient RPC failures.
 */

import logger from '../config/logger';
import { supabase } from '../config/database';
import { env } from '../config/env';
import { RpcClient } from '@syncro/shared/rpc-client';
import {
  getBlockchainFlags,
  resolveStellarNetwork,
} from '../../../shared/blockchain-flags';

// ── Constants ─────────────────────────────────────────────────────────────────

const _flags = getBlockchainFlags();
const _network = resolveStellarNetwork();

// Resolve RPC URL — never silently fall back to testnet in production.
function resolveRpcUrl(): string {
  const configured = env.SOROBAN_RPC_URL;
  if (!configured && _flags.isProduction) {
    throw new Error(
      '[indexer] SOROBAN_RPC_URL must be explicitly set in production. ' +
        'Refusing to fall back to the testnet RPC endpoint.',
    );
  }
  if (configured) return configured;
  // Non-production: pick a sensible default per network
  if (_network === 'mainnet') return 'https://soroban-rpc.creit.tech';
  if (_network === 'futurenet') return 'https://rpc-futurenet.stellar.org';
  return 'https://soroban-testnet.stellar.org';
}

const RPC_URL = resolveRpcUrl();
const CONTRACT_ID = env.SOROBAN_CONTRACT_ADDRESS ?? '';
const POLL_INTERVAL_MS = parseInt(
  env.INDEXER_POLL_INTERVAL_MS,
  10,
);
const BATCH_SIZE = parseInt(env.INDEXER_BATCH_SIZE, 10);
const MAX_RETRIES = 5;
const BASE_RETRY_MS = 1000;

const rpcClient = new RpcClient({
  maxRetries: MAX_RETRIES,
  baseRetryDelayMs: BASE_RETRY_MS,
  timeoutMs: 15000,
  circuitBreakerThreshold: 5,
  circuitBreakerResetTimeoutMs: 30000,
});

// ── Types ─────────────────────────────────────────────────────────────────────

interface RawEvent {
  id: string;
  type: string;
  ledger: number;
  ledgerClosedAt: string;
  contractId: string;
  txHash: string;
  topic: string[];
  value: unknown;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeTopicPath(topics: string[]): string | null {
  const cleaned = topics
    .map((topic) => topic.trim().toLowerCase())
    .filter((topic) => topic.length > 0);

  return cleaned.length > 0 ? cleaned.join('.') : null;
}

function normalizeEventType(event: RawEvent): string {
  return normalizeTopicPath(event.topic) ?? event.type;
}

function extractSchemaVersion(value: unknown): number {
  const schemaVersion = (value as { schema_version?: unknown } | null)?.schema_version;
  return typeof schemaVersion === 'number' ? schemaVersion : 1;
}

async function rpcPost<T>(method: string, params: unknown): Promise<T> {
  try {
    const res = await rpcClient.fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const json: any = await res.json();
    if (json.error) throw new Error(json.error.message ?? JSON.stringify(json.error));
    return json.result as T;
  } catch (err) {
    logger.error('Indexer RPC call failed', {
      method,
      err: err instanceof Error ? err.message : String(err),
      metrics: rpcClient.getMetrics(),
    });
    throw err;
  }
}

async function getLatestLedger(): Promise<number> {
  const result = await rpcPost<{ sequence: number }>('getLatestLedger', {});
  return result.sequence;
}

async function fetchEvents(
  startLedger: number,
  endLedger: number,
): Promise<RawEvent[]> {
  const result = await rpcPost<{ events: RawEvent[] }>('getEvents', {
    startLedger,
    endLedger,
    filters: CONTRACT_ID ? [{ contractIds: [CONTRACT_ID] }] : [],
  });
  return result.events ?? [];
}

async function getCursor(): Promise<number> {
  const { data } = await supabase
    .from('event_cursor')
    .select('last_ledger')
    .eq('id', 1)
    .single();
  return data?.last_ledger ?? 0;
}

async function saveCursor(ledger: number): Promise<void> {
  await supabase
    .from('event_cursor')
    .upsert({ id: 1, last_ledger: ledger, updated_at: new Date().toISOString() });
}

async function persistEvents(events: RawEvent[]): Promise<void> {
  if (events.length === 0) return;

  const rows = events.map((e) => ({
    user_id: 'system',
    event_type: normalizeEventType(e),
    event_data: {
      id: e.id,
      ledger: e.ledger,
      ledgerClosedAt: e.ledgerClosedAt,
      contractId: e.contractId,
      txHash: e.txHash,
      topic: e.topic,
      topicPath: normalizeTopicPath(e.topic),
      eventType: e.type,
      schemaVersion: extractSchemaVersion(e.value),
      value: e.value,
    },
    transaction_hash: e.txHash,
    status: 'confirmed',
    created_at: e.ledgerClosedAt ?? new Date().toISOString(),
  }));

  // Upsert on transaction_hash to guarantee idempotency
  const { error } = await supabase
    .from('blockchain_logs')
    .upsert(rows, { onConflict: 'transaction_hash', ignoreDuplicates: true });

  if (error) {
    logger.error('Indexer: failed to persist events', { error, count: rows.length });
    throw error;
  }

  logger.info('Indexer: persisted events', { count: rows.length });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Core indexing loop ────────────────────────────────────────────────────────

async function indexRange(from: number, to: number): Promise<void> {
  let cursor = from;
  while (cursor <= to) {
    const batchEnd = Math.min(cursor + BATCH_SIZE - 1, to);
    logger.info('Indexer: fetching ledger range', { from: cursor, to: batchEnd });

    const events = await fetchEvents(cursor, batchEnd);
    await persistEvents(events);
    await saveCursor(batchEnd);

    cursor = batchEnd + 1;
  }
}

async function tick(): Promise<void> {
  const [cursor, latest] = await Promise.all([getCursor(), getLatestLedger()]);

  if (latest <= cursor) return; // nothing new

  const missed = latest - cursor;
  if (missed > BATCH_SIZE) {
    logger.warn('Indexer: gap detected — back-filling missed blocks', {
      from: cursor + 1,
      to: latest,
      missed,
    });
  }

  await indexRange(cursor + 1, latest);
}

// ── Public API ────────────────────────────────────────────────────────────────

let running = false;

export async function startIndexer(): Promise<void> {
  if (running) return;
  if (!CONTRACT_ID) {
    logger.warn('Indexer: SOROBAN_CONTRACT_ADDRESS not set — indexer disabled');
    return;
  }

  // Honour the ENABLE_BLOCKCHAIN master switch
  if (!_flags.blockchainEnabled) {
    logger.warn('Indexer: ENABLE_BLOCKCHAIN=false — indexer disabled');
    return;
  }

  running = true;
  logger.info('Indexer: started', { rpcUrl: RPC_URL, contractId: CONTRACT_ID, network: _network });

  while (running) {
    try {
      await tick();
    } catch (err) {
      logger.error('Indexer: tick failed', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

export function stopIndexer(): void {
  running = false;
  logger.info('Indexer: stopped');
}
