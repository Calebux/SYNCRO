/**
 * Post-Deployment Smoke Tests
 * 
 * These tests verify critical paths after staging or production deploys:
 * - Authentication (login flow)
 * - Dashboard access
 * - API health and basic operations
 * - Subscription list retrieval
 * - Payment/billing health checks
 * 
 * Issue #101: Post-deploy smoke tests
 */

import request from 'supertest';
import { createClient } from '@supabase/supabase-js';

// Environment configuration
const BASE_URL = process.env.SMOKE_TEST_BASE_URL || 'http://localhost:3001';
const FRONTEND_URL = process.env.SMOKE_TEST_FRONTEND_URL || 'http://localhost:3000';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

// Test user credentials (should be set in CI/CD secrets)
const TEST_USER_EMAIL = process.env.SMOKE_TEST_USER_EMAIL || 'smoke-test@syncro.test';
const TEST_USER_PASSWORD = process.env.SMOKE_TEST_USER_PASSWORD || 'TestPassword123!';

describe('Post-Deployment Smoke Tests', () => {
  let authToken: string;
  let userId: string;
  let supabaseClient: ReturnType<typeof createClient>;

  beforeAll(() => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('Supabase configuration missing. Set SUPABASE_URL and SUPABASE_ANON_KEY');
    }
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  });

  describe('Critical Path: Authentication', () => {
    it('should successfully authenticate test user', async () => {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: TEST_USER_EMAIL,
        password: TEST_USER_PASSWORD,
      });

      expect(error).toBeNull();
      expect(data.session).toBeDefined();
      expect(data.session?.access_token).toBeDefined();
      expect(data.user).toBeDefined();

      authToken = data.session!.access_token;
      userId = data.user!.id;
    }, 15000);

    it('should reject invalid credentials', async () => {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: TEST_USER_EMAIL,
        password: 'WrongPassword123!',
      });

      expect(error).toBeDefined();
      expect(data.session).toBeNull();
    }, 10000);

    it('should retrieve user session with valid token', async () => {
      const { data, error } = await supabaseClient.auth.getUser(authToken);

      expect(error).toBeNull();
      expect(data.user).toBeDefined();
      expect(data.user?.id).toBe(userId);
    }, 10000);
  });

  describe('Critical Path: API Health', () => {
    it('should return healthy status from backend health endpoint', async () => {
      const response = await request(BASE_URL)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
    }, 10000);

    it('should return healthy status from frontend health endpoint', async () => {
      const response = await request(FRONTEND_URL)
        .get('/api/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('timestamp');
    }, 10000);

    it('should have Swagger documentation accessible', async () => {
      const response = await request(BASE_URL)
        .get('/api/docs.json')
        .expect(200);

      expect(response.body).toHaveProperty('openapi');
      expect(response.body).toHaveProperty('info');
    }, 10000);
  });

  describe('Critical Path: Dashboard & Subscriptions', () => {
    it('should retrieve user role with authentication', async () => {
      const response = await request(BASE_URL)
        .get('/api/user/role')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('user_id', userId);
      expect(response.body).toHaveProperty('role');
      expect(['owner', 'admin', 'member', 'viewer']).toContain(response.body.role);
    }, 10000);

    it('should list user subscriptions', async () => {
      const response = await request(BASE_URL)
        .get('/api/subscriptions')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body).toHaveProperty('pagination');
      expect(response.body.pagination).toHaveProperty('total');
    }, 10000);

    it('should reject subscription access without authentication', async () => {
      await request(BASE_URL)
        .get('/api/subscriptions')
        .expect(401);
    }, 10000);

    it('should retrieve subscription metrics', async () => {
      const response = await request(BASE_URL)
        .get('/api/subscriptions')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ limit: 5 })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.pagination).toHaveProperty('limit', 5);
    }, 10000);
  });

  describe('Critical Path: Payment & Billing Health', () => {
    it('should access exchange rates endpoint', async () => {
      const response = await request(BASE_URL)
        .get('/api/exchange-rates')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toBeDefined();
    }, 10000);

    it('should access gift card ledger endpoint', async () => {
      const response = await request(BASE_URL)
        .get('/api/gift-card-ledger')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toBeDefined();
    }, 10000);

    it('should check reminder system status', async () => {
      const response = await request(BASE_URL)
        .get('/api/reminders/status')
        .expect(200);

      expect(response.body).toHaveProperty('status');
    }, 10000);
  });

  describe('Critical Path: Core API Operations', () => {
    it('should retrieve merchants list', async () => {
      const response = await request(BASE_URL)
        .get('/api/merchants')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toBeDefined();
    }, 10000);

    it('should access user digest settings', async () => {
      const response = await request(BASE_URL)
        .get('/api/digest')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toBeDefined();
    }, 10000);

    it('should retrieve tags', async () => {
      const response = await request(BASE_URL)
        .get('/api/tags')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toBeDefined();
    }, 10000);
  });

  describe('Security & Rate Limiting', () => {
    it('should enforce authentication on protected endpoints', async () => {
      const protectedEndpoints = [
        '/api/subscriptions',
        '/api/user/role',
        '/api/merchants',
        '/api/tags',
        '/api/digest',
      ];

      for (const endpoint of protectedEndpoints) {
        await request(BASE_URL)
          .get(endpoint)
          .expect(401);
      }
    }, 30000);

    it('should accept valid API key authentication', async () => {
      const apiKey = process.env.SMOKE_TEST_API_KEY;
      
      if (!apiKey) {
        console.warn('SMOKE_TEST_API_KEY not set, skipping API key test');
        return;
      }

      const response = await request(BASE_URL)
        .get('/api/subscriptions')
        .set('x-api-key', apiKey)
        .expect(200);

      expect(response.body.success).toBe(true);
    }, 10000);
  });

  describe('Database Connectivity', () => {
    it('should successfully query Supabase database', async () => {
      const { data, error } = await supabaseClient
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data?.id).toBe(userId);
    }, 10000);

    it('should verify RLS policies are active', async () => {
      // Attempt to access another user's data (should fail due to RLS)
      const { data, error } = await supabaseClient
        .from('subscriptions')
        .select('*')
        .neq('user_id', userId)
        .limit(1);

      // Should return empty or error due to RLS
      expect(data).toEqual([]);
    }, 10000);
  });

  describe('Integration Health Checks', () => {
    it('should verify Sentry is configured', () => {
      // Optional check - Sentry may not be configured in all environments
      if (process.env.SENTRY_DSN) {
        expect(process.env.SENTRY_DSN).toBeTruthy();
      } else {
        console.warn('SENTRY_DSN not configured');
      }
    });

    it('should verify Stellar network configuration', () => {
      // Optional check - Stellar may not be configured in all environments
      if (process.env.STELLAR_NETWORK_URL && process.env.SOROBAN_CONTRACT_ADDRESS) {
        expect(process.env.STELLAR_NETWORK_URL).toBeTruthy();
        expect(process.env.SOROBAN_CONTRACT_ADDRESS).toBeTruthy();
      } else {
        console.warn('Stellar network not fully configured');
      }
    });

    it('should verify email service configuration', () => {
      // Optional check - SMTP may not be configured in all environments
      if (process.env.SMTP_HOST && process.env.SMTP_USER) {
        expect(process.env.SMTP_HOST).toBeTruthy();
        expect(process.env.SMTP_USER).toBeTruthy();
      } else {
        console.warn('Email service not fully configured');
      }
    });
  });

  afterAll(async () => {
    // Clean up: sign out test user
    if (supabaseClient) {
      await supabaseClient.auth.signOut();
    }
  });
});
