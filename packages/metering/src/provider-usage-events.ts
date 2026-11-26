/** Versioned, PII-free usage events intended for provider analytics sinks. */
export const PROVIDER_USAGE_EVENT_SCHEMA_VERSION = '1.0.0' as const;

export interface ProviderUsageEvent {
  id: string;
  schemaVersion: typeof PROVIDER_USAGE_EVENT_SCHEMA_VERSION;
  type: 'usage.committed';
  occurredAt: string;
  agentId: string;
  route: string;
  unitName: string;
  units: string | null;
  amount: string;
}

export interface UsageEventOutbox {
  claim(limit: number): Promise<ProviderUsageEvent[]>;
  acknowledge(eventIds: string[]): Promise<void>;
  retry(eventIds: string[], error: string): Promise<void>;
}

export interface UsageEventSink {
  publish(events: ProviderUsageEvent[]): Promise<void>;
}

export interface UsageEventDispatcherOptions {
  outbox: UsageEventOutbox;
  sink: UsageEventSink;
  batchSize?: number;
}

/**
 * Delivers committed usage at least once. The outbox retains rows until the
 * sink accepts a batch; sinks must deduplicate on event id.
 */
export class UsageEventDispatcher {
  private readonly batchSize: number;

  constructor(private readonly options: UsageEventDispatcherOptions) {
    this.batchSize = options.batchSize ?? 100;
    if (!Number.isInteger(this.batchSize) || this.batchSize < 1 || this.batchSize > 1000) {
      throw new RangeError('batchSize must be an integer between 1 and 1000');
    }
  }

  async dispatch(): Promise<{ delivered: number; failed: boolean }> {
    const events = await this.options.outbox.claim(this.batchSize);
    if (events.length === 0) return { delivered: 0, failed: false };
    try {
      await this.options.sink.publish(events);
      await this.options.outbox.acknowledge(events.map((event) => event.id));
      return { delivered: events.length, failed: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.options.outbox.retry(events.map((event) => event.id), message.slice(0, 1000));
      return { delivered: 0, failed: true };
    }
  }
}

/** Webhook batch sink; the complete batch is retried when any HTTP error occurs. */
export class WebhookUsageEventSink implements UsageEventSink {
  constructor(
    private readonly endpoint: string,
    private readonly secret: string,
    private readonly timeoutMs = 10_000,
  ) {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
      throw new Error('usage webhook endpoint must use HTTPS');
    }
    if (!secret) throw new Error('usage webhook secret is required');
  }

  async publish(events: ProviderUsageEvent[]): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-syncro-usage-signature': await signUsageBatch(this.secret, events),
        },
        body: JSON.stringify({ schemaVersion: PROVIDER_USAGE_EVENT_SCHEMA_VERSION, events }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`usage webhook returned HTTP ${response.status}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Structural NATS adapter; avoids forcing a specific client library on hosts. */
export class NatsUsageEventSink implements UsageEventSink {
  constructor(private readonly client: { publish(subject: string, data: Uint8Array): unknown }, private readonly subject: string) {}
  async publish(events: ProviderUsageEvent[]): Promise<void> {
    const payload = new TextEncoder().encode(JSON.stringify({ schemaVersion: PROVIDER_USAGE_EVENT_SCHEMA_VERSION, events }));
    await this.client.publish(this.subject, payload);
  }
}

/** Structural Kafka adapter; producers must use event.id as their idempotency key. */
export class KafkaUsageEventSink implements UsageEventSink {
  constructor(private readonly producer: { send(record: { topic: string; messages: Array<{ key: string; value: string }> }): Promise<unknown> }, private readonly topic: string) {}
  async publish(events: ProviderUsageEvent[]): Promise<void> {
    await this.producer.send({
      topic: this.topic,
      messages: events.map((event) => ({ key: event.id, value: JSON.stringify(event) })),
    });
  }
}

async function signUsageBatch(secret: string, events: ProviderUsageEvent[]): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(JSON.stringify(events)));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
