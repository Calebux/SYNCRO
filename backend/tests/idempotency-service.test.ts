// Mock supabase
jest.mock('../src/config/database', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn().mockReturnThis(),
        gt: jest.fn().mockReturnThis(),
        single: jest.fn()
      })),
      delete: jest.fn(() => ({
        lt: jest.fn(() => ({
          select: jest.fn()
        }))
      })),
      insert: jest.fn(() => ({}))
    }))
  }
}));

import { IdempotencyService, createIdempotencyService, TypedIdempotentResponse, SerializableInput } from '../src/services/idempotency';
import { supabase } from '../src/config/database';

// Mock logger
jest.mock('../src/config/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn()
}));

describe('IdempotencyService', () => {
  let service: IdempotencyService<{ userId: string; amount: number }, { success: boolean; transactionId: string }>;

  beforeEach(() => {
    jest.clearAllMocks();
    service = createIdempotencyService<{ userId: string; amount: number }, { success: boolean; transactionId: string }>();
  });

  describe('Type Safety', () => {
    it('should enforce payload type constraints', () => {
      // Valid payload
      const validPayload = { userId: 'user123', amount: 100 };
      expect(() => service.generateKey('user123', 'payment', validPayload)).not.toThrow();

      // These should be caught by TypeScript but we test runtime behavior
      const stringPayload = 'test';
      expect(() => service.generateKey('user123', 'test', stringPayload as any)).not.toThrow();
    });

    it('should maintain response type safety', async () => {
      const mockResponse: TypedIdempotentResponse<{ success: boolean; transactionId: string }> = {
        status: 200,
        body: { success: true, transactionId: 'txn_123' },
        idempotencyKey: 'test-key'
      };

      const mockSingle = jest.fn().mockResolvedValue({
        data: {
          response_status: 200,
          response_body: { success: true, transactionId: 'txn_123' },
          key: 'test-key'
        },
        error: null
      });

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                gt: jest.fn().mockReturnValue({
                  single: mockSingle
                })
              })
            })
          })
        })
      });

      const result = await service.checkIdempotency('test-key', 'user123', 'hash123');
      
      expect(result.isDuplicate).toBe(true);
      expect(result.cachedResponse).toEqual(mockResponse);
      expect(result.cachedResponse?.body.success).toBe(true);
      expect(result.cachedResponse?.body.transactionId).toBe('txn_123');
    });
  });

  describe('Hash Generation', () => {
    it('should generate consistent hashes for identical payloads', () => {
      const payload = { userId: 'user123', amount: 100 };
      const hash1 = service.hashRequest(payload);
      const hash2 = service.hashRequest(payload);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex
    });

    it('should generate different hashes for different payloads', () => {
      const payload1 = { userId: 'user123', amount: 100 };
      const payload2 = { userId: 'user123', amount: 200 };
      const hash1 = service.hashRequest(payload1);
      const hash2 = service.hashRequest(payload2);
      
      expect(hash1).not.toBe(hash2);
    });

    it('should handle complex nested objects', () => {
      const complexPayload = {
        userId: 'user123',
        amount: 100,
        metadata: {
          category: 'subscription',
          features: ['feature1', 'feature2'],
          settings: {
            autoRenew: true,
            notifications: false
          }
        }
      };
      
      const hash = service.hashRequest(complexPayload);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should handle primitive types', () => {
      const primitiveService = createIdempotencyService<string, boolean>();
      const hash = primitiveService.hashRequest('simple-string');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('Key Generation', () => {
    it('should generate unique keys for different operations', () => {
      const payload = { userId: 'user123', amount: 100 };
      const key1 = service.generateKey('user123', 'payment', payload);
      const key2 = service.generateKey('user123', 'refund', payload);
      
      expect(key1).not.toBe(key2);
      expect(key1).toContain('user123:payment:');
      expect(key2).toContain('user123:refund:');
    });

    it('should generate different keys for different users', () => {
      const payload = { userId: 'user123', amount: 100 };
      const key1 = service.generateKey('user123', 'payment', payload);
      const key2 = service.generateKey('user456', 'payment', payload);
      
      expect(key1).not.toBe(key2);
    });

    it('should generate consistent keys for same inputs', () => {
      const payload = { userId: 'user123', amount: 100 };
      const key1 = service.generateKey('user123', 'payment', payload);
      const key2 = service.generateKey('user123', 'payment', payload);
      
      expect(key1).toBe(key2);
    });
  });

  describe('Duplicate Detection', () => {
    it('should detect duplicates correctly', async () => {
      const mockExisting = {
        response_status: 200,
        response_body: { success: true, transactionId: 'txn_123' },
        key: 'test-key'
      };

      const mockSingle = jest.fn().mockResolvedValue({
        data: mockExisting,
        error: null
      });

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                gt: jest.fn().mockReturnValue({
                  single: mockSingle
                })
              })
            })
          })
        })
      });

      const result = await service.checkIdempotency('test-key', 'user123', 'hash123');
      
      expect(result.isDuplicate).toBe(true);
      expect(result.cachedResponse).toBeDefined();
      expect(result.cachedResponse?.status).toBe(200);
      expect(result.cachedResponse?.body).toEqual({ success: true, transactionId: 'txn_123' });
    });

    it('should return non-duplicate when no record exists', async () => {
      const mockSingle = jest.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' }
      });

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                gt: jest.fn().mockReturnValue({
                  single: mockSingle
                })
              })
            })
          })
        })
      });

      const result = await service.checkIdempotency('test-key', 'user123', 'hash123');
      
      expect(result.isDuplicate).toBe(false);
      expect(result.cachedResponse).toBeUndefined();
    });

    it('should handle database errors gracefully', async () => {
      const mockSingle = jest.fn().mockResolvedValue({
        data: null,
        error: { code: 'DATABASE_ERROR', message: 'Connection failed' }
      });

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                gt: jest.fn().mockReturnValue({
                  single: mockSingle
                })
              })
            })
          })
        })
      });

      const result = await service.checkIdempotency('test-key', 'user123', 'hash123');
      
      expect(result.isDuplicate).toBe(false);
      expect(result.cachedResponse).toBeUndefined();
    });
  });

  describe('Response Storage', () => {
    it('should store responses with correct types', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      (supabase.from as jest.Mock).mockReturnValue({
        insert: mockInsert
      });

      const response = { success: true, transactionId: 'txn_123' };
      
      await service.storeResponse('test-key', 'user123', 'hash123', 200, response);
      
      expect(mockInsert).toHaveBeenCalledWith({
        key: 'test-key',
        user_id: 'user123',
        request_hash: 'hash123',
        response_status: 200,
        response_body: response,
        expires_at: expect.any(String)
      });
    });

    it('should handle storage errors gracefully', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ 
        error: { message: 'Storage failed' } 
      });
      (supabase.from as jest.Mock).mockReturnValue({
        insert: mockInsert
      });

      const response = { success: true, transactionId: 'txn_123' };
      
      await expect(service.storeResponse('test-key', 'user123', 'hash123', 200, response))
        .resolves.not.toThrow();
    });
  });

  describe('Backward Compatibility', () => {
    it('should work with untyped service instance', () => {
      const untypedService = new IdempotencyService();
      
      expect(() => {
        const key = untypedService.generateKey('user', 'op', { data: 'test' });
        const hash = untypedService.hashRequest({ data: 'test' });
        expect(key).toContain('user:op:');
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
      }).not.toThrow();
    });
  });

describe('Edge Cases', () => {
    it('should handle null and undefined values in payload', () => {
      const flexibleService = createIdempotencyService<SerializableInput, any>();
      const payloadWithNulls = { 
        userId: 'user123', 
        amount: null, 
        description: undefined 
      };
      
      expect(() => flexibleService.hashRequest(payloadWithNulls)).not.toThrow();
      expect(() => flexibleService.generateKey('user123', 'test', payloadWithNulls)).not.toThrow();
    });

    it('should handle empty objects and arrays', () => {
      const flexibleService = createIdempotencyService<SerializableInput, any>();
      
      expect(() => flexibleService.hashRequest({} as SerializableInput)).not.toThrow();
      expect(() => flexibleService.hashRequest([] as SerializableInput)).not.toThrow();
      expect(() => flexibleService.hashRequest({ nested: { empty: {} } } as SerializableInput)).not.toThrow();
    });

    it('should handle circular references gracefully', () => {
      const flexibleService = createIdempotencyService<SerializableInput, any>();
      const circular: any = { name: 'test' };
      circular.self = circular;
      
      // JSON.stringify would throw, but our type system should prevent this
      expect(() => {
        const hash = flexibleService.hashRequest(circular);
      }).toThrow();
    });
  });
});
