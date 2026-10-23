import { supabase } from '../config/database';
import logger from '../config/logger';
import type { DomainEvent } from '@syncro/shared/domain-events';

export class EventBus {
  async publish(event: DomainEvent): Promise<void> {
    const { error } = await supabase
      .from('domain_event_outbox')
      .insert({
        event_name: event.eventName,
        event_payload: event as Record<string, unknown>,
        event_id: event.eventId,
        user_id: event.userId,
        correlation_id: event.correlationId ?? null,
        status: 'pending',
        retry_count: 0,
        max_retries: 5,
        next_retry_at: new Date().toISOString(),
      });

    if (error) {
      logger.error('Failed to enqueue domain event', {
        eventName: event.eventName,
        eventId: event.eventId,
        error: error.message,
      });
      throw new Error(`Failed to enqueue domain event: ${error.message}`);
    }
  }
}

export const domainEventBus = new EventBus();
