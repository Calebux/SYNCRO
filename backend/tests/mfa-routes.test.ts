/**
 * Integration tests for MFA routes
 * Tests TOTP verification endpoints with rate limiting and security events
 */

import request from 'supertest';
import express from 'express';
import * as speakeasy from 'speakeasy';
import mfaRouter from '../src/routes/mfa';
import { authenticate } from '../src/middleware/auth';
import { supabase } from '../src/config/database';

// Mock authentication middleware
jest.mock('../src/middleware/auth', () => ({
  authenticate: jest.fn((req, res, next) => {
    req.user = { id: 'test-user-123', email: 'test@example.com' };
    next();
  }),
  AuthenticatedRequest: jest.fn(),
}));

// Mock audit service
jest.mock('../src/services/audit-service', () => ({
  emitSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

// Mock rate limit factory
jest.mock('../src/middleware/rate-limit-factory', () => ({
  createMfaLimiter: jest.fn(() => (req: any, res: any, next: any) => next()),
}));

const app = express();
app.use(express.json());
app.use('/api', mfaRouter);

describe('MFA Routes - TOTP Verification', () => {
  let testSecret: string;
  let testOtpauthUrl: string;

  beforeAll(() => {
    const secret = speakeasy.generateSecret({
      name: 'Syncro (test@example.com)',
      issuer: 'Syncro',
      length: 32,
    });
    testSecret = secret.base32!;
    testOtpauthUrl = secret.otpauth_url!;
  });

  afterEach(async () => {
    // Cleanup used codes
    await supabase
      .from('totp_used_codes')
      .delete()
      .eq('user_id', 'test-user-123');
  });

  describe('POST /api/2fa/totp/generate', () => {
    it('should generate a new TOTP secret', async () => {
      const response = await request(app)
        .post('/api/2fa/totp/generate')
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.secret).toBeDefined();
      expect(response.body.data.otpauth_url).toBeDefined();
      expect(response.body.data.otpauth_url).toContain('otpauth://totp/');
    });

    it('should include user email in otpauth URL', async () => {
      const response = await request(app)
        .post('/api/2fa/totp/generate')
        .expect(201);

      expect(response.body.data.otpauth_url).toContain('Syncro');
    });
  });

  describe('POST /api/2fa/totp/verify', () => {
    it('should verify a valid TOTP code', async () => {
      const token = speakeasy.totp({
        secret: testSecret,
        encoding: 'base32',
      });

      const response = await request(app)
        .post('/api/2fa/totp/verify')
        .send({ token, secret: testSecret })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should reject an invalid TOTP code', async () => {
      const response = await request(app)
        .post('/api/2fa/totp/verify')
        .send({ token: '000000', secret: testSecret })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Invalid or already-used');
    });

    it('should reject a TOTP code used twice (replay attack)', async () => {
      const token = speakeasy.totp({
        secret: testSecret,
        encoding: 'base32',
      });

      // First attempt succeeds
      await request(app)
        .post('/api/2fa/totp/verify')
        .send({ token, secret: testSecret })
        .expect(200);

      // Second attempt fails (replay)
      const response = await request(app)
        .post('/api/2fa/totp/verify')
        .send({ token, secret: testSecret })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Invalid or already-used');
    });

    it('should return 400 if token is missing', async () => {
      const response = await request(app)
        .post('/api/2fa/totp/verify')
        .send({ secret: testSecret })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Missing required fields');
    });

    it('should return 400 if secret is missing', async () => {
      const response = await request(app)
        .post('/api/2fa/totp/verify')
        .send({ token: '123456' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Missing required fields');
    });
  });

  describe('Rate Limiting and Lockout', () => {
    it('should lock account after 5 failed attempts', async () => {
      // Make 5 failed attempts
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/2fa/totp/verify')
          .send({ token: '000000', secret: testSecret });
      }

      // 6th attempt should return 429 (locked)
      const response = await request(app)
        .post('/api/2fa/totp/verify')
        .send({ token: '000000', secret: testSecret })
        .expect(429);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Too many failed attempts');
    });

    it('should include lockout duration in error message', async () => {
      // Lock the account
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/2fa/totp/verify')
          .send({ token: '000000', secret: testSecret });
      }

      const response = await request(app)
        .post('/api/2fa/totp/verify')
        .send({ token: '000000', secret: testSecret })
        .expect(429);

      expect(response.body.error).toMatch(/\d+ minute/);
    });

    it('should reset failure count on successful verification', async () => {
      // Make 3 failed attempts
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post('/api/2fa/totp/verify')
          .send({ token: '000000', secret: testSecret });
      }

      // Make a successful attempt
      const validToken = speakeasy.totp({
        secret: testSecret,
        encoding: 'base32',
      });

      await request(app)
        .post('/api/2fa/totp/verify')
        .send({ token: validToken, secret: testSecret })
        .expect(200);

      // Should be able to make more attempts now (not locked)
      const response = await request(app)
        .post('/api/2fa/totp/verify')
        .send({ token: '000000', secret: testSecret });

      // Should get 401 (invalid), not 429 (locked)
      expect(response.status).toBe(401);
    });
  });

  describe('Security Events', () => {
    it('should emit security event on successful verification', async () => {
      const { emitSecurityEvent } = require('../src/services/audit-service');
      
      const token = speakeasy.totp({
        secret: testSecret,
        encoding: 'base32',
      });

      await request(app)
        .post('/api/2fa/totp/verify')
        .send({ token, secret: testSecret })
        .expect(200);

      expect(emitSecurityEvent).toHaveBeenCalledWith(
        'mfa.totp_verification_success',
        expect.objectContaining({
          severity: 'info',
          actorId: 'test-user-123',
          resourceType: 'mfa',
        })
      );
    });

    it('should emit security event on failed verification', async () => {
      const { emitSecurityEvent } = require('../src/services/audit-service');
      
      await request(app)
        .post('/api/2fa/totp/verify')
        .send({ token: '000000', secret: testSecret })
        .expect(401);

      expect(emitSecurityEvent).toHaveBeenCalledWith(
        'mfa.totp_verification_failed',
        expect.objectContaining({
          severity: 'medium',
          actorId: 'test-user-123',
          resourceType: 'mfa',
        })
      );
    });

    it('should emit high severity event on lockout', async () => {
      const { emitSecurityEvent } = require('../src/services/audit-service');
      
      // Trigger lockout
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/2fa/totp/verify')
          .send({ token: '000000', secret: testSecret });
      }

      expect(emitSecurityEvent).toHaveBeenCalledWith(
        'mfa.failure_threshold_reached',
        expect.objectContaining({
          severity: 'high',
          actorId: 'test-user-123',
          resourceType: 'mfa',
        })
      );
    });
  });

  describe('Recovery Codes', () => {
    it('should generate recovery codes', async () => {
      const response = await request(app)
        .post('/api/2fa/recovery-codes/generate')
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.codes).toBeDefined();
      expect(response.body.data.codes.length).toBe(10);
    });

    it('should verify a recovery code', async () => {
      // First generate codes
      const generateResponse = await request(app)
        .post('/api/2fa/recovery-codes/generate')
        .expect(201);

      const code = generateResponse.body.data.codes[0];

      // Then verify one
      const response = await request(app)
        .post('/api/2fa/recovery-codes/verify')
        .send({ code })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should reject a used recovery code', async () => {
      // Generate codes
      const generateResponse = await request(app)
        .post('/api/2fa/recovery-codes/generate')
        .expect(201);

      const code = generateResponse.body.data.codes[0];

      // Use it once
      await request(app)
        .post('/api/2fa/recovery-codes/verify')
        .send({ code })
        .expect(200);

      // Try to use it again
      const response = await request(app)
        .post('/api/2fa/recovery-codes/verify')
        .send({ code })
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });
});
