import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../config/database';
import { ScopedRepository } from './scoped.repository';

abstract class AggregateRepository extends ScopedRepository {
  protected abstract readonly tableName: string;

  constructor(userId: string, client: SupabaseClient = supabase) {
    super(userId, client);
  }

  list(columns = '*') { return this.select(this.tableName, columns); }
  create(values: Record<string, unknown>) { return this.insert(this.tableName, values); }
  updateById(id: string, values: Record<string, unknown>) {
    return this.update(this.tableName, values).eq('id', id);
  }
  deleteById(id: string) { return this.delete(this.tableName).eq('id', id); }
}

export class SubscriptionRepository extends AggregateRepository {
  protected readonly tableName = 'subscriptions';
}
export class PaymentRepository extends AggregateRepository {
  protected readonly tableName = 'payments';
}
export class ReminderRepository extends AggregateRepository {
  protected readonly tableName = 'reminder_schedules';
}
export class TagRepository extends AggregateRepository {
  protected readonly tableName = 'subscription_tags';
}
export class AuditRepository extends AggregateRepository {
  protected readonly tableName = 'audit_logs';
}
export class SessionRepository extends AggregateRepository {
  protected readonly tableName = 'user_sessions';
}
