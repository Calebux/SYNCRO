import { supabase } from '../config/database';
import logger from '../config/logger';
import type { DomainEvent } from '@syncro/shared/domain-events';

const POLL_INTERVAL_MS = 2_000;
const BATCH_SIZE = 50;

type SubscriberHandler = (event: DomainEvent) => Promise<void> | void;

interface EventSubscriber {
  eventName: string;
  handler: SubscriberHandler;
}

class OutboxPublisher {
  private subscribers: Map<string, SubscriberHandler> = new Map();
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  register(eventName: string, handler: SubscriberHandler): () => void {
    this.subscribers.set(eventName, handler);
    return () => {
      this.subscribers.delete(eventName);
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => {
      this.processBatch().catch((err) => {
        logger.error('Outbox publisher batch processing error:', err);
      });
    }, POLL_INTERVAL_MS);
    logger.info('Outbox publisher started');
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('Outbox publisher stopped');
  }

  async processBatch(): Promise<void> {
    const now = new Date().toISOString();
    const { data: rows, error: fetchError } = await supabase
      .from('domain_event_outbox')
      .select('*')
      .in('status', ['pending', 'retrying'])
      .lte('next_retry_at', now)
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchError) {
      logger.error('Failed to fetch outbox events:', fetchError);
      return;
    }

    if (!rows || rows.length === 0) return;

    for (const row of rows) {
      await this.dispatchRow(row);
    }
  }

  private async dispatchRow(row: Record<string, unknown>): Promise<void> {
    const event = row.event_payload as DomainEvent;
    const handler = this.subscribers.get(event.eventName);

    if (!handler) {
      await this.markFailed(row.id as string, `No subscriber registered for ${event.eventName}`);
      return;
    }

    try {
      await handler(event);
      await supabase
        .from('domain_event_outbox')
        .update({
          status: 'published',
          published_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const retryCount = (row.retry_count as number) + 1;
      const maxRetries = (row.max_retries as number) ?? 5;

      if (retryCount >= maxRetries) {
        await this.moveToDeadLetter(row, errorMessage);
      } else {
        const backoffMs = this.computeBackoffMs(retryCount);
        const nextRetryAt = new Date(Date.now() + backoffMs).toISOString();
        await supabase
          .from('domain_event_outbox')
          .update({
            status: 'retrying',
            retry_count: retryCount,
            next_retry_at: nextRetryAt,
            last_error: errorMessage,
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);
      }

      logger.error('Outbox subscriber failed', {
        eventName: event.eventName,
        eventId: event.eventId,
        retryCount,
        error: errorMessage,
      });
    }
  }

  private async moveToDeadLetter(row: Record<string, unknown>, errorMessage: string): Promise<void> {
    const event = row.event_payload as DomainEvent;

    await supabase.from('domain_event_dead_letter').insert({
      event_name: event.eventName,
      event_payload: event as Record<string, unknown>,
      event_id: event.eventId,
      user_id: event.userId,
      correlation_id: event.correlationId ?? null,
      retry_count: (row.retry_count as number) + 1,
      last_error: errorMessage,
      failed_at: new Date().toISOString(),
    });

    await supabase
      .from('domain_event_outbox')
      .delete()
      .eq('id', row.id);

    logger.warn('Domain event moved to dead letter', {
      eventName: event.eventName,
      eventId: event.eventId,
      error: errorMessage,
    });
  }

  private async markFailed(outboxId: string, reason: string): Promise<void> {
    await supabase
      .from('domain_event_outbox')
      .update({
        status: 'failed',
        last_error: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', outboxId);
  }

  private computeBackoffMs(retryCount: number): number {
    const base = 1000;
    const max = 300_000;
    const exp = Math.min(retryCount, 10);
    return Math.min(base * Math.pow(2, exp), max);
  }
}

export const outboxPublisher = new OutboxPublisher();
