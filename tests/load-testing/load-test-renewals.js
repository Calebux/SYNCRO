import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_BASE = `${BASE_URL}/api`;
const AUTH_TOKEN = __ENV.AUTH_TOKEN || 'test-token-123';
const ADMIN_KEY = __ENV.ADMIN_API_KEY || '';

const renewalFailRate = new Rate('renewal_errors');
const renewalDuration = new Trend('renewal_duration');
const dlqDuration = new Trend('dlq_duration');
const metricsDuration = new Trend('metrics_duration');

export const options = {
  scenarios: {
    renewal_execution: {
      executor: 'per-vu-iterations',
      vus: 20,
      iterations: 100,
      maxDuration: '10m',
      tags: { scenario: 'renewal_execution' },
    },
    dead_letter_query: {
      executor: 'constant-vus',
      vus: 10,
      duration: '3m',
      tags: { scenario: 'dead_letter' },
    },
    renewal_metrics: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 5 },
        { duration: '60s', target: 30 },
        { duration: '30s', target: 0 },
      ],
      tags: { scenario: 'metrics' },
    },
  },
  thresholds: {
    'http_req_duration{scenario:renewal_execution}': ['p(95)<5000'],
    'http_req_duration{scenario:dead_letter}': ['p(95)<1000'],
    'http_req_duration{scenario:metrics}': ['p(95)<1000'],
    http_req_duration: ['p(99)<10000'],
    renewal_errors: ['rate<0.1'],
    checks: ['rate>0.90'],
  },
};

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${AUTH_TOKEN}`,
  };
}

function adminHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-admin-api-key': ADMIN_KEY,
  };
}

const SUBSCRIPTION_IDS = Array.from({ length: 100 }, (_, i) => `sub-${String(i + 1).padStart(9, '0')}`);

export function renewal_execution() {
  const subId = SUBSCRIPTION_IDS[Math.floor(Math.random() * SUBSCRIPTION_IDS.length)];
  const payload = JSON.stringify({
    subscriptionId: subId,
    userId: 'loadtest-user-001',
    approvalId: `approval-${__VU}-${__ITER}`,
    amount: 9.99,
    billingDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const res = http.post(`${API_BASE}/subscriptions/${subId}/renew`, payload, {
    headers: { ...authHeaders(), ...adminHeaders() },
    tags: { scenario: 'renewal_execution' },
  });
  renewalDuration.add(res.timings.duration);
  const ok = check(res, {
    'renewal status 200 or 409': (r) => r.status === 200 || r.status === 409,
    'renewal has idempotency key': (r) => {
      try { const b = JSON.parse(r.body); return b.idempotencyKey || b.skipped !== undefined; } catch { return false; }
    },
  });
  renewalFailRate.add(!ok);
  sleep(2);
}

export function dead_letter_query() {
  const res = http.get(`${API_BASE}/renewals/dead-letter/stats`, {
    headers: adminHeaders(),
    tags: { scenario: 'dead_letter' },
  });
  dlqDuration.add(res.timings.duration);
  check(res, {
    'dead-letter stats 200': (r) => r.status === 200,
    'dead-letter has stats': (r) => {
      try { const b = JSON.parse(r.body); return b.total !== undefined || b.count !== undefined; } catch { return false; }
    },
  });
  sleep(0.5);
}

export function renewal_metrics() {
  const res = http.get(`${API_BASE}/admin/metrics/renewals`, {
    headers: adminHeaders(),
    tags: { scenario: 'metrics' },
  });
  metricsDuration.add(res.timings.duration);
  check(res, {
    'renewal metrics 200': (r) => r.status === 200,
    'metrics contains renewal data': (r) => {
      try { const b = JSON.parse(r.body); return b !== null; } catch { return false; }
    },
  });
  sleep(0.5);
}

export default function () {
  const scenario = __ENV.SCENARIO || 'renewal_execution';
  if (scenario === 'renewal_execution') renewal_execution();
  else if (scenario === 'dead_letter_query') dead_letter_query();
  else if (scenario === 'renewal_metrics') renewal_metrics();
}
