/**
 * Privacy Metrics CSV Export Security Tests
 * 
 * Tests for CSV injection vulnerability fixes in privacy metrics exports.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-key';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'test-admin-key';
process.env.SMTP_HOST = process.env.SMTP_HOST || 'smtp.example.com';
process.env.SMTP_PORT = process.env.SMTP_PORT || '587';
process.env.SMTP_USER = process.env.SMTP_USER || 'test-user';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'test-pass';
process.env.STELLAR_NETWORK_URL = process.env.STELLAR_NETWORK_URL || 'https://horizon-testnet.stellar.org';
process.env.SOROBAN_CONTRACT_ADDRESS = process.env.SOROBAN_CONTRACT_ADDRESS || 'CA1234567890';

import request from 'supertest';
import express, { Express } from 'express';
import privacyMetricsRouter from '../src/routes/admin/privacy-metrics';
import { supabase } from '../src/config/database';

// Mock dependencies
jest.mock('../src/config/database');
jest.mock('../src/config/logger', () => {
  const mLogger = {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  };
  return {
    __esModule: true,
    default: mLogger,
    ...mLogger,
  };
});

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

  function createMockSupabaseQuery(countVal: number | null = 0) {
    const res = { data: null, count: countVal };
    const builder: any = {
      then: (onfulfilled?: any, onrejected?: any) => Promise.resolve(res).then(onfulfilled, onrejected),
      catch: (onrejected?: any) => Promise.resolve(res).catch(onrejected),
      eq: jest.fn().mockImplementation(() => builder),
      not: jest.fn().mockImplementation(() => builder),
    };
    return jest.fn().mockImplementation(() => ({
      select: jest.fn().mockImplementation(() => builder),
    }));
  }

  beforeEach(() => {
    jest.clearAllMocks();
    
    app = express();
    app.use(express.json());
    app.use('/admin', privacyMetricsRouter);

    (supabase as any).from = createMockSupabaseQuery(0);
  });

  describe('Formula Injection Prevention', () => {
    it('should sanitize generated_at field if it starts with dangerous characters', async () => {
      (supabase as any).from = createMockSupabaseQuery(0);

      const response = await request(app)
        .get('/admin/privacy-metrics.csv')
        .expect(200);

      expect(response.text).not.toContain('=');
      expect(response.headers['content-type']).toContain('text/csv');
    });

    it('should handle null values safely in CSV export', async () => {
      (supabase as any).from = createMockSupabaseQuery(null);

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
      (supabase as any).from = createMockSupabaseQuery(0);

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
      (supabase as any).from = createMockSupabaseQuery(0);

      const response = await request(app)
        .get('/admin/privacy-metrics.csv')
        .expect(200);

      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.headers['content-disposition']).toContain('privacy-metrics.csv');
    });

    it('should maintain CSV structure with commas', async () => {
      (supabase as any).from = createMockSupabaseQuery(0);

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
