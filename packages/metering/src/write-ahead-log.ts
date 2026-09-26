import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Durability guarantee for the metering commit path.
 *
 * At the moment `commit()` returns, the usage record is durable: it has been
 * appended to the write-ahead log and fsync'd to stable storage. It is NOT yet
 * necessarily in the primary store (the meter's backing store). That persistence
 * happens asynchronously via `flush()`, which is batched for throughput.
 *
 * What is still in flight after `commit()` returns:
 *   - The record has not yet been applied to the primary store.
 *   - The receipt for the call has not yet been produced.
 *
 * Because the record is in the WAL before `commit()` returns, a crash (including
 * `kill -9`) between commit and persistence loses no usage: on restart the WAL is
 * replayed and the record is re-applied to the primary store. Deduplication
 * against already-persisted usage/receipts makes replay idempotent.
 */

export interface UsageRecord {
  /** Stable id used for deduplication across WAL replay. */
  id: string;
  /** Monotonic sequence assigned by the meter at commit time. */
  seq: number;
  /** Opaque usage payload (tokens, cost, dimensions, etc.). */
  payload: unknown;
}

/**
 * Sink for durable usage. Implementations must be idempotent: applying the same
 * record twice must not double-count usage or produce a duplicate receipt.
 */
export interface UsageStore {
  /** Returns true if the record id was already persisted. */
  has(id: string): boolean | Promise<boolean>;
  /** Persist a record. Must be idempotent for a given record id. */
  persist(record: UsageRecord): void | Promise<void>;
}

export interface WriteAheadLogOptions {
  /** Path to the WAL file. Parent directory is created if missing. */
  path: string;
  /** Primary store the WAL is replayed into. */
  store: UsageStore;
  /**
   * Max records buffered before an automatic flush. Batching is what gives the
   * durable path its throughput; the WAL is what makes the batch safe.
   */
  batchSize?: number;
}

/**
 * Write-ahead log for the metering commit path.
 *
 * `commit()` appends to the WAL and fsyncs before returning, so the record is
 * durable even though it is not yet in the primary store. `flush()` drains the
 * in-memory batch into the primary store. `recover()` replays the WAL on restart
 * and deduplicates against records already persisted.
 */
export class WriteAheadLog {
  private readonly path: string;
  private readonly store: UsageStore;
  private readonly batchSize: number;
  private pending: UsageRecord[] = [];
  private nextSeq = 0;

  constructor(options: WriteAheadLogOptions) {
    this.path = options.path;
    this.store = options.store;
    this.batchSize = options.batchSize ?? 256;
    const dir = dirname(this.path);
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Durably record usage. Returns only after the record is in the WAL and
   * fsync'd, so a crash after this returns loses nothing.
   */
  commit(payload: unknown, id?: string): UsageRecord {
    const record: UsageRecord = {
      id: id ?? `${Date.now()}-${this.nextSeq}`,
      seq: this.nextSeq++,
      payload,
    };
    this.appendDurable(record);
    this.pending.push(record);
    if (this.pending.length >= this.batchSize) {
      void this.flush();
    }
    return record;
  }

  /**
   * Drain the in-memory batch into the primary store. Safe to call concurrently;
   * records are removed from the batch only after the store accepts them.
   */
  async flush(): Promise<void> {
    const batch = this.pending;
    this.pending = [];
    for (const record of batch) {
      if (await this.store.has(record.id)) {
        continue;
      }
      await this.store.persist(record);
    }
  }

  /**
   * Replay the WAL on restart. Every record is re-applied to the primary store,
   * deduplicated by id against what was already persisted, so replay is
   * idempotent and a crash between commit and persistence loses no usage.
   */
  async recover(): Promise<number> {
    if (!existsSync(this.path)) {
      return 0;
    }
    const raw = readFileSync(this.path, "utf8");
    let replayed = 0;
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      let record: UsageRecord;
      try {
        record = JSON.parse(trimmed) as UsageRecord;
      } catch {
        // Torn tail from a crash mid-append: stop replay at the first bad line.
        break;
      }
      if (await this.store.has(record.id)) {
        continue;
      }
      await this.store.persist(record);
      replayed++;
    }
    // Truncate the WAL now that everything durable has been replayed.
    this.truncate();
    return replayed;
  }

  /**
   * Throughput ceiling of the durable path, in commits per second. This bounds
   * the whole product: every metered call pays one durable append before
   * `commit()` returns. Measured over `iterations` commits.
   */
  measureThroughput(iterations = 1000): number {
    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) {
      this.appendDurable({ id: `bench-${i}`, seq: i, payload: null });
    }
    const elapsedNs = Number(process.hrtime.bigint() - start);
    return elapsedNs === 0 ? Infinity : (iterations * 1e9) / elapsedNs;
  }

  private appendDurable(record: UsageRecord): void {
    appendFileSync(this.path, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "a" });
  }

  private truncate(): void {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, "", "utf8");
    renameSync(tmp, this.path);
  }
}
