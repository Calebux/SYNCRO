import { test, expect } from '@playwright/test';
import { bootstrapMockAuthenticatedUi } from './helpers';

test.describe('Offline experience', () => {
  test('displays the offline banner when the browser goes offline', async ({ page, context }) => {
    await bootstrapMockAuthenticatedUi(page);

    await context.setOffline(true);
    await expect(page.getByText("You're currently offline. Some features may not work.")).toBeVisible();

    await context.setOffline(false);
    await expect(page.getByText("You're currently offline. Some features may not work.")).toHaveCount(0);
  });

  test('renders the offline fallback page content', async ({ page }) => {
    await page.goto('/offline');

    await expect(page.getByRole('heading', { name: "You're Offline" })).toBeVisible();
    await expect(page.getByText('Cached Subscriptions')).toBeVisible();
    await expect(page.getByRole('button', { name: /Try Again/i })).toBeVisible();
  });
});
