/**
 * In-memory Supabase/PostgREST fake for the usage-reconciliation tables.
 *
 * Real PostgREST semantics matter here, because the reconciliation guarantees
 * are enforced *by the database*, not by application code:
 *
 *  - `reservation_id` is unique on both ledger and degraded log, so replay is
 *    at-most-once.
 *  - `meter_idempotency_key` is unique, so a second attempt to apply usage to
 *    the meter collides instead of double-billing.
 *
 * A test double that skipped those constraints would pass while the real system
 * double-bills. So this fake implements them, including the `23505` unique
 * violation the production code checks for.
 */

export type FakeRow = Record<string, any>;

interface UniqueSpec {
  table: string;
  columns: string[];
}

let idCounter = 0;

/** Postgres unique_violation. */
function uniqueViolation(columns: string[]): { message: string; code: string } {
  return {
    message: `duplicate key value violates unique constraint "${columns.join('_uniq')}"`,
    code: '23505',
  };
}

class FakeQuery implements PromiseLike<{ data: any; error: any }> {
  private filters: Array<[string, string, any]> = [];
  private orderCol: string | null = null;
  private orderAsc = true;
  private limitN: number | null = null;
  private returning = false;

  constructor(
    private readonly store: FakeStore,
    private readonly table: string,
    private readonly op: 'select' | 'insert' | 'update' | 'delete',
    private readonly payload: FakeRow | null = null,
  ) {}

  select(_cols?: string) {
    this.returning = true;
    return this;
  }
  /**
   * PostgREST returns the matched *object* for `.maybeSingle()`, or null when
   * nothing matched (204 No Content). Handing back a one-element array instead
   * silently type-confuses every caller that maps the row.
   */
  maybeSingle() {
    const result = this.execute();
    if (result.error) return Promise.resolve(result);
    if (!Array.isArray(result.data)) return Promise.resolve(result);
    if (result.data.length === 0) return Promise.resolve({ data: null, error: null });
    return Promise.resolve({ data: result.data[0], error: null });
  }
  /** `.single()` must match exactly one row, as PostgREST enforces. */
  single() {
    const result = this.execute();
    if (result.error) return Promise.resolve(result);
    if (!Array.isArray(result.data) || result.data.length === 0) {
      return Promise.resolve({
        data: null,
        error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' },
      });
    }
    if (result.data.length > 1) {
      return Promise.resolve({
        data: null,
        error: { message: 'JSON object requested, multiple rows returned', code: 'PGRST116' },
      });
    }
    return Promise.resolve({ data: result.data[0], error: null });
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderCol = col;
    this.orderAsc = opts?.ascending ?? true;
    return this;
  }
  eq(col: string, val: any) {
    return this.push(col, 'eq', val);
  }
  neq(col: string, val: any) {
    return this.push(col, 'neq', val);
  }
  lt(col: string, val: any) {
    return this.push(col, 'lt', val);
  }
  lte(col: string, val: any) {
    return this.push(col, 'lte', val);
  }
  gt(col: string, val: any) {
    return this.push(col, 'gt', val);
  }
  gte(col: string, val: any) {
    return this.push(col, 'gte', val);
  }
  is(col: string, val: any) {
    return this.push(col, val === null ? 'isnull' : 'eq', val);
  }
  in(col: string, vals: any[]) {
    return this.push(col, 'in', vals);
  }
  not(col: string, op: string, val: any) {
    // Only the `not x is null` shape is used by the reconciliation code.
    if (op === 'is' && val === null) return this.push(col, 'notnull', null);
    throw new Error(`FakeQuery.not: unsupported shape ${col} ${op} ${val}`);
  }

  private push(col: string, op: string, val: any) {
    this.filters.push([col, op, val]);
    return this;
  }

  private matches(row: FakeRow): boolean {
    return this.filters.every(([col, op, val]) => {
      const actual = row[col];
      switch (op) {
        case 'eq':
          // Numeric columns may be seeded as strings while stored as numbers.
          if (val !== null && typeof val === 'number' && typeof actual === 'string') {
            return Number(actual) === val;
          }
          return actual === val;
        case 'neq':
          return actual !== val;
        case 'isnull':
          return actual === null || actual === undefined;
        case 'notnull':
          return actual !== null && actual !== undefined;
        case 'in':
          return val.includes(actual);
        // ISO-8601 timestamps sort correctly as strings, which is what Postgres
        // would do for timestamptz comparisons.
        case 'lt':
          return actual !== null && actual !== undefined && actual < val;
        case 'lte':
          return actual !== null && actual !== undefined && actual <= val;
        case 'gt':
          return actual !== null && actual !== undefined && actual > val;
        case 'gte':
          return actual !== null && actual !== undefined && actual >= val;
        default:
          throw new Error(`FakeQuery: unsupported operator ${op}`);
      }
    });
  }

