import type { SupabaseClient } from '@supabase/supabase-js';

type Row = Record<string, unknown>;

/** Base for user-owned aggregates. There is deliberately no unscoped form. */
export abstract class ScopedRepository {
  protected constructor(
    protected readonly userId: string,
    protected readonly client: SupabaseClient,
  ) {
    if (!userId.trim()) throw new Error('A user scope is required');
  }

  protected select(table: string, columns = '*') {
    return this.client.from(table).select(columns).eq('user_id', this.userId);
  }

  protected insert(table: string, values: Row | Row[]) {
    const scoped = (Array.isArray(values) ? values : [values]).map(value => ({
      ...value,
      user_id: this.userId,
    }));
    return this.client.from(table).insert(Array.isArray(values) ? scoped : scoped[0]);
  }

  protected update(table: string, values: Row) {
    const { user_id: _ignored, ...safeValues } = values;
    return this.client.from(table).update(safeValues).eq('user_id', this.userId);
  }

  protected delete(table: string) {
    return this.client.from(table).delete().eq('user_id', this.userId);
  }
}
