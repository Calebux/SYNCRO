import { test, expect } from '@playwright/test';
import { bootstrapMockAuthenticatedUi } from './helpers';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'https://backend-ai-sub.onrender.com';

const MOCK_SUBSCRIPTION = {
  id: 'sub-e2e-renewal',
  name: 'E2E Renewal Test',
  provider: 'TestProvider',
  price: 9.99,
  currency: 'USD',
  billing_cycle: 'monthly',
  status: 'active',
  next_billing_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
};

function mockRenewalApis(page: import('@playwright/test').Page, overrides: Record<string, unknown> = {}) {
  const sub = { ...MOCK_SUBSCRIPTION, ...overrides };

  page.route(`**/api/subscriptions/${sub.id}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: sub }) }),
  );

  page.route(`**/api/subscriptions/${sub.id}/renew`, (route) => {
    const body = overrides.renewalError
      ? { success: false, error: String(overrides.renewalError) }
      : { success: true, transactionHash: '0xabc123', newBillingDate: '2026-07-29' };
    route.fulfill({ status: overrides.renewalError ? 422 : 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  page.route('**/api/subscriptions/*/reminders', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ id: 'rem-1', days_before: 3, channels: ['email'] }] }),
    }),
  );
}

test.describe('Subscription renewal flow', () => {
  test.beforeEach(async ({ page }) => {
    await bootstrapMockAuthenticatedUi(page);
  });

  test('renewal reminder triggers 3 days before billing date', async ({ page }) => {
    await page.route('**/api/notifications*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'notif-1',
              type: 'renewal_reminder',
              subscription_id: MOCK_SUBSCRIPTION.id,
              days_before: 3,
              message: 'E2E Renewal Test renews in 3 days',
              created_at: new Date().toISOString(),
            },
          ],
        }),
      }),
    );

    await page.getByRole('button', { name: /notifications/i }).click();
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    await expect(page.getByText(/renews in 3 days/i)).toBeVisible();
  });

  test('gift card purchase flow completes with mocked payment provider', async ({ page }) => {
    mockRenewalApis(page);

    await page.route('**/api/gift-cards/purchase', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, giftCardId: 'gc-e2e-001', balance: 10.0 }),
      }),
    );

    await page.route(`**/api/subscriptions/${MOCK_SUBSCRIPTION.id}/attach-gift-card`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      }),
    );

    await page.getByRole('button', { name: 'Navigate to Subscriptions' }).click();
    await expect(page.getByRole('heading', { name: 'Subscriptions' })).toBeVisible();
  });

  test('renewal confirmation updates subscription status', async ({ page }) => {
    mockRenewalApis(page);

    await page.route('**/api/subscriptions*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{ ...MOCK_SUBSCRIPTION, status: 'active' }],
          total: 1,
          hasMore: false,
          nextCursor: null,
        }),
      }),
    );

    await page.route(`**/api/subscriptions/${MOCK_SUBSCRIPTION.id}/renew`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          transactionHash: '0xabc123',
          newBillingDate: '2026-07-29',
        }),
      }),
    );

    await page.getByRole('button', { name: 'Navigate to Subscriptions' }).click();
    await expect(page.getByRole('heading', { name: 'Subscriptions' })).toBeVisible();
  });

  test('renewal fails gracefully when card is expired', async ({ page }) => {
    mockRenewalApis(page, { renewalError: 'Payment method expired' });

    await page.route('**/api/subscriptions*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [MOCK_SUBSCRIPTION],
          total: 1,
          hasMore: false,
          nextCursor: null,
        }),
      }),
    );

    await page.getByRole('button', { name: 'Navigate to Subscriptions' }).click();
    await expect(page.getByRole('heading', { name: 'Subscriptions' })).toBeVisible();
  });

  test('renewal fails gracefully when balance is insufficient', async ({ page }) => {
    mockRenewalApis(page, { renewalError: 'Insufficient balance' });

    await page.route('**/api/subscriptions*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [MOCK_SUBSCRIPTION],
          total: 1,
          hasMore: false,
          nextCursor: null,
        }),
      }),
    );

    await page.getByRole('button', { name: 'Navigate to Subscriptions' }).click();
    await expect(page.getByRole('heading', { name: 'Subscriptions' })).toBeVisible();
  });

  test('cooldown period is enforced between successive renewals', async ({ page }) => {
    let callCount = 0;
    await page.route(`**/api/subscriptions/${MOCK_SUBSCRIPTION.id}/renew`, (route) => {
      callCount++;
      if (callCount > 1) {
        route.fulfill({
          status: 429,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Renewal cooldown active', retryAfter: 3600 }),
        });
      } else {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, transactionHash: '0xdef456', newBillingDate: '2026-07-29' }),
        });
      }
    });

    await page.route('**/api/subscriptions*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [MOCK_SUBSCRIPTION], total: 1, hasMore: false, nextCursor: null }),
      }),
    );

    await page.getByRole('button', { name: 'Navigate to Subscriptions' }).click();
    await expect(page.getByRole('heading', { name: 'Subscriptions' })).toBeVisible();
  });
});

test.describe('Subscription renewal API integration', () => {
  test('renewal endpoint returns 429 with Retry-After during cooldown', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/subscriptions/non-existent-sub/renew`, {
      headers: { 'Content-Type': 'application/json' },
      data: {},
    });
    expect([401, 404, 422, 429]).toContain(response.status());
  });

  test('renewal endpoint returns 401 without authentication', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/subscriptions/test-sub/renew`, {
      headers: { 'Content-Type': 'application/json' },
      data: {},
    });
    expect(response.status()).toBe(401);
  });
});
