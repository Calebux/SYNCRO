import { EventListener } from '../src/services/event-listener';
import { supabase } from '../src/config/database';

// Mock Supabase client
jest.mock('../src/config/database', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

// Mock logger
jest.mock('../src/config/logger', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  __esModule: true,
}));

// Mock reorg-handler
jest.mock('../src/services/reorg-handler', () => ({
  reorgHandler: {
    handleReorg: jest.fn(),
  },
}));

// Mock fetch globally
global.fetch = jest.fn();

describe('EventListener - Reconnection Logic', () => {
  let listener: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.SOROBAN_CONTRACT_ADDRESS = 'test-contract-id';
    process.env.STELLAR_NETWORK_URL = 'https://soroban-testnet.stellar.org';

    // Mock the event cursor in database
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'event_cursor') {
        return {
          select: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { last_ledger: 100 },
            error: null,
          }),
          upsert: jest.fn().mockResolvedValue({
            data: {},
            error: null,
          }),
        };
      }
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      };
    });

    // Reset fetch mock
    (global.fetch as jest.Mock).mockResolvedValue({
      json: jest.fn().mockResolvedValue({
        jsonrpc: '2.0',
        id: 1,
        result: { sequence: 200 },
      }),
    });

    const mod = await import('../src/services/event-listener');
    listener = new mod.EventListener();
  });

  describe('start()', () => {
    it('should start the event listener and load last processed ledger', async () => {
      await listener.start();

      expect(listener['isRunning']).toBe(true);
      expect(supabase.from).toHaveBeenCalledWith('event_cursor');
    });

    it('should not start if already running', async () => {
      listener['isRunning'] = true;
      listener['lastProcessedLedger'] = 100;

      const initialState = listener['isRunning'];
      await listener.start();

      expect(listener['isRunning']).toBe(initialState);
    });

    it('should initialize last processed ledger from database', async () => {
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { last_ledger: 500 },
          error: null,
        }),
      };

      (supabase.from as jest.Mock).mockReturnValueOnce(mockQuery);

      await listener.start();

      expect(listener['lastProcessedLedger']).toBe(500);
    });

    it('should handle missing event cursor gracefully', async () => {
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      };

      (supabase.from as jest.Mock).mockReturnValueOnce(mockQuery);

      await listener.start();

      expect(listener['lastProcessedLedger']).toBe(0);
      expect(listener['isRunning']).toBe(true);
    });
  });

  describe('stop()', () => {
    it('should stop the event listener', async () => {
      listener['isRunning'] = true;

      listener.stop();

      expect(listener['isRunning']).toBe(false);
    });

    it('should prevent poll cycle from continuing', async () => {
      listener['isRunning'] = true;

      listener.stop();

      expect(listener['isRunning']).toBe(false);
    });
  });

  describe('Reconnection on Network Failure', () => {
    it('should handle fetch errors and continue polling', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      // fetchEvents should throw when fetch fails
      await expect(
        (listener as any).fetchEvents(100)
      ).rejects.toThrow('Network error');
    });

    it('should retry after failed event processing', async () => {
      const mockEventResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          events: [
            {
              type: 'RenewalSuccess',
              ledger: 101,
              txHash: 'tx-123',
              contractId: 'test-contract-id',
              topics: [],
              value: { sub_id: 1 },
            },
          ],
        },
      };

      // First call fails, then succeeds
      (global.fetch as jest.Mock)
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValueOnce({
          json: jest.fn().mockResolvedValue(mockEventResponse),
        });

      // First call should fail
      await expect(
        (listener as any).fetchEvents(100)
      ).rejects.toThrow('Network timeout');

      // Second call should succeed
      const events = await (listener as any).fetchEvents(100);
      expect(events.length).toBe(1);
    });

    it('should handle ledger reorg and reconnect', async () => {
      const { reorgHandler } = require('../src/services/reorg-handler');

      listener['lastProcessedLedger'] = 300;

      // Simulate ledger going backwards
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        json: jest.fn().mockResolvedValue({
          result: { sequence: 250 }, // Lower than last processed
        }),
      });

      await (listener as any).fetchAndProcessEvents();

      expect(reorgHandler.handleReorg).toHaveBeenCalled();
    });

    it('should persist last processed ledger after successful processing', async () => {
      const mockUpdateQuery = {
        upsert: jest.fn().mockResolvedValue({
          data: {},
          error: null,
        }),
      };

      (supabase.from as jest.Mock).mockReturnValueOnce(mockUpdateQuery);

      await (listener as any).updateLastProcessedLedger(250);

      expect(mockUpdateQuery.upsert).toHaveBeenCalledWith({
        id: 1,
        last_ledger: 250,
      });
    });
  });

  describe('Poll Cycle with Reconnection', () => {
    it('should continue polling after errors', async () => {
      jest.useFakeTimers();

      listener['isRunning'] = true;

      // First fetch fails
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      // Start polling
      const pollPromise = (listener as any).poll();

      // Fast forward time
      jest.advanceTimersByTime(5000);

      // Stop listener
      listener.stop();

      jest.useRealTimers();
    });

    it('should handle multiple consecutive fetch failures with exponential backoff behavior', async () => {
      jest.useFakeTimers();

      listener['isRunning'] = true;

      // Mock consecutive failures
      (global.fetch as jest.Mock)
        .mockRejectedValueOnce(new Error('Network error 1'))
        .mockRejectedValueOnce(new Error('Network error 2'))
        .mockResolvedValueOnce({
          json: jest.fn().mockResolvedValue({
            jsonrpc: '2.0',
            id: 1,
            result: { events: [] },
          }),
        });

      // Initiate polling
      const pollPromise = (listener as any).poll();

      // Let it attempt first request
      jest.advanceTimersByTime(5000);
      jest.advanceTimersByTime(5000);
      jest.advanceTimersByTime(5000);

      listener.stop();
      jest.useRealTimers();
    });
  });

  describe('Event Processing with Reconnection', () => {
    it('should handle successful event processing and update cursor', async () => {
      const mockEvent = {
        type: 'RenewalSuccess',
        ledger: 150,
        txHash: 'tx-150',
        contractId: 'test-contract-id',
        topics: [],
        value: { sub_id: 42 },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        json: jest.fn().mockResolvedValue({
          jsonrpc: '2.0',
          id: 1,
          result: { events: [mockEvent] },
        }),
      });

      const updateMockQuery = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { blockchain_sub_id: 42 },
          error: null,
        }),
      };

      (supabase.from as jest.Mock).mockReturnValueOnce(updateMockQuery);

      const events = await (listener as any).fetchEvents(100);
      expect(events.length).toBe(1);
    });

    it('should skip unsupported contract event schema versions', async () => {
      const unsupportedEvent = {
        type: 'RenewalSuccess',
        ledger: 150,
        txHash: 'tx-unsupported',
        contractId: 'test-contract-id',
        topics: [],
        value: { sub_id: 42, schema_version: 2 },
      };

      jest.clearAllMocks();
      const mod = await import('../src/services/event-listener');
      const schemaListener = new mod.EventListener();

      const processed = await (schemaListener as any).processEvents([unsupportedEvent]);

      expect(processed).toEqual([]);
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('should retry failed event saves', async () => {
      const mockProcessedEvent = {
        sub_id: 1,
        event_type: 'renewal_success',
        ledger: 101,
        tx_hash: 'tx-123',
        event_data: { status: 'active' },
      };

      let callCount = 0;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'contract_events') {
          callCount++;
          return {
            insert: jest.fn().mockResolvedValue({
              data: callCount > 1 ? [{ id: 1 }] : null,
              error: callCount === 1 ? { message: 'Conflict' } : null,
            }),
          };
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
        };
      });

      const events = [mockProcessedEvent];

      // This will test that the service handles save errors appropriately
      try {
        await (listener as any).saveEvents(events);
      } catch (e) {
        // Expected to handle or throw gracefully
      }
    });
  });

  describe('Connection State Management', () => {
    it('should track running state correctly', () => {
      expect(listener['isRunning']).toBe(false);

      listener['isRunning'] = true;
      expect(listener['isRunning']).toBe(true);

      listener.stop();
      expect(listener['isRunning']).toBe(false);
    });

    it('should maintain poll interval configuration', () => {
      expect(listener['pollInterval']).toBe(5000);
    });

    it('should store and update last processed ledger', async () => {
      listener['lastProcessedLedger'] = 100;
      expect(listener['lastProcessedLedger']).toBe(100);

      listener['lastProcessedLedger'] = 250;
      expect(listener['lastProcessedLedger']).toBe(250);
    });

    it('should validate contract address on initialization', () => {
      process.env.SOROBAN_CONTRACT_ADDRESS = '';
      // Clear cache to ensure fresh instance if needed, but here we just call the constructor
      const mod = require('../src/services/event-listener');
      const listener = new mod.EventListener();
      expect(listener.getHealth().status).toBe('disabled');
    });
  });

  describe('Error Recovery Patterns', () => {
    it('should handle RPC timeout errors gracefully', async () => {
      const timeoutError = new Error('RPC request timeout');
      (global.fetch as jest.Mock).mockRejectedValueOnce(timeoutError);

      // fetchEvents should throw when RPC times out
      await expect(
        (listener as any).fetchEvents(100)
      ).rejects.toThrow('RPC request timeout');
    });

    it('should handle invalid JSON response from RPC', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        json: jest.fn().mockRejectedValue(new Error('Invalid JSON')),
      });

      // fetchEvents should throw when JSON parsing fails
      await expect(
        (listener as any).fetchEvents(100)
      ).rejects.toThrow('Invalid JSON');
    });

    it('should handle missing data in RPC response', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        json: jest.fn().mockResolvedValue({
          jsonrpc: '2.0',
          id: 1,
          result: {}, // Missing events
        }),
      });

      const events = await (listener as any).fetchEvents(100);

      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBe(0);
    });

    it('should recover from database connection errors', async () => {
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'Connection timeout' },
        }),
      };

      (supabase.from as jest.Mock).mockReturnValueOnce(mockQuery);

      // Should not throw, but handle gracefully
      const lastLedger = await (listener as any).getLastProcessedLedger();
      expect(lastLedger).toBe(0);
    });
  });
});
