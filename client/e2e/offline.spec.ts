import { test, expect } from '@playwright/test';

test.describe('Offline experience', () => {
  test('renders the offline fallback page content', async ({ page }) => {
    await page.goto('/offline');

    await expect(page.getByRole('heading', { name: "You're Offline" })).toBeVisible();
    await expect(page.getByRole('button', { name: /Retry Connection/i })).toBeVisible();
  });
});
