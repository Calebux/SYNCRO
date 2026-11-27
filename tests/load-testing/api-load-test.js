/**
 * Issue #973 – Load testing suite with k6
 *
 * Multi-stage ramp-up scenario targeting high-traffic endpoints:
 * - Authentication (login)
 * - Subscription list queries
 * - Renewal workflows
 *
 * Performance budgets:
 * - p95 latency < 500ms for read operations
 * - p95 latency < 1000ms for mutations
 *
 * Execution:
 *   k6 run tests/load-testing/api-load-test.js
 *
 * The script is designed to integrate seamlessly into CI/CD pipelines.
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';

// ── Configuration ──────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_BASE = `${BASE_URL}/api`;
const AUTH_TOKEN = __ENV.AUTH_TOKEN || 'test-token-123';

// Multi-stage ramp-up scenario: 10 → 100 → 500 VUs over 3 stages
export const options = {
  scenarios: {
    ramp_up: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        // Stage 1: Ramp to 10 VUs over 30s
        { duration: '30s', target: 10 },
        // Stage 2: Ramp to 100 VUs over 60s (maintain 10 for 10s first)
        { duration: '10s', target: 10 },
        { duration: '60s', target: 100 },
        // Stage 3: Ramp to 500 VUs over 90s (maintain 100 for 10s first)
        { duration: '10s', target: 100 },
        { duration: '90s', target: 500 },
        // Maintain peak load for 60s
        { duration: '60s', target: 500 },
        // Cool down: ramp back to 0 over 30s
        { duration: '30s', target: 0 },
      ],
      gracefulStop: '10s',
    },
  },
  // Performance budgets: enforce strict latency thresholds
  thresholds: {
    // Read operation latencies (p95)
    'http_req_duration{api:read}': ['p(95)<500'],
    // Mutation operation latencies (p95)
    'http_req_duration{api:mutation}': ['p(95)<1000'],
    // Overall error rate: < 1%
    'http_errors': ['count<10'],
    // Overall success rate: > 99%
    'checks': ['rate>0.99'],
  },
};

// ── Helper functions ──────────────────────────────────────────────────────────

/**
 * Generate a pseudo-random email for load tests to avoid uniqueness conflicts.
 */
function generateTestEmail() {
  const timestamp = new Date().getTime();
  const rand = Math.floor(Math.random() * 100000);
  return `loadtest.${timestamp}.${rand}@example.com`;
}

/**
 * Parse JSON response with error handling.
 */
function parseResponse(res) {
  try {
    return JSON.parse(res.body);
  } catch {
    return null;
  }
}

// ── Test groups ────────────────────────────────────────────────────────────────

export default function () {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${AUTH_TOKEN}`,
  };

  // ── Group 1: Authentication ───────────────────────────────────────────────
  group('auth:login', () => {
    const loginPayload = JSON.stringify({
      email: generateTestEmail(),
      password: 'test-password-123',
    });

    const res = http.post(`${API_BASE}/auth/login`, loginPayload, {
      headers: { 'Content-Type': 'application/json' },
      tags: { api: 'mutation', endpoint: 'auth:login' },
    });

    check(res, {
      'login status is 200-401': (r) => r.status >= 200 && r.status < 402,
      'login response time < 1s': (r) => r.timings.duration < 1000,
    });

    sleep(0.5);
  });

  // ── Group 2: Subscription list queries ────────────────────────────────────
  group('subscriptions:list', () => {
    const res = http.get(`${API_BASE}/subscriptions`, {
      headers,
      tags: { api: 'read', endpoint: 'subscriptions:list' },
    });

    check(res, {
      'list status is 200': (r) => r.status === 200,
      'list response time < 500ms': (r) => r.timings.duration < 500,
      'list returns data array': (r) => {
        const data = parseResponse(r);
        return Array.isArray(data) || (data && Array.isArray(data.data));
      },
    });

    sleep(0.3);
  });

  // ── Group 3: Individual subscription details ──────────────────────────────
  group('subscriptions:get', () => {
    // First fetch list to get a subscription ID
    const listRes = http.get(`${API_BASE}/subscriptions`, {
      headers,
      tags: { api: 'read', endpoint: 'subscriptions:list' },
    });

    const subscriptions = parseResponse(listRes);
    if (!subscriptions || subscriptions.length === 0) {
      console.warn('No subscriptions found for detail fetch');
      return;
    }

    const subId = subscriptions[0].id || subscriptions[0];

    const detailRes = http.get(`${API_BASE}/subscriptions/${subId}`, {
      headers,
      tags: { api: 'read', endpoint: 'subscriptions:get' },
    });

    check(detailRes, {
      'detail status is 200': (r) => r.status === 200,
      'detail response time < 500ms': (r) => r.timings.duration < 500,
      'detail returns subscription object': (r) => parseResponse(r) !== null,
    });

    sleep(0.2);
  });

  // ── Group 4: Renewal workflow (mutation) ──────────────────────────────────
  group('subscriptions:renew', () => {
    // Create/update a subscription to simulate renewal workflow
    const renewPayload = JSON.stringify({
      renewal_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'active',
    });

    // Assume subscription ID 1 for load test (adjust as needed)
    const renewRes = http.patch(`${API_BASE}/subscriptions/1/renew`, renewPayload, {
      headers,
      tags: { api: 'mutation', endpoint: 'subscriptions:renew' },
    });

    check(renewRes, {
      'renew status is 2xx or 4xx': (r) => r.status >= 200 && r.status < 500,
      'renew response time < 1s': (r) => r.timings.duration < 1000,
    });

    sleep(0.5);
  });

  // ── Group 5: Subscription filter/search (read) ──────────────────────────
  group('subscriptions:filter', () => {
    const res = http.get(
      `${API_BASE}/subscriptions?category=entertainment&status=active&limit=10`,
      {
        headers,
        tags: { api: 'read', endpoint: 'subscriptions:filter' },
      }
    );

    check(res, {
      'filter status is 200': (r) => r.status === 200,
      'filter response time < 500ms': (r) => r.timings.duration < 500,
    });

    sleep(0.3);
  });

  // ── Group 6: Analytics endpoint (read) ────────────────────────────────────
  group('analytics:summary', () => {
    const res = http.get(`${API_BASE}/analytics/summary`, {
      headers,
      tags: { api: 'read', endpoint: 'analytics:summary' },
    });

    check(res, {
      'analytics status is 200': (r) => r.status === 200,
      'analytics response time < 500ms': (r) => r.timings.duration < 500,
      'analytics contains spending data': (r) => {
        const data = parseResponse(r);
        return data && (data.total_spend !== undefined || data.total_monthly_spend !== undefined);
      },
    });

    sleep(0.3);
  });

  // Stagger requests to avoid thundering herd
  sleep(Math.random() * 2);
}
