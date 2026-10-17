/**
 * Durable local log of everything served while the counter store was down
 * (Issue #1444).
 *
 * The log is the reconciliation seam: every call admitted under a fail-open
 * policy is appended here before the gateway returns, so an operator can
 * replay the file after the outage and bill what the counter store never saw.
 *
 * The format mirrors `write-ahead-log.ts`: newline-delimited JSON, one record
 * per line, appended with a single `write(2)`. A torn last line from a crash
 * mid-append is skipped on read rather than failing the whole file.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * One call served while the counter store was unavailable.
 *
 * Everything needed to rebuild the missing counter entry is in the record:
 * who called, on which route, how much was served, and which receipt proves
 * the call completed.
 */
export interface DegradedUsageRecord {
  /** Stable id — the receipt id when one exists, so replay is idempotent. */
  id: string;
  /** Groups every record written during a single outage. */
  outageId: string;
  /** Provider whose policy admitted the call. */
  providerId: string;
  /** Principal (agent) the call was metered for. */
  principal: string;
  /** Route scope key the reservation was held against. */
  route: string;
  /** Reservation id the call was admitted under. */
  reservationId: string;
  /** Receipt issued for the call, when the call completed. */
  receiptId: string | null;
  /** Units served while degraded. */
  units: number;
  /** Value that would have been billed (`unit price x units`). */
  amount: number;
  /** ISO timestamp the call was metered at (meter clock, not client time). */
  meteredAt: string;
}

/**
 * Sink for degraded-mode usage. `append` must be durable before it returns:
 * a call served unbilled and not written here is unrecoverable revenue.
 */
export interface DegradedUsageStore {
  append(record: DegradedUsageRecord): void;
  read(): DegradedUsageRecord[];
}

/** In-memory store for tests and for dry runs where durability is irrelevant. */
export class InMemoryDegradedUsageLog implements DegradedUsageStore {
  private readonly records: DegradedUsageRecord[] = [];

  append(record: DegradedUsageRecord): void {
    this.records.push(record);
  }

  read(): DegradedUsageRecord[] {
    return [...this.records];
  }
}

/**
 * Durable JSONL log on local disk.
 *
 * Parent directory is created on construction, so wiring this at boot cannot
 * fail because `data/` does not exist yet.
 */
export class FileDegradedUsageLog implements DegradedUsageStore {
  constructor(private readonly path: string) {
    const dir = dirname(this.path);
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  append(record: DegradedUsageRecord): void {
    appendFileSync(this.path, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'a' });
  }

  read(): DegradedUsageRecord[] {
    if (!existsSync(this.path)) {
      return [];
    }
    const raw = readFileSync(this.path, 'utf8');
    const records: DegradedUsageRecord[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed) as DegradedUsageRecord);
      } catch {
        // Torn tail from a crash mid-append: stop at the first bad line.
        break;
      }
    }
    return records;
  }

  /** Path this log writes to. Surfaced by the console endpoint. */
  get filePath(): string {
    return this.path;
  }
}

/**
 * Collapse a raw log into one record per call id.
 *
 * Reconciliation replays are expected to be re-runnable: the same call may be
 * appended twice (crash between commit and acknowledgement, or a replayed
 * log), and billing it twice would be worse than billing it once.
 */
export function dedupeDegradedUsage(records: DegradedUsageRecord[]): DegradedUsageRecord[] {
  const seen = new Map<string, DegradedUsageRecord>();
  for (const record of records) {
    if (!seen.has(record.id)) {
      seen.set(record.id, record);
    }
  }
  return [...seen.values()];
}
