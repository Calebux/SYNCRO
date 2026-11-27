import {
  validateCursor,
  validateLimit,
  encodeCursor,
  PaginationError,
  cursorPaginationSchema,
} from '../src/utils/pagination';

describe('Pagination Utilities', () => {
  describe('validateCursor', () => {
    it('should return null for undefined cursor', () => {
      expect(validateCursor(undefined)).toBeNull();
    });

    it('should return null for empty string cursor', () => {
      expect(validateCursor('')).toBeNull();
    });

    it('should return null for null cursor', () => {
      expect(validateCursor(null as any)).toBeNull();
    });

    it('should decode a valid base64 cursor with createdAt', () => {
      const cursor = encodeCursor({ createdAt: '2024-01-01T00:00:00Z' });
      const result = validateCursor(cursor);
      expect(result).toEqual({ createdAt: '2024-01-01T00:00:00Z' });
    });

    it('should decode a valid base64 cursor with created_at', () => {
      const encoded = Buffer.from(JSON.stringify({ created_at: '2024-01-01T00:00:00Z' })).toString('base64');
      const result = validateCursor(encoded);
      expect(result).toEqual({ createdAt: '2024-01-01T00:00:00Z' });
    });

    it('should throw INVALID_CURSOR for malformed base64', () => {
      expect(() => validateCursor('not-valid-base64!!!')).toThrow(PaginationError);
      try {
        validateCursor('not-valid-base64!!!');
      } catch (error: any) {
        expect(error.code).toBe('INVALID_CURSOR');
      }
    });

    it('should throw MALFORMED_CURSOR for non-object decoded value', () => {
      const encoded = Buffer.from(JSON.stringify('just a string')).toString('base64');
      expect(() => validateCursor(encoded)).toThrow(PaginationError);
      try {
        validateCursor(encoded);
      } catch (error: any) {
        expect(error.code).toBe('MALFORMED_CURSOR');
      }
    });

    it('should throw MALFORMED_CURSOR for missing created_at field', () => {
      const encoded = Buffer.from(JSON.stringify({ other: 'field' })).toString('base64');
      expect(() => validateCursor(encoded)).toThrow(PaginationError);
      try {
        validateCursor(encoded);
      } catch (error: any) {
        expect(error.code).toBe('MALFORMED_CURSOR');
      }
    });

    it('should throw MALFORMED_CURSOR for non-string created_at', () => {
      const encoded = Buffer.from(JSON.stringify({ created_at: 123 })).toString('base64');
      expect(() => validateCursor(encoded)).toThrow(PaginationError);
      try {
        validateCursor(encoded);
      } catch (error: any) {
        expect(error.code).toBe('MALFORMED_CURSOR');
      }
    });
  });

  describe('validateLimit', () => {
    it('should return default value when limit is undefined', () => {
      expect(validateLimit(undefined)).toBe(20);
    });

    it('should return default value when limit is null', () => {
      expect(validateLimit(null)).toBe(20);
    });

    it('should return default value when limit is empty string', () => {
      expect(validateLimit('')).toBe(20);
    });

    it('should return parsed integer when limit is string', () => {
      expect(validateLimit('50')).toBe(50);
    });

    it('should return parsed integer when limit is number', () => {
      expect(validateLimit(50)).toBe(50);
    });

    it('should throw INVALID_LIMIT for non-numeric string', () => {
      expect(() => validateLimit('abc')).toThrow(PaginationError);
    });

    it('should throw INVALID_LIMIT for limit below 1', () => {
      expect(() => validateLimit(0)).toThrow(PaginationError);
      expect(() => validateLimit(-5)).toThrow(PaginationError);
    });

    it('should throw INVALID_LIMIT for limit above max', () => {
      expect(() => validateLimit(101)).toThrow(PaginationError);
    });

    it('should cap limit at max value', () => {
      expect(validateLimit(100)).toBe(100);
    });

    it('should accept custom max value', () => {
      expect(validateLimit(1000, 1000, 50)).toBe(1000);
    });

    it('should throw INVALID_LIMIT for limit above custom max', () => {
      expect(() => validateLimit(1001, 1000, 50)).toThrow(PaginationError);
    });

    it('should accept custom default value', () => {
      expect(validateLimit(undefined, 100, 50)).toBe(50);
    });
  });

  describe('encodeCursor', () => {
    it('should encode cursor correctly', () => {
      const cursor = encodeCursor({ createdAt: '2024-01-01T00:00:00Z' });
      const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
      expect(decoded).toEqual({ createdAt: '2024-01-01T00:00:00Z' });
    });

    it('should produce consistent output for same input', () => {
      const cursor1 = encodeCursor({ createdAt: '2024-01-01T00:00:00Z' });
      const cursor2 = encodeCursor({ createdAt: '2024-01-01T00:00:00Z' });
      expect(cursor1).toBe(cursor2);
    });
  });

  describe('cursorPaginationSchema', () => {
    it('should validate valid pagination input', () => {
      const result = cursorPaginationSchema.parse({ limit: 20 });
      expect(result.limit).toBe(20);
      expect(result.cursor).toBeUndefined();
    });

    it('should apply default limit', () => {
      const result = cursorPaginationSchema.parse({});
      expect(result.limit).toBe(20);
    });

    it('should accept cursor parameter', () => {
      const cursor = encodeCursor({ createdAt: '2024-01-01T00:00:00Z' });
      const result = cursorPaginationSchema.parse({ limit: 10, cursor });
      expect(result.limit).toBe(10);
      expect(result.cursor).toBe(cursor);
    });

    it('should reject limit below 1', () => {
      expect(() => cursorPaginationSchema.parse({ limit: 0 })).toThrow();
    });

    it('should reject limit above 100', () => {
      expect(() => cursorPaginationSchema.parse({ limit: 101 })).toThrow();
    });
  });
});