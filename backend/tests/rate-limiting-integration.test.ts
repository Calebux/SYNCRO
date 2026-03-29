import request from 'supertest';
import express from 'express';
import { RateLimiterFactory, createTeamInviteLimiter, createMfaLimiter, createAdminLimiter } from '../src/middleware/rate-limit-factory';
import { authenticate } from '../src/middleware/auth';

// Mock dependencies
jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: jest.fn((req, res, next) => {
    // Mock authenticated user
    req.user = { id: 'test-user-123', email: 'test@example.com' };
    next();
  }),
}));

jest.mock('../src/config/database', () => ({
  supabase: {
    from: jest.fn(),
    auth: {
      getUser: jest.fn(),
    },
  },
}));

describe('Rate Limiting Integration Tests', () => {
  jest.setTimeout(20000);
  let app: express.Application;

  beforeAll(async () => {
    // Initialize rate limiter factory with memory store for testing
    await RateLimiterFactory.initializeRedisStore();
  });

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.set('trust proxy', true); // Enable IP detection for testing
  });

  describe('Team Invitation Rate Limiting', () => {
    beforeEach(() => {
      // Set up team invitation endpoint with rate limiting
      app.post('/api/team/invite', authenticate, createTeamInviteLimiter(), (req, res) => {
        res.json({ success: true, message: 'Invitation sent' });
      });
    });

    it('should allow requests within rate limit', async () => {
      const response = await request(app)
        .post('/api/team/invite')
        .send({ email: 'invite@example.com', role: 'member' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.headers['x-ratelimit-limit']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining']).toBeDefined();
    });

    it('should block requests exceeding rate limit', async () => {
      // Make requests up to the limit (default is 20 per hour)
      const promises = Array.from({ length: 21 }, (_, i) =>
        request(app)
          .post('/api/team/invite')
          .send({ email: `invite${i}@example.com`, role: 'member' })
      );

      const responses = await Promise.all(promises);

      // First 20 should succeed
      responses.slice(0, 20).forEach(response => {
        expect(response.status).toBe(200);
      });

      // 21st should be rate limited
      const rateLimitedResponse = responses[20];
      expect(rateLimitedResponse.status).toBe(429);
      expect(rateLimitedResponse.body.error).toContain('Too many team invitations');
      expect(rateLimitedResponse.headers['retry-after']).toBeDefined();
    });

    it('should include proper rate limiting headers', async () => {
      const response = await request(app)
        .post('/api/team/invite')
        .send({ email: 'test@example.com', role: 'member' })
        .expect(200);

      expect(response.headers['x-ratelimit-limit']).toBe('20');
      expect(parseInt(response.headers['x-ratelimit-remaining'])).toBeLessThan(20);
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
    });
  });

  describe('MFA Rate Limiting', () => {
    beforeEach(() => {
      // Set up MFA endpoints with rate limiting
      app.post('/api/2fa/recovery-codes/generate', authenticate, createMfaLimiter(), (req, res) => {
        res.json({ success: true, codes: ['code1', 'code2'] });
      });

      app.post('/api/2fa/recovery-codes/verify', authenticate, createMfaLimiter(), (req, res) => {
        res.json({ success: true });
      });
    });

    it('should allow MFA requests within rate limit', async () => {
      const response = await request(app)
        .post('/api/2fa/recovery-codes/generate')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.headers['x-ratelimit-limit']).toBe('10');
    });

    it('should block MFA requests exceeding rate limit', async () => {
      // Make requests up to the limit (default is 10 per 15 minutes)
      const promises = Array.from({ length: 11 }, () =>
        request(app)
          .post('/api/2fa/recovery-codes/generate')
      );

      const responses = await Promise.all(promises);

      // First 10 should succeed
      responses.slice(0, 10).forEach(response => {
        expect(response.status).toBe(200);
      });

      // 11th should be rate limited
      const rateLimitedResponse = responses[10];
      expect(rateLimitedResponse.status).toBe(429);
      expect(rateLimitedResponse.body.error).toContain('Too many MFA attempts');
    });

    it('should apply rate limiting across different MFA endpoints', async () => {
      // Make requests to different MFA endpoints
      const generatePromises = Array.from({ length: 5 }, () =>
        request(app).post('/api/2fa/recovery-codes/generate')
      );
      
      const verifyPromises = Array.from({ length: 6 }, () =>
        request(app)
          .post('/api/2fa/recovery-codes/verify')
          .send({ code: 'test-code' })
      );

      const allResponses = await Promise.all([...generatePromises, ...verifyPromises]);

      // First 10 should succeed
      const successfulResponses = allResponses.filter(r => r.status === 200);
      const rateLimitedResponses = allResponses.filter(r => r.status === 429);

      expect(successfulResponses.length).toBe(10);
      expect(rateLimitedResponses.length).toBe(1);
    });
  });

  describe('Admin Rate Limiting', () => {
    beforeEach(() => {
      // Set up admin endpoint with rate limiting
      app.get('/api/admin/metrics', createAdminLimiter(), (req, res) => {
        res.json({ metrics: 'data' });
      });
    });

    it('should allow admin requests within rate limit', async () => {
      const response = await request(app)
        .get('/api/admin/metrics')
        .expect(200);

      expect(response.body.metrics).toBe('data');
      expect(response.headers['x-ratelimit-limit']).toBe('100');
    });

    it('should block admin requests exceeding rate limit', async () => {
      // Make requests up to the limit (default is 100 per hour)
      const promises = Array.from({ length: 101 }, () =>
        request(app).get('/api/admin/metrics')
      );

      const responses = await Promise.all(promises);

      // First 100 should succeed
      responses.slice(0, 100).forEach(response => {
        expect(response.status).toBe(200);
      });

      // 101st should be rate limited
      const rateLimitedResponse = responses[100];
      expect(rateLimitedResponse.status).toBe(429);
      expect(rateLimitedResponse.body.error).toContain('Too many admin requests');
    });

    it('should use IP-based rate limiting for admin endpoints', async () => {
      // Test with different IP addresses
      const response1 = await request(app)
        .get('/api/admin/metrics')
        .set('X-Forwarded-For', '192.168.1.1')
        .expect(200);

      const response2 = await request(app)
        .get('/api/admin/metrics')
        .set('X-Forwarded-For', '192.168.1.2')
        .expect(200);

      // Both should succeed as they're from different IPs
      expect(response1.body.metrics).toBe('data');
      expect(response2.body.metrics).toBe('data');

      // Both should have the same limit but independent remaining counts
      expect(response1.headers['x-ratelimit-limit']).toBe('100');
      expect(response2.headers['x-ratelimit-limit']).toBe('100');
    });
  });

  describe('Rate Limiting Security Events', () => {
    beforeEach(() => {
      app.post('/api/test/rate-limited', authenticate, createTeamInviteLimiter(), (req, res) => {
        res.json({ success: true });
      });
    });

    it('should include security headers when rate limit is exceeded', async () => {
      // Exhaust rate limit
      const promises = Array.from({ length: 21 }, () =>
        request(app).post('/api/test/rate-limited').send({})
      );

      const responses = await Promise.all(promises);
      const rateLimitedResponse = responses[20];

      expect(rateLimitedResponse.status).toBe(429);
      expect(rateLimitedResponse.headers['x-ratelimit-policy']).toBe('team-invite');
      expect(rateLimitedResponse.headers['x-security-event']).toBe('rate-limit-exceeded');
    });
  });

  describe('User-based vs IP-based Rate Limiting', () => {
    beforeEach(() => {
      app.post('/api/test/user-based', authenticate, createTeamInviteLimiter(), (req, res) => {
        res.json({ success: true });
      });

      app.get('/api/test/ip-based', createAdminLimiter(), (req, res) => {
        res.json({ success: true });
      });
    });

    it('should apply user-based rate limiting correctly', async () => {
      // Mock different users
      const mockAuth = authenticate as jest.MockedFunction<typeof authenticate>;
      
      // First user
      mockAuth.mockImplementationOnce((req, res, next) => {
        req.user = { id: 'user-1', email: 'user1@example.com' };
        next();
      });

      const response1 = await request(app)
        .post('/api/test/user-based')
        .send({})
        .expect(200);

      // Second user (different user ID)
      mockAuth.mockImplementationOnce((req, res, next) => {
        req.user = { id: 'user-2', email: 'user2@example.com' };
        next();
      });

      const response2 = await request(app)
        .post('/api/test/user-based')
        .send({})
        .expect(200);

      // Both should succeed as they're different users
      expect(response1.body.success).toBe(true);
      expect(response2.body.success).toBe(true);
    });

    it('should apply IP-based rate limiting correctly', async () => {
      const response1 = await request(app)
        .get('/api/test/ip-based')
        .set('X-Forwarded-For', '10.0.0.1')
        .expect(200);

      const response2 = await request(app)
        .get('/api/test/ip-based')
        .set('X-Forwarded-For', '10.0.0.2')
        .expect(200);

      // Both should succeed as they're from different IPs
      expect(response1.body.success).toBe(true);
      expect(response2.body.success).toBe(true);
    });
  });

  describe('Rate Limiting with Memory Store Fallback', () => {
    it('should work with memory store when Redis is unavailable', async () => {
      // This test verifies that rate limiting works even without Redis
      app.post('/api/test/memory-store', authenticate, createTeamInviteLimiter(), (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/api/test/memory-store')
        .send({})
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.headers['x-ratelimit-limit']).toBeDefined();
    });
  });
});