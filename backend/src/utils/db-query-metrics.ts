import { supabase } from '../config/database';

/**
 * Query-count instrumentation for the N+1 audit (issue #1095).
 *
 * The Supabase client does not expose a query counter, so we temporarily wrap
 * `supabase.from` and tally the table round-trips a code path performs. This is
 * used by the N+1 regression tests to assert that batched builders issue a
 * constant number of queries regardless of how many users they compose, and it
 * is also handy for ad-hoc profiling in development.
 */

export interface QueryMetrics {
  /** Total number of `supabase.from(...)` round-trips started. */
  total: number;
  /** Round-trips broken down by table name. */
  byTable: Record<string, number>;
}

/**
 * Run `fn`, counting the Supabase queries it issues.
 *
 * Measures one code path at a time — the wrapper is installed globally on the
 * shared client, so concurrent `measureQueries` calls would count each other's
 * queries.
 */
export async function measureQueries<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; metrics: QueryMetrics }> {
  const metrics: QueryMetrics = { total: 0, byTable: {} };
  const client = supabase as unknown as { from: (...args: any[]) => any };
  const original = client.from;

  client.from = (...args: any[]) => {
    const table = typeof args[0] === 'string' ? args[0] : 'unknown';
    metrics.total += 1;
    metrics.byTable[table] = (metrics.byTable[table] ?? 0) + 1;
    return original.apply(supabase, args);
  };

  try {
    const result = await fn();
    return { result, metrics };
  } finally {
    client.from = original;
  }
}

/** Group rows by a string key, preserving insertion order. */
export function groupBy<T>(rows: readonly T[], key: (row: T) => string | null | undefined): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (!k) continue;
    const bucket = groups.get(k);
    if (bucket) {
      bucket.push(row);
    } else {
      groups.set(k, [row]);
    }
  }
  return groups;
}

/** De-duplicate and drop empty ids from a list of user ids. */
export function uniqueIds(ids: readonly (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
}
