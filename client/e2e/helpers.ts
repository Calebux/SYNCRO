import { expect, type APIRequestContext } from '@playwright/test';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'https://backend-ai-sub.onrender.com';

export function makeTestUser() {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    email: `e2e+${stamp}@example.com`,
    password: 'SecurePass123!',
    name: 'E2E Test User',
  };
}

export async function signupViaApi(request: APIRequestContext, user: { email: string; password: string; name: string }) {
  const response = await request.post(`${API_BASE}/api/auth/signup`, {
    data: user,
  });

  expect(response.ok()).toBeTruthy();
  return response;
}

export async function loginViaApi(request: APIRequestContext, user: { email: string; password: string }) {
  const response = await request.post(`${API_BASE}/api/auth/login`, {
    data: {
      email: user.email,
      password: user.password,
    },
  });

  expect(response.ok()).toBeTruthy();
  return response;
}
