import { expect, type APIRequestContext, type Page } from '@playwright/test';

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

export async function bootstrapMockAuthenticatedUi(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('onboarding_completed', 'true');
  });

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 'e2e-mock-user',
          email: 'e2e@example.com',
          name: 'E2E User',
        },
      }),
    });
  });

  await page.goto('/');

  const individualButton = page.getByRole('button', { name: /continue as individual/i });
  if (await individualButton.isVisible()) {
    await individualButton.click();
  }

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

export async function openSubscriptions(page: Page) {
  await page.getByRole('button', { name: 'Navigate to Subscriptions' }).click();
  await expect(page.getByRole('heading', { name: 'Subscriptions' })).toBeVisible();
}

export async function addCustomSubscription(page: Page, name: string, price: string) {
  await openSubscriptions(page);
  await page.getByRole('button', { name: /add subscription/i }).click();
  await page.getByRole('button', { name: /add custom subscription/i }).click();
  await page.getByLabel(/subscription name/i).fill(name);
  await page.getByLabel(/monthly price/i).fill(price);
  await page.getByRole('button', { name: /add to dashboard/i }).click();
  await expect(page.getByText(name).first()).toBeVisible();
}
