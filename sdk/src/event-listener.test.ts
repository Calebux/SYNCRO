import { describe, it, expect, jest } from '@jest/globals';
import {
  createEventListener,
  getEventSchemaVersion,
  isSupportedEventSchemaVersion,
  CURRENT_EVENT_SCHEMA_VERSION,
} from './event-listener.js';

describe('SDK Event Listener schema versioning', () => {
  it('defaults missing schema_version to the current version', () => {
    const event = {
      type: 'RenewalSuccess',
      ledger: 1,
      txHash: 'tx-1',
      contractId: 'cid',
      topics: [],
      value: { sub_id: 1 },
    } as any;

    expect(getEventSchemaVersion(event)).toBe(CURRENT_EVENT_SCHEMA_VERSION);
    expect(isSupportedEventSchemaVersion(event)).toBe(true);
  });

  it('rejects unsupported contract event schema versions during parsing', async () => {
    const onEvent = jest.fn();
    const onError = jest.fn();

    let fetchCall = 0;
    (global as any).fetch = jest.fn(async () => {
      fetchCall += 1;

      if (fetchCall === 1) {
        return {
          json: async () => ({ result: { sequence: 5 } }),
        };
      }

      return {
        json: async () => ({
          result: {
            events: [
              {
                type: 'RenewalSuccess',
                ledger: 2,
                txHash: 'tx-1',
                contractId: 'cid',
                topics: [],
                value: { sub_id: 1, schema_version: 2 },
              },
            ],
          },
        }),
      };
    });

    const listener = createEventListener(
      {
        rpcUrl: 'http://localhost:8000',
        contractIds: ['cid'],
        pollIntervalMs: 20,
      },
      onEvent,
      onError,
    );

    await new Promise((resolve) => setTimeout(resolve, 120));
    listener.stop();

    expect(onEvent).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
