/**
 * CSV Import Service Tests
 * 
 * Tests for CSV injection vulnerability fixes:
 * - Formula injection detection on import
 * - Malformed row rejection
 * - Edge cases and security scenarios
 */

import { previewImport, commitImport, ImportRow } from '../src/services/csv-import-service';
import { supabase } from '../src/config/database';

// Mock supabase
jest.mock('../src/config/database', () => ({
  supabase: {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    ilike: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(),
    insert: jest.fn(),
  },
}));

// Mock logger
jest.mock('../src/config/logger', () => ({
  default: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('CSV Import Service - Security Tests', () => {
  const userId = 'test-user-123';

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no duplicates found
    (supabase.from('subscriptions').select().eq().ilike().maybeSingle as jest.Mock).mockResolvedValue({
      data: null,
    });
  });

  describe('Formula Injection Detection', () => {
    it('should reject rows with cells starting with =', async () => {
      const csv = Buffer.from(
        'name,price,currency,billing_cycle\n' +
        '=1+1,10.00,USD,monthly'
      );

      const result = await previewImport(csv, userId);

      expect(result.errorCount).toBe(1);
      expect(result.rows[0].status).toBe('error');
      expect(result.rows[0].error).toMatch(/dangerous formula character/i);
    });

    it('should reject rows with cells starting with +', async () => {
      const csv = Buffer.from(
        'name,price,currency,billing_cycle\n' +
        'Netflix,+10.00,USD,monthly'
      );

      const result = await previewImport(csv, userId);

      expect(result.errorCount).toBe(1);
      expect(result.rows[0].status).toBe('error');
      expect(result.rows[0].error).toMatch(/dangerous formula character/i);
    });

    it('should reject rows with cells starting with -', async () => {
      const csv = Buffer.from(
        'name,price,currency,billing_cycle\n' +
        'Netflix,10.00,USD,-monthly'
      );

      const result = await previewImport(csv, userId);

      expect(result.errorCount).toBe(1);
      expect(result.rows[0].status).toBe('error');
      expect(result.rows[0].error).toMatch(/dangerous formula character/i);
    });

    it('should reject rows with cells starting with @', async () => {
      const csv = Buffer.from(
        'name,price,currency,billing_cycle\n' +
        '@SUM(A1:A10),10.00,USD,monthly'
      );

      const result = await previewImport(csv, userId);

      expect(result.errorCount).toBe(1);
      expect(result.rows[0].status).toBe('error');
      expect(result.rows[0].error).toMatch(/dangerous formula character/i);
    });

    it('should reject rows with cells starting with tab character', async () => {
      const csv = Buffer.from(
        'name,price,currency,billing_cycle\n' +
        '\tNetflix,10.00,USD,monthly'
      );

      const result = await previewImport(csv, userId);

      expect(result.errorCount).toBe(1);
      expect(result.rows[0].status).toBe('error');
      expect(result.rows[0].error).toMatch(/dangerous formula character/i);
    });

    it('should reject rows with cells starting with carriage return', async () => {
      const csv = Buffer.from(
        'name,price,currency,billing_cycle\n' +
        '\rNetflix,10.00,USD,monthly'
      );

      const result = await previewImport(csv, userId);

      expect(result.errorCount).toBe(1);
      expect(result.rows[0].status).toBe('error');
      expect(result.rows[0].error).toMatch(/dangerous formula character/i);
    });

    it('should accept rows with formula characters not at the start', async () => {
      const csv = Buffer.from(
        'name,price,currency,billing_cycle\n' +
        'Netflix (+HD),10.00,USD,monthly\n' +
        'Spotify - Premium,9.99,USD,monthly'
      );

      const result = await previewImport(csv, userId);

      expect(result.validCount).toBe(2);
      expect(result.errorCount).toBe(0);
    });

    it('should reject complex formula injection attempts', async () => {
      const csv = Buffer.from(
        'name,price,currency,billing_cycle,notes\n' +
        '=cmd|"/c calc",10.00,USD,monthly,test\n' +
        '=HYPERLINK("http://evil.com","Click"),20.00,EUR,yearly,test2\n' +
        '+1+1+cmd|"/c calc",15.00,GBP,monthly,test3'
      );

      const result = await previewImport(csv, userId);

      expect(result.errorCount).toBe(3);
      result.rows.forEach(row => {
        expect(row.status).toBe('error');
        expect(row.error).toMatch(/dangerous formula character/i);
      });
    });
  });

  describe('Malformed Row Rejection', () => {
    it('should reject rows with missing required fields', async () => {
      const csv = Buffer.from(
        'name,price,currency,billing_cycle\n' +
        ',10.00,USD,monthly'
      );

      const result = await previewImport(csv, userId);

      expect(result.errorCount).toBe(1);
      expect(result.rows[0].status).toBe('error');
      expect(result.rows[0].error).toMatch(/name.*required/i);
    });

    it('should reject rows with invalid price format', async () => {
      const csv = Buffer.from(
        'name,price,currency,billing_cycle\n' +
        'Netflix,not-a-number,USD,monthly\n' +
        'Spotify,abc123,USD,monthly'
      );

      const result = await previewImport(csv, userId);

      expect(result.errorCount).toBe(2);
      result.rows.forEach(row => {
        expect(row.status).toBe('error');
        expect(row.error).toMatch(/price/i);
      });
    });

    it('should reject rows with invalid billing cycle', async () => {
      const csv = Buffer.from(
        'name,price,currency,billing_cycle\n' +
        'Netflix,10.00,USD,invalid-cycle'
      );

      const result = await previewImport(csv, userId);

      expect(result.errorCount).toBe(1);
      expect(result.rows[0].status).toBe('error');
      expect(result.rows[0].error).toMatch(/billing cycle/i);
    });

    it('should reject rows with invalid currency code', async () => {
      const csv = Buffer.from(
        'name,price,currency,billing_cycle\n' +
        'Netflix,10.00,US,monthly\n' +
        'Spotify,9.99,DOLLAR,monthly'
      );

      const result = await previewImport(csv, userId);

      expect(result.errorCount).toBe(2);
      result.rows.forEach(row => {
        expect(row.status).toBe('error');
        expect(row.error).toMatch(/currency/i);
      });
    });

    it('should reject rows with invalid renewal date', async () => {
      const csv = Buffer.from(
        'name,price,currency,billing_cycle,next_renewal\n' +
        'Netflix,10.00,USD,monthly,not-a-date\n' +
        'Spotify,9.99,USD,monthly,2025-13-45'
      );

      const result = await previewImport(csv, userId);

      expect(result.errorCount).toBe(2);
      result.rows.forEach(row => {
        expect(row.status).toBe('error');
        expect(row.error).toMatch(/renewal/i);
      });
    });

    it('should reject rows with invalid URLs', async () => {
      const csv = Buffer.from(
        'name,price,currency,billing_cycle,renewal_url\n' +
        'Netflix,10.00,USD,monthly,javascript:alert(1)\n' +
        'Spotify,9.99,USD,monthly,ftp://invalid.com'
      );

      const result = await previewImport(csv, userId);

      expect(result.errorCount).toBe(2);
      result.rows.forEach(row => {
        expect(row.status).toBe('error');
        expect(row.error).toMatch(/url/i);
      });
    });

    it('should reject rows with negative prices', async () => {
      const csv = Buffer.from(
        'name,price,currency,billing_cycle\n' +
        'Netflix,-10.00,USD,monthly'
      );

      const result = await previewImport(csv, userId);

      expect(result.errorCount).toBe(1);
      expect(result.rows[0].status).toBe('error');
      expect(result.rows[0].error).toMatch(/price/i);
    });

    it('should reject rows with excessively long names', async () => {
      const longName = 'a'.repeat(101);
      const csv = Buffer.from(
        `name,price,currency,billing_cycle\n` +
        `${longName},10.00,USD,monthly`
      );

      const result = await previewImport(csv, userId);

      expect(result.errorCount).toBe(1);
      expect(result.rows[0].status).toBe('error');
    });
  });

  describe('Valid Data Processing', () => {
    it('should accept valid rows', async () => {
      const csv = Buffer.from(
        'name,price,currency,billing_cycle,next_renewal,category,renewal_url\n' +
        'Netflix,15.99,USD,monthly,2025-05-01,Streaming,https://netflix.com\n' +
        'Spotify,9.99,USD,monthly,2025-05-15,Music,https://spotify.com'
      );

      const result = await previewImport(csv, userId);

      expect(result.validCount).toBe(2);
      expect(result.errorCount).toBe(0);
      expect(result.rows[0].status).toBe('valid');
      expect(result.rows[0].data?.name).toBe('Netflix');
      expect(result.rows[1].data?.name).toBe('Spotify');
    });

    it('should handle optional fields', async () => {
      const csv = Buffer.from(
        'name,price,currency,billing_cycle\n' +
        'Netflix,15.99,USD,monthly'
      );

      const result = await previewImport(csv, userId);

      expect(result.validCount).toBe(1);
      expect(result.rows[0].data?.next_renewal).toBeNull();
      expect(result.rows[0].data?.renewal_url).toBeUndefined();
    });

    it('should normalize billing cycles to lowercase', async () => {
      const csv = Buffer.from(
        'name,price,currency,billing_cycle\n' +
        'Netflix,15.99,USD,MONTHLY\n' +
        'Spotify,9.99,USD,Yearly'
      );

      const result = await previewImport(csv, userId);

      expect(result.validCount).toBe(2);
      expect(result.rows[0].data?.billing_cycle).toBe('monthly');
      expect(result.rows[1].data?.billing_cycle).toBe('yearly');
    });

    it('should handle BOM (Byte Order Mark)', async () => {
      const csv = Buffer.from(
        '\uFEFFname,price,currency,billing_cycle\n' +
        'Netflix,15.99,USD,monthly'
      );

      const result = await previewImport(csv, userId);

      expect(result.validCount).toBe(1);
      expect(result.rows[0].data?.name).toBe('Netflix');
    });
  });

  describe('Duplicate Detection', () => {
    it('should detect duplicate subscriptions', async () => {
      (supabase.from('subscriptions').select().eq().ilike().maybeSingle as jest.Mock)
        .mockResolvedValue({ data: { id: 'existing-sub-123' } });

      const csv = Buffer.from(
        'name,price,currency,billing_cycle\n' +
        'Netflix,15.99,USD,monthly'
      );

      const result = await previewImport(csv, userId);

      expect(result.duplicateCount).toBe(1);
      expect(result.rows[0].status).toBe('duplicate');
      expect(result.rows[0].duplicateId).toBe('existing-sub-123');
    });
  });

  describe('Commit Import', () => {
    it('should insert valid rows', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      (supabase.from('subscriptions').insert as jest.Mock) = mockInsert;

      const rows: ImportRow[] = [
        {
          row: 2,
          status: 'valid',
          data: {
            name: 'Netflix',
            price: 15.99,
            currency: 'USD',
            billing_cycle: 'monthly',
            next_renewal: '2025-05-01',
            category: 'Streaming',
            renewal_url: 'https://netflix.com',
          },
        },
      ];

      const result = await commitImport(rows, userId, true);

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.errors).toBe(0);
      expect(mockInsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            user_id: userId,
            name: 'Netflix',
            price: 15.99,
            currency: 'USD',
            billing_cycle: 'monthly',
            source: 'csv_import',
          }),
        ])
      );
    });

    it('should skip duplicates when skipDupes is true', async () => {
      const rows: ImportRow[] = [
        {
          row: 2,
          status: 'valid',
          data: {
            name: 'Netflix',
            price: 15.99,
            currency: 'USD',
            billing_cycle: 'monthly',
            next_renewal: null,
            category: 'Streaming',
            renewal_url: null,
          },
        },
        {
          row: 3,
          status: 'duplicate',
          data: {
            name: 'Spotify',
            price: 9.99,
            currency: 'USD',
            billing_cycle: 'monthly',
            next_renewal: null,
            category: 'Music',
            renewal_url: null,
          },
          duplicateId: 'existing-123',
        },
      ];

      const result = await commitImport(rows, userId, true);

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('should not import error rows', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      (supabase.from('subscriptions').insert as jest.Mock) = mockInsert;

      const rows: ImportRow[] = [
        {
          row: 2,
          status: 'error',
          data: null,
          error: 'Invalid data',
        },
      ];

      const result = await commitImport(rows, userId, true);

      expect(result.imported).toBe(0);
      expect(result.errors).toBe(1);
      expect(mockInsert).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should reject empty CSV files', async () => {
      const csv = Buffer.from('');

      await expect(previewImport(csv, userId)).rejects.toThrow(/empty/i);
    });

    it('should reject CSV files with only headers', async () => {
      const csv = Buffer.from('name,price,currency,billing_cycle\n');

      await expect(previewImport(csv, userId)).rejects.toThrow(/empty/i);
    });

    it('should reject CSV files exceeding 500 rows', async () => {
      const header = 'name,price,currency,billing_cycle\n';
      const row = 'Netflix,15.99,USD,monthly\n';
      const csv = Buffer.from(header + row.repeat(501));

      await expect(previewImport(csv, userId)).rejects.toThrow(/limit is 500/i);
    });

    it('should handle CSV parse errors', async () => {
      const csv = Buffer.from('invalid\x00binary\x00data');

      await expect(previewImport(csv, userId)).rejects.toThrow(/parse error/i);
    });
  });
});
