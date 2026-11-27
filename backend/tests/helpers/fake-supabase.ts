/**
 * A small in-memory stand-in for the Supabase client, covering the query shapes
 * the webhook ingestion pipeline uses (issue #1283).
 *
 * Written as a working fake rather than a chain of jest mocks so the tests
 * exercise real behaviour — in particular the UNIQUE (provider, event_id)
 * constraint, which *is* the deduplication mechanism. A mock that always
 * returns "inserted" could not tell a working dedup from a broken one.
 */

export interface PostgrestError {
  message: string;
  code?: string;
}

export interface FakeResult<T = unknown> {
  data: T | null;
  error: PostgrestError | null;
}

interface Filter {
  column: string;
  op: 'eq' | 'in';
  value: unknown;
}

/** Composite uniqueness enforced per table, mirroring the real constraints. */
const UNIQUE_KEYS: Record<string, string[]> = {
  webhook_events: ['provider', 'event_id'],
};

type Row = Record<string, unknown>;

export class FakeSupabase {
  readonly tables: Record<string, Row[]> = {
    webhook_events: [],
    webhook_rejections: [],
    webhook_replays: [],
  };

  /** Table names whose next insert should fail, simulating an outage. */
  failInsertFor = new Set<string>();
  /** When set, inserts throw instead of returning an error. */
  throwInsertFor = new Set<string>();

  private idCounter = 0;

  nextId(): string {
    this.idCounter += 1;
    return `row-${this.idCounter}`;
  }

  from(table: string): FakeQuery {
    this.tables[table] ??= [];
    return new FakeQuery(this, table);
  }

  /** Convenience for assertions. */
  rows(table: string): Row[] {
    return this.tables[table] ?? [];
  }

  reset(): void {
    for (const key of Object.keys(this.tables)) this.tables[key] = [];
    this.failInsertFor.clear();
    this.throwInsertFor.clear();
    this.idCounter = 0;
  }
}

class FakeQuery implements PromiseLike<FakeResult<Row[]>> {
  private filters: Filter[] = [];
  private pendingInsert: Row | null = null;
  private pendingUpdate: Row | null = null;
  private limitValue: number | null = null;
  private orFilter: string | null = null;

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string,
  ) {}

  // ── Builder surface ────────────────────────────────────────────────────────

  select(_columns?: string): this {
    return this;
  }

  insert(row: Row): this {
    this.pendingInsert = row;
    return this;
  }

  update(row: Row): this {
    this.pendingUpdate = row;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ column, op: 'eq', value });
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push({ column, op: 'in', value: values });
    return this;
  }

  or(expression: string): this {
    this.orFilter = expression;
    return this;
  }

  order(_column: string, _options?: unknown): this {
    return this;
  }

  limit(count: number): this {
    this.limitValue = count;
    return this;
  }

  // ── Execution ──────────────────────────────────────────────────────────────

  private matches(row: Row): boolean {
    return this.filters.every((filter) =>
      filter.op === 'eq'
        ? row[filter.column] === filter.value
        : Array.isArray(filter.value) && filter.value.includes(row[filter.column]),
    );
  }

  private runInsert(): FakeResult<Row> {
    const row = this.pendingInsert as Row;

    if (this.db.throwInsertFor.has(this.table)) {
      throw new Error(`simulated ${this.table} outage`);
    }
    if (this.db.failInsertFor.has(this.table)) {
      return { data: null, error: { message: `simulated ${this.table} failure` } };
    }

    const uniqueKey = UNIQUE_KEYS[this.table];
    if (uniqueKey) {
      const clash = this.db
        .rows(this.table)
        .some((existing) => uniqueKey.every((column) => existing[column] === row[column]));
      if (clash) {
        return {
          data: null,
          error: { message: 'duplicate key value violates unique constraint', code: '23505' },
        };
      }
    }

    const stored: Row = { id: this.db.nextId(), ...row };
    this.db.rows(this.table).push(stored);
    return { data: stored, error: null };
  }

  private runUpdate(): FakeResult<Row[]> {
    const updated: Row[] = [];
    for (const row of this.db.rows(this.table)) {
      if (this.matches(row)) {
        Object.assign(row, this.pendingUpdate);
        updated.push(row);
      }
    }
    return { data: updated, error: null };
  }

  private runSelect(): Row[] {
    let rows = this.db.rows(this.table).filter((row) => this.matches(row));

    // The sweeper's `.or('next_attempt_at.is.null,next_attempt_at.lte.<now>')`.
    if (this.orFilter?.startsWith('next_attempt_at')) {
      const dueBefore = this.orFilter.split('next_attempt_at.lte.')[1];
      rows = rows.filter((row) => {
        const next = row.next_attempt_at as string | null | undefined;
        return !next || (dueBefore !== undefined && next <= dueBefore);
      });
    }

    if (this.limitValue !== null) rows = rows.slice(0, this.limitValue);
    return rows;
  }

  async single(): Promise<FakeResult<Row>> {
    if (this.pendingInsert) return this.runInsert();

    const rows = this.runSelect();
    if (rows.length !== 1) {
      return { data: null, error: { message: 'no rows found', code: 'PGRST116' } };
    }
    return { data: rows[0], error: null };
  }

  async maybeSingle(): Promise<FakeResult<Row>> {
    if (this.pendingInsert) return this.runInsert();

    const rows = this.runSelect();
    return { data: rows[0] ?? null, error: null };
  }

  then<TResult1 = FakeResult<Row[]>, TResult2 = never>(
    onfulfilled?: ((value: FakeResult<Row[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    let result: FakeResult<Row[]>;
    try {
      if (this.pendingInsert) {
        const inserted = this.runInsert();
        result = {
          data: inserted.data ? [inserted.data] : null,
          error: inserted.error,
        };
      } else if (this.pendingUpdate) {
        result = this.runUpdate();
      } else {
        result = { data: this.runSelect(), error: null };
      }
    } catch (err) {
      return Promise.reject(err).then(onfulfilled as never, onrejected as never);
    }
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}
