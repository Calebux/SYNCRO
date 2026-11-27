import { createHash } from 'crypto';

/**
 * Hash-chain primitives for the tamper-evident audit log (issue #1081).
 *
 * Every `audit_logs` row carries the hash of its own contents plus the hash of
 * the row before it. Editing a row in place changes its `entry_hash`; changing
 * the stored hash to match breaks the `prev_hash` link held by every later row.
 * Deleting a row leaves a gap in the sequence and an unresolvable link. So any
 * silent edit is detectable by re-walking the chain.
 *
 * The functions here are pure so they can be unit-tested and so verification
 * recomputes hashes exactly the way insertion did.
 */

/** The fields covered by an entry's hash. */
export interface ChainedFields {
  sequence:      number;
  userId:        string | null;
  action:        string;
  resourceType:  string;
  resourceId:    string | null;
  metadata:      unknown;
  ipAddress:     string | null;
  userAgent:     string | null;
  /** ISO-8601 timestamp; canonicalized to epoch milliseconds before hashing. */
  createdAt:     string;
  /** Hash of the preceding entry, or null for the first entry in the chain. */
  prevHash:      string | null;
}

/** The genesis entry's `prev_hash`. */
export const GENESIS_PREV_HASH = null;

/**
 * Serialize a value deterministically: object keys sorted, so that a JSONB
 * round-trip (which does not preserve key order) still hashes identically.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value ?? null;
  if (Array.isArray(value)) return value.map(canonicalize);

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * Timestamps are canonicalized to epoch milliseconds so that the hash does not
 * depend on how Postgres formats a `timestamptz` on the way back out
 * (`2026-07-25T10:00:00+00:00` vs the `...Z` form we sent).
 */
function canonicalTimestamp(iso: string): number | null {
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Lowercase so a UUID's casing cannot change the hash across a round-trip. */
function canonicalId(id: string | null | undefined): string | null {
  return id ? id.toLowerCase() : null;
}

/**
 * Build the exact string that gets hashed. Exported for debugging a mismatch.
 */
export function canonicalPayload(fields: ChainedFields): string {
  return JSON.stringify([
    fields.sequence,
    canonicalId(fields.userId),
    fields.action,
    fields.resourceType,
    fields.resourceId ?? null,
    canonicalize(fields.metadata ?? null),
    fields.ipAddress ?? null,
    fields.userAgent ?? null,
    canonicalTimestamp(fields.createdAt),
    fields.prevHash ?? null,
  ]);
}

/** SHA-256 of an entry's canonical payload, as lowercase hex. */
export function computeEntryHash(fields: ChainedFields): string {
  return createHash('sha256').update(canonicalPayload(fields), 'utf8').digest('hex');
}

/** A stored `audit_logs` row, as returned by PostgREST. */
export interface AuditLogRow {
  id?:            string;
  sequence?:      number | null;
  user_id?:       string | null;
  action?:        string;
  resource_type?: string;
  resource_id?:   string | null;
  metadata?:      unknown;
  ip_address?:    string | null;
  user_agent?:    string | null;
  created_at?:    string;
  entry_hash?:    string | null;
  prev_hash?:     string | null;
}

/** Recompute the hash a stored row should have. */
export function hashForRow(row: AuditLogRow): string {
  return computeEntryHash({
    sequence:     Number(row.sequence ?? 0),
    userId:       row.user_id ?? null,
    action:       row.action ?? '',
    resourceType: row.resource_type ?? '',
    resourceId:   row.resource_id ?? null,
    metadata:     row.metadata ?? null,
    ipAddress:    row.ip_address ?? null,
    userAgent:    row.user_agent ?? null,
    createdAt:    row.created_at ?? '',
    prevHash:     row.prev_hash ?? null,
  });
}

export type ChainIssueType =
  /** The row's contents no longer hash to its stored `entry_hash` — it was edited. */
  | 'hash_mismatch'
  /** The row's `prev_hash` does not match the previous row's `entry_hash`. */
  | 'broken_link'
  /** A sequence number is missing — a row was deleted. */
  | 'missing_entry'
  /** The row carries no chain fields at all (predates the hash chain). */
  | 'unchained';

export interface ChainIssue {
  type:      ChainIssueType;
  sequence:  number | null;
  entryId?:  string;
  expected?: string | null;
  actual?:   string | null;
  message:   string;
}

export interface ChainVerificationResult {
  valid:            boolean;
  entriesChecked:   number;
  firstSequence:    number | null;
  lastSequence:     number | null;
  /** Rows written before the hash chain existed; reported, but not failures. */
  legacyEntries:    number;
  issues:           ChainIssue[];
}

/**
 * Walk a contiguous, ascending-by-sequence run of rows and report any tampering.
 *
 * `expectedPrevHash` is the `entry_hash` of the row immediately before the run
 * (for a partial range), or `undefined` to accept whatever the first row links
 * to — useful when verifying a window that does not start at the genesis entry.
 */
export function verifyChainRows(
  rows: readonly AuditLogRow[],
  expectedPrevHash?: string | null,
): ChainVerificationResult {
  const issues: ChainIssue[] = [];
  let legacyEntries = 0;
  let checked = 0;
  let previous: AuditLogRow | null = null;
  let firstSequence: number | null = null;
  let lastSequence: number | null = null;

  for (const row of rows) {
    const sequence = row.sequence == null ? null : Number(row.sequence);

    // Rows written before the chain existed carry no hash; note and skip them.
    if (!row.entry_hash || sequence == null) {
      legacyEntries += 1;
      issues.push({
        type: 'unchained',
        sequence,
        entryId: row.id,
        message: 'Entry predates the hash chain and cannot be verified',
      });
      continue;
    }

    if (firstSequence === null) firstSequence = sequence;

    // A gap in the sequence means at least one row was removed.
    if (lastSequence !== null && sequence !== lastSequence + 1) {
      issues.push({
        type: 'missing_entry',
        sequence,
        entryId: row.id,
        expected: String(lastSequence + 1),
        actual: String(sequence),
        message: `Sequence gap: expected ${lastSequence + 1}, found ${sequence}`,
      });
    }

    // The row's contents must still hash to its stored entry_hash.
    const recomputed = hashForRow(row);
    if (recomputed !== row.entry_hash) {
      issues.push({
        type: 'hash_mismatch',
        sequence,
        entryId: row.id,
        expected: recomputed,
        actual: row.entry_hash,
        message: `Entry ${sequence} has been modified since it was written`,
      });
    }

    // The row must link to the entry_hash of the row before it.
    const linkTarget = previous ? previous.entry_hash ?? null : expectedPrevHash;
    if (linkTarget !== undefined && (row.prev_hash ?? null) !== (linkTarget ?? null)) {
      issues.push({
        type: 'broken_link',
        sequence,
        entryId: row.id,
        expected: linkTarget ?? null,
        actual: row.prev_hash ?? null,
        message: `Entry ${sequence} does not link to the preceding entry`,
      });
    }

    previous = row;
    lastSequence = sequence;
    checked += 1;
  }

  return {
    valid: issues.every((issue) => issue.type === 'unchained'),
    entriesChecked: checked,
    firstSequence,
    lastSequence,
    legacyEntries,
    issues,
  };
}
