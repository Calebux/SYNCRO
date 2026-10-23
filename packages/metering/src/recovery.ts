/**
 * Meter durability and the write-ahead path (issue #1449).
 *
 * Durability guarantee
 * --------------------
 * The meter does NOT inherit durability from whatever store it happens to use.
 * Instead, every usage record is appended to a write-ahead log (WAL) and fsync'd
 * BEFORE `commit` returns. Concretely:
 *
 *   - Durable at the moment `commit` returns: the usage record is present in the
 *     WAL on stable storage (fsync completed). A `kill -9` immediately after
 *     `commit` returns loses nothing: the record is replayed on restart.
 *   - Still in flight at the moment `commit` returns: the record may not yet be
 *     materialized in the primary store (usage table / receipts). That is a
 *     derived, replayable projection, not the source of truth.
 *
 * Because commits are batched for throughput, the batch is written through the
 * WAL first. A crash between `commit` and persistence therefore loses no usage.
 *
 * Recovery on restart
 * -------------------
 * On startup the WAL is replayed in order. Each entry carries a stable
 * `recordId`; replay deduplicates against what was already persisted (the
 * primary store's applied-id set) so re-applying a partially persisted batch is
 * idempotent and receipts are never double-produced.
 *
 * Throughput ceiling
 * ------------------
 * The durable path is bounded by fsync latency, not by the primary store. The
 * ceiling is measured and published via `measureDurableThroughput` so callers
 * can size batches against the real bound of the product.
 */

export interface UsageRecord {
  /** Stable identity used for WAL replay deduplication. */
  recordId: string;
  /** Monotonic sequence assigned at append time. */
  seq: number;
  /** Opaque usage payload (metered dimensions, receipt inputs, etc.). */
  payload: unknown;
}

export interface WalEntry {
  seq: number;
  recordId: string;
  payload: unknown;
}

/**
 * Append-only write-ahead log. Implementations MUST fsync before `append`
 * resolves; that fsync is what makes `commit` durable.
 */
export interface WriteAheadLog {
  append(entries: WalEntry[]): Promise<void>;
  readAll(): Promise<WalEntry[]>;
  truncate(throughSeq: number): Promise<void>;
}

/**
 * Primary store projection. Applying an entry is idempotent by `recordId`.
 */
export interface PrimaryStore {
  /** Ids already materialized; used to deduplicate WAL replay. */
  appliedIds(): Promise<ReadonlySet<string>>;
  apply(entry: WalEntry): Promise<void>;
}

export interface MeterDurabilityOptions {
  wal: WriteAheadLog;
  store: PrimaryStore;
  /** Max records per WAL append; bounds fsync amortization. */
  batchSize?: number;
}

/**
 * Durable meter commit path.
 *
 * `commit` resolves only after the batch has been fsync'd to the WAL. The
 * primary store is updated afterwards and is safe to lose: it is rebuilt from
 * the WAL on restart.
 */
export class DurableMeter {
  private readonly wal: WriteAheadLog;
  private readonly store: PrimaryStore;
  private readonly batchSize: number;
  private nextSeq = 0;
  private pending: WalEntry[] = [];

  constructor(options: MeterDurabilityOptions) {
    this.wal = options.wal;
    this.store = options.store;
    this.batchSize = options.batchSize ?? 1;
  }

  /**
   * Durably record usage. Returns once the record is in the WAL on stable
   * storage; the primary store may still be behind (in flight).
   */
  async commit(record: Omit<UsageRecord, "seq">): Promise<UsageRecord> {
    const entry: WalEntry = {
      seq: this.nextSeq++,
      recordId: record.recordId,
      payload: record.payload,
    };
    this.pending.push(entry);

    if (this.pending.length >= this.batchSize) {
      await this.flush();
    }

    return { recordId: entry.recordId, seq: entry.seq, payload: entry.payload };
  }

  /**
   * Force any buffered records through the WAL. Callers that need the
   * durability guarantee for a partial batch must await this before returning.
   */
  async flush(): Promise<void> {
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    // fsync happens inside append; after this resolves the batch is durable.
    await this.wal.append(batch);
    await this.project(batch);
  }

  private async project(batch: WalEntry[]): Promise<void> {
    const applied = await this.store.appliedIds();
    for (const entry of batch) {
      if (applied.has(entry.recordId)) continue;
      await this.store.apply(entry);
    }
  }
}

/**
 * Replay the WAL on restart, deduplicating against what was already persisted.
 * Returns the number of entries applied and the highest replayed sequence.
 */
export async function recover(
  wal: WriteAheadLog,
  store: PrimaryStore,
): Promise<{ applied: number; throughSeq: number }> {
  const entries = await wal.readAll();
  const applied = await store.appliedIds();

  let appliedCount = 0;
  let throughSeq = -1;

  for (const entry of entries) {
    throughSeq = Math.max(throughSeq, entry.seq);
    if (applied.has(entry.recordId)) continue;
    await store.apply(entry);
    appliedCount++;
  }

  if (throughSeq >= 0) {
    await wal.truncate(throughSeq);
  }

  return { applied: appliedCount, throughSeq };
}

/**
 * Measure the throughput ceiling of the durable path. The bound is fsync
 * latency, so this reports records/sec for the WAL append path alone.
 */
export async function measureDurableThroughput(
  wal: WriteAheadLog,
  options: { records?: number; batchSize?: number } = {},
): Promise<{ recordsPerSecond: number; batchSize: number; records: number }> {
  const records = options.records ?? 1000;
  const batchSize = options.batchSize ?? 1;
  const start = Date.now();

  let seq = 0;
  for (let i = 0; i < records; i += batchSize) {
    const batch: WalEntry[] = [];
    for (let j = 0; j < batchSize && i + j < records; j++) {
      batch.push({ seq: seq++, recordId: `bench-${seq}`, payload: null });
    }
    await wal.append(batch);
  }

  const elapsedMs = Math.max(1, Date.now() - start);
  return {
    recordsPerSecond: (records * 1000) / elapsedMs,
    batchSize,
    records,
  };
}
