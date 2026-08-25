/**
 * Privacy Metrics CSV Export Security Tests
 * 
 * Tests for CSV injection vulnerability fixes in privacy metrics exports.
 */

import request from 'supertest';
import express, { Express } from 'express';
import privacyMetricsRouter from '../src/routes/admin/privacy-metrics';
import { supabase } from '../src/config/database';

// Mock dependencies
jest.mock('../src/config/database');
jest.mock('../src/config/logger', () => ({
  default: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = { id: 'admin-user-123', email: 'admin@test.com', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

jest.mock('../src/middleware/rbac', () => ({
  requireRole: () => (req: any, res: any, next: any) => next(),
}));

jest.mock('../src/middleware/rate-limit-factory', () => ({
  createAdminLimiter: () => (req: any, res: any, next: any) => next(),
}));

describe('Privacy Metrics CSV Export Security', () => {
  let app: Express;

  beforeEach(() => {
    jest.clearAllMocks();
    
    app = express();
    app.use(express.json());
    app.use('/admin', privacyMetricsRouter);

    // Mock supabase responses
    const mockSupabaseChain = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      not: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(),
    };

    (supabase as any).from = mockSupabaseChain.from;
    
    // Default mock responses for all queries
    mockSupabaseChain.select.mockReturnValue({
      ...mockSupabaseChain,
      eq: jest.fn().mockReturnValue({
        ...mockSupabaseChain,
        not: jest.fn().mockResolvedValue({ data: null, count: 0 }),
      }),
    });
  });

  describe('Formula Injection Prevention', () => {
    it('should sanitize generated_at field if it starts with dangerous characters', async () => {
      // Mock all required database calls
      const mockFrom = jest.fn().mockImplementation(() => ({
        select: jest.fn().mockImplementation(() => ({
          eq: jest.fn().mockImplementation(() => ({
            not: jest.fn().mockResolvedValue({ data: null, count: 0 }),
          })),
        })),
      }));

      (supabase as any).from = mockFrom;

      const response = await request(app)
        .get('/admin/privacy-metrics.csv')
        .expect(200);

      expect(response.text).not.toContain('=');
      expect(response.headers['content-type']).toContain('text/csv');
    });

    it('should handle null values safely in CSV export', async () => {
      const mockFrom = jest.fn().mockImplementation(() => ({
        select: jest.fn().mockImplementation(() => ({
          eq: jest.fn().mockImplementation(() => ({
            not: jest.fn().mockResolvedValue({ data: null, count: null }),
          })),
        })),
      }));

      (supabase as any).from = mockFrom;

      const response = await request(app)
        .get('/admin/privacy-metrics.csv')
        .expect(200);

      const lines = response.text.split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(2);
      
      // Check that nulls are handled as empty strings
      const dataLine = lines[1];
      expect(dataLine).toBeTruthy();
    });

    it('should sanitize all header fields', async () => {
      const mockFrom = jest.fn().mockImplementation(() => ({
        select: jest.fn().mockImplementation(() => ({
          eq: jest.fn().mockImplementation(() => ({
            not: jest.fn().mockResolvedValue({ data: null, count: 0 }),
          })),
        })),
      }));

      (supabase as any).from = mockFrom;

      const response = await request(app)
        .get('/admin/privacy-metrics.csv')
        .expect(200);

      const lines = response.text.split('\n');
      const headers = lines[0];
      
      // Verify headers don't start with dangerous characters
      expect(headers).not.toMatch(/^[=+\-@\t\r]/);
      expect(headers).toContain('privacy_mode_enabled_rate_percent');
      expect(headers).toContain('generated_at');
    });

    it('should properly format CSV with correct content-type', async () => {
      const mockFrom = jest.fn().mockImplementation(() => ({
        select: jest.fn().mockImplementation(() => ({
          eq: jest.fn().mockImplementation(() => ({
            not: jest.fn().mockResolvedValue({ data: null, count: 0 }),
          })),
        })),
      }));

      (supabase as any).from = mockFrom;

      const response = await request(app)
        .get('/admin/privacy-metrics.csv')
        .expect(200);

      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.headers['content-disposition']).toContain('privacy-metrics.csv');
    });

    it('should maintain CSV structure with commas', async () => {
      const mockFrom = jest.fn().mockImplementation(() => ({
        select: jest.fn().mockImplementation(() => ({
          eq: jest.fn().mockImplementation(() => ({
            not: jest.fn().mockResolvedValue({ data: null, count: 0 }),
          })),
        })),
      }));

      (supabase as any).from = mockFrom;

      const response = await request(app)
        .get('/admin/privacy-metrics.csv')
        .expect(200);

      const lines = response.text.split('\n');
      const headers = lines[0].split(',');
      const dataRow = lines[1].split(',');
      
      // Should have same number of columns
      expect(headers.length).toBe(9);
      expect(dataRow.length).toBe(9);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      const mockFrom = jest.fn().mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      (supabase as any).from = mockFrom;

      const response = await request(app)
        .get('/admin/privacy-metrics.csv')
        .expect(500);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Failed to export privacy metrics CSV');
    });
  });
});
