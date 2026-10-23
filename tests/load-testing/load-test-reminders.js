import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_BASE = `${BASE_URL}/api`;
const ADMIN_KEY = __ENV.ADMIN_API_KEY || '';

const reminderFailRate = new Rate('reminder_errors');
const scheduleDuration = new Trend('schedule_duration');
const processDuration = new Trend('process_duration');
const retryDuration = new Trend('retry_duration');

export const options = {
  scenarios: {
    reminder_schedule: {
      executor: 'per-vu-iterations',
      vus: 10,
      iterations: 20,
      maxDuration: '5m',
      tags: { scenario: 'schedule' },
    },
    reminder_process: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 5 },
        { duration: '60s', target: 20 },
        { duration: '30s', target: 0 },
      ],
      tags: { scenario: 'process' },
    },
    reminder_retry: {
      executor: 'constant-vus',
      vus: 5,
      duration: '2m',
      tags: { scenario: 'retry' },
    },
    reminder_status: {
      executor: 'constant-vus',
      vus: 50,
      duration: '3m',
      tags: { scenario: 'status' },
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<5000'],
    'http_req_duration{scenario:scheduled}': ['p(95)<10000'],
    'http_req_duration{scenario:process}': ['p(95)<10000'],
    'http_req_duration{scenario:retry}': ['p(95)<10000'],
    'http_req_duration{scenario:status}': ['p(95)<500'],
    reminder_errors: ['rate<0.1'],
    checks: ['rate>0.90'],
  },
};

function adminHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-admin-api-key': ADMIN_KEY,
  };
}

export function reminder_schedule() {
  const payload = JSON.stringify({ daysBefore: [7, 3, 1] });
  const res = http.post(`${API_BASE}/reminders/schedule`, payload, {
    headers: adminHeaders(),
    tags: { scenario: 'schedule' },
  });
  scheduleDuration.add(res.timings.duration);
  const ok = check(res, {
    'schedule status 200': (r) => r.status === 200,
    'schedule success true': (r) => {
      try { return JSON.parse(r.body).success === true; } catch { return false; }
    },
  });
  reminderFailRate.add(!ok);
  sleep(1);
}

export function reminder_process() {
  const res = http.post(`${API_BASE}/reminders/process`, null, {
    headers: adminHeaders(),
    tags: { scenario: 'process' },
  });
  processDuration.add(res.timings.duration);
  const ok = check(res, {
    'process status 200': (r) => r.status === 200,
    'process success true': (r) => {
      try { return JSON.parse(r.body).success === true; } catch { return false; }
    },
  });
  reminderFailRate.add(!ok);
  sleep(2);
}

export function reminder_retry() {
  const res = http.post(`${API_BASE}/reminders/retry`, null, {
    headers: adminHeaders(),
    tags: { scenario: 'retry' },
  });
  retryDuration.add(res.timings.duration);
  const ok = check(res, {
    'retry status 200': (r) => r.status === 200,
    'retry success true': (r) => {
      try { return JSON.parse(r.body).success === true; } catch { return false; }
    },
  });
  reminderFailRate.add(!ok);
  sleep(3);
}

export function reminder_status() {
  const res = http.get(`${API_BASE}/reminders/status`, {
    tags: { scenario: 'status' },
  });
  check(res, {
    'status 200': (r) => r.status === 200,
    'status has scheduler': (r) => {
      try { return JSON.parse(r.body) !== null; } catch { return false; }
    },
  });
}

export default function () {
  const scenario = __ENV.SCENARIO || 'status';
  if (scenario === 'schedule') reminder_schedule();
  else if (scenario === 'process') reminder_process();
  else if (scenario === 'retry') reminder_retry();
  else reminder_status();
}