  private found(): FakeRow[] {
    let rows = this.store.rows(this.table).filter((r) => this.matches(r));
    if (this.orderCol) {
      const col = this.orderCol;
      const dir = this.orderAsc ? 1 : -1;
      rows = [...rows].sort((a, b) => (a[col] > b[col] ? dir : a[col] < b[col] ? -dir : 0));
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    return rows;
  }

  /** Apply uniqueness rules; returns an error object on violation. */
  private checkUnique(row: FakeRow, ignoreId?: string) {
    for (const spec of this.store.uniques) {
      if (spec.table !== this.table) continue;
      for (const col of spec.columns) {
        const val = row[col];
        // Partial-unique semantics: a NULL never collides, as in Postgres.
        if (val === null || val === undefined) continue;
        const clash = this.store
          .rows(this.table)
          .find(
            (r) =>
              r[col] === val &&
              !(ignoreId !== undefined && r.id === ignoreId),
          );
        if (clash) return uniqueViolation(spec.columns);
      }
    }
    return null;
  }

  private execute(): { data: any; error: any } {
    switch (this.op) {
      case 'insert': {
        const row: FakeRow = { id: `uuid-${++idCounter}`, ...this.payload };
        const err = this.checkUnique(row);
        if (err) return { data: null, error: err };
        this.store.push(this.table, row);
        return { data: this.returning ? row : null, error: null };
      }
      case 'update': {
        const updated: FakeRow[] = [];
        for (const row of this.found()) {
          const next = { ...row, ...this.payload };
          const err = this.checkUnique(next, row.id);
          if (err) return { data: null, error: err };
          Object.assign(row, this.payload);
          updated.push(row);
        }
        return { data: this.returning ? updated : null, error: null };
      }
      case 'delete': {
        const doomed = this.found();
        this.store.remove(this.table, doomed);
        return { data: this.returning ? doomed : null, error: null };
      }
      default: {
        const rows = this.found();
        return { data: this.returning ? rows : rows, error: null };
      }
    }
  }

  private settle() {
    return Promise.resolve(this.execute());
  }

  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((v: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((r: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.settle().then(onfulfilled, onrejected);
  }
}

/** Mirrors the unique indexes in 20261005000000_usage_reconciliation.sql. */
const DEFAULT_UNIQUES: UniqueSpec[] = [
  { table: 'meter_usage_ledger', columns: ['reservation_id'] },
  { table: 'meter_usage_ledger', columns: ['meter_idempotency_key'] },
  { table: 'degraded_usage_log', columns: ['reservation_id'] },
  { table: 'usage_reconciliation_reports', columns: ['run_id'] },
];

export class FakeStore {
  readonly uniques: UniqueSpec[];
  private readonly data = new Map<string, FakeRow[]>();
  /** Optional fault injection: table name -> error to return once. */
  private readonly faults = new Map<string, { message: string }>();

  constructor(tables: string[], uniques: UniqueSpec[] = DEFAULT_UNIQUES) {
    for (const t of tables) this.data.set(t, []);
    this.uniques = uniques;
  }

  rows(table: string): FakeRow[] {
    return this.data.get(table) ?? [];
  }

  push(table: string, row: FakeRow) {
    this.data.get(table)!.push(row);
  }

  remove(table: string, doomed: FakeRow[]) {
    const live = this.data.get(table)!;
    for (const d of doomed) {
      const i = live.indexOf(d);
      if (i >= 0) live.splice(i, 1);
    }
  }

  seed(table: string, row: FakeRow) {
    this.push(table, { id: row.id ?? `uuid-${++idCounter}`, ...row });
  }

  /** Make the next query against `table` fail, mimicking a DB outage. */
  failNext(table: string, message = 'connection terminated') {
    this.faults.set(table, { message });
  }

  private takeFault(table: string) {
    const f = this.faults.get(table);
    if (f) {
      this.faults.delete(table);
      return f;
    }
    return null;
  }

  from(table: string) {
    const fault = this.takeFault(table);
    if (fault) {
      // Any chained call on a failing table yields an always-erroring builder,
      // the way a dead connection behaves. A Proxy keeps it chainable so a test
      // does not have to care which query was in flight when the store died.
      const fail = () => Promise.resolve({ data: null, error: fault });
      const builder: any = new Proxy(
        {},
        {
          get: (_t, prop) => {
            if (prop === 'then') return (res: any) => fail().then(res);
            return () => builder;
          },
        },
      );
      return builder;
    }
    return {
      select: () => new FakeQuery(this, table, 'select'),
      insert: (payload: FakeRow) => new FakeQuery(this, table, 'insert', payload),
      update: (payload: FakeRow) => new FakeQuery(this, table, 'update', payload),
      delete: () => new FakeQuery(this, table, 'delete'),
    };
  }

  /** The object shape expected by `jest.mock('../src/config/database')`. */
  get client() {
    return { from: (t: string) => this.from(t) };
  }
}

/** Tables touched by the reconciliation subsystem. */
export const USAGE_TABLES = [
  'meter_usage_ledger',
  'degraded_usage_log',
  'usage_reconciliation_reports',
  'pending_settlements',
];

export function createFakeStore(): FakeStore {
  return new FakeStore(USAGE_TABLES);
}
