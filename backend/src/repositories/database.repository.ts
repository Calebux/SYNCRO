import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Infrastructure repository for system-wide tables that do not carry a user
 * scope. Domain code should prefer a scoped aggregate repository.
 */
export class DatabaseRepository {
  constructor(private readonly client: SupabaseClient) {}

  from(table: string): ReturnType<SupabaseClient['from']> {
    return this.client.from(table);
  }
}
