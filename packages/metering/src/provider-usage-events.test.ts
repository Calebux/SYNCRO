import { describe, expect, it, vi } from 'vitest';
import {
  KafkaUsageEventSink,
  NatsUsageEventSink,
  UsageEventDispatcher,
  type ProviderUsageEvent,
  type UsageEventOutbox,
} from './provider-usage-events';

const event: ProviderUsageEvent = {
  id: 'evt-1', schemaVersion: '1.0.0', type: 'usage.committed',
  occurredAt: '2026-11-23T00:00:00.000Z', agentId: 'agent-1', route: 'llm:call',
  unitName: 'token', units: '12', amount: '24',
};

function outbox(events: ProviderUsageEvent[] = [event]) {
  return {
    claim: vi.fn(async () => events),
    acknowledge: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
  } satisfies UsageEventOutbox;
}

describe('UsageEventDispatcher', () => {
  it('acknowledges only after the sink accepts the stable event id', async () => {
    const store = outbox();
    const publish = vi.fn(async () => undefined);
    const dispatcher = new UsageEventDispatcher({ outbox: store, sink: { publish } });

    await expect(dispatcher.dispatch()).resolves.toEqual({ delivered: 1, failed: false });
    expect(publish).toHaveBeenCalledWith([event]);
    expect(store.acknowledge).toHaveBeenCalledWith(['evt-1']);
    expect(store.retry).not.toHaveBeenCalled();
  });

  it('retains failed batches for at-least-once retry', async () => {
    const store = outbox();
    const dispatcher = new UsageEventDispatcher({
      outbox: store,
      sink: { publish: async () => { throw new Error('sink down'); } },
    });

    await expect(dispatcher.dispatch()).resolves.toEqual({ delivered: 0, failed: true });
    expect(store.retry).toHaveBeenCalledWith(['evt-1'], 'sink down');
    expect(store.acknowledge).not.toHaveBeenCalled();
  });

  it('validates the bounded batch size', () => {
    expect(() => new UsageEventDispatcher({ outbox: outbox(), sink: { publish: async () => undefined }, batchSize: 0 }))
      .toThrow('batchSize must be an integer between 1 and 1000');
  });

  it('uses stable event IDs as broker deduplication keys', async () => {
    const natsPublish = vi.fn();
    const kafkaSend = vi.fn(async () => undefined);
    await new NatsUsageEventSink({ publish: natsPublish }, 'usage.events').publish([event]);
    await new KafkaUsageEventSink({ send: kafkaSend }, 'usage.events').publish([event]);
    expect(natsPublish).toHaveBeenCalledWith('usage.events', expect.any(Uint8Array));
    expect(kafkaSend).toHaveBeenCalledWith({
      topic: 'usage.events', messages: [{ key: 'evt-1', value: JSON.stringify(event) }],
    });
  });
});
