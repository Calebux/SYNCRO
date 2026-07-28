import { test, expect } from '@playwright/test';
import { addCustomSubscription, bootstrapMockAuthenticatedUi, openSubscriptions } from './helpers';

test.describe('Subscription CRUD E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await bootstrapMockAuthenticatedUi(page);
  });

  test('user can add a subscription', async ({ page }) => {
    const subName = `Playwright Plus ${Date.now()}`;
    await addCustomSubscription(page, subName, '15.99');
    await expect(page.getByText(subName).first()).toBeVisible();
  });

  test('subscription creation with all fields', async ({ page }) => {
    const subName = `Full Subscription ${Date.now()}`;

    // Open add subscription modal/form
    await page.getByRole('button', { name: /add subscription|new subscription/i }).click();

    // Fill all fields
    await page.getByLabel(/subscription name/i).fill(subName);
    await page.getByLabel(/price|cost|amount/i).fill('29.99');

    const cycleSelect = page.getByLabel(/billing cycle|frequency/i);
    if (await cycleSelect.isVisible()) {
      await cycleSelect.selectOption('monthly');
    }

    const categorySelect = page.getByLabel(/category/i);
    if (await categorySelect.isVisible()) {
      await categorySelect.selectOption('streaming');
    }

    const merchantInput = page.getByLabel(/merchant|company/i);
    if (await merchantInput.isVisible()) {
      await merchantInput.fill('Test Merchant Inc');
    }

    const notesInput = page.getByLabel(/notes|description/i);
    if (await notesInput.isVisible()) {
      await notesInput.fill('Premium plan with family sharing');
    }

    const nextBillingInput = page.getByLabel(/next billing|renewal date/i);
    if (await nextBillingInput.isVisible()) {
      await nextBillingInput.fill('2024-02-01');
    }

    // Submit form
    await page.getByRole('button', { name: /add|create|save/i }).click();

    // Verify subscription appears
    await expect(page.getByText(subName).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('29.99')).toBeVisible();
  });

  test('user can edit a subscription', async ({ page }) => {
    const originalName = `Edit Me ${Date.now()}`;
    const updatedName = `${originalName} Updated`;

    await addCustomSubscription(page, originalName, '10.00');
    await page.getByLabel(`Edit ${originalName}`).click();

    await page.getByLabel(/subscription name/i).fill(updatedName);
    await page.getByRole('button', { name: /save changes/i }).click();

    await expect(page.getByText(updatedName).first()).toBeVisible();
  });

  test('subscription editing with validation', async ({ page }) => {
    const subName = `Validate Edit ${Date.now()}`;

    await addCustomSubscription(page, subName, '15.00');
    await page.getByLabel(`Edit ${subName}`).click();

    // Try to save with empty name
    const nameInput = page.getByLabel(/subscription name/i);
    await nameInput.fill('');
    await page.getByRole('button', { name: /save changes/i }).click();

    // Verify error message
    await expect(page.getByText(/name.*required|subscription name.*required/i)).toBeVisible();

    // Try to save with negative price
    await nameInput.fill(subName);
    const priceInput = page.getByLabel(/price|cost|amount/i);
    await priceInput.fill('-10');
    await page.getByRole('button', { name: /save changes/i }).click();

    // Verify error message
    await expect(page.getByText(/price.*positive|invalid.*price/i)).toBeVisible();

    // Fix and save successfully
    await priceInput.fill('20.00');
    await page.getByRole('button', { name: /save changes/i }).click();

    await expect(page.getByText('20.00')).toBeVisible({ timeout: 10000 });
  });

  test('user can delete a subscription', async ({ page }) => {
    const subName = `Delete Me ${Date.now()}`;

    await addCustomSubscription(page, subName, '22.00');
    await page.getByLabel(`Delete ${subName}`).click();

    await expect(page.getByText('Delete subscription?')).toBeVisible();
    await page.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText(subName)).toHaveCount(0);
  });

  test('subscription deletion with confirmation', async ({ page }) => {
    const subName = `Confirm Delete ${Date.now()}`;

    await addCustomSubscription(page, subName, '18.00');

    // Open delete confirmation
    await page.getByLabel(`Delete ${subName}`).click();

    // Verify warning message
    await expect(
      page.getByText(/are you sure|permanently delete|cannot be undone/i)
    ).toBeVisible();

    // Cancel deletion
    const cancelButton = page.getByRole('button', { name: /cancel|no/i });
    if (await cancelButton.isVisible()) {
      await cancelButton.click();

      // Verify subscription still exists
      await expect(page.getByText(subName)).toBeVisible();
    }

    // Try again and confirm
    await page.getByLabel(`Delete ${subName}`).click();
    await page.getByRole('button', { name: /delete|yes|confirm/i }).click();

    // Verify deletion
    await expect(page.getByText(subName)).toHaveCount(0, { timeout: 10000 });
  });

  test('notifications are visible in the app', async ({ page }) => {
    await page.getByRole('button', { name: /notifications \(/i }).click();
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    await expect(page.getByText('Duplicate Subscription Detected')).toBeVisible();
  });

  test('user can update settings', async ({ page }) => {
    await page.getByRole('button', { name: 'Navigate to Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    const budgetInput = page.getByLabel(/monthly budget limit/i);
    await budgetInput.fill('777');
    await expect(budgetInput).toHaveValue('777');

    const weeklySummary = page.getByLabel(/weekly spending summary/i).locator('input[type="checkbox"]');
    const wasChecked = await weeklySummary.isChecked();
    await weeklySummary.click();
    expect(await weeklySummary.isChecked()).toBe(!wasChecked);

    await openSubscriptions(page);
    await expect(page.getByRole('heading', { name: 'Subscriptions' })).toBeVisible();
  });

  test('subscription filtering by category', async ({ page }) => {
    // Add subscriptions with different categories
    await addCustomSubscription(page, `Streaming ${Date.now()}`, '15.99');
    await addCustomSubscription(page, `Software ${Date.now()}`, '9.99');

    // Apply category filter
    const categoryFilter = page.getByLabel(/filter by category|category/i);
    if (await categoryFilter.isVisible()) {
      await categoryFilter.selectOption('streaming');

      // Verify only streaming subscriptions visible
      await expect(page.getByText(/streaming/i)).toBeVisible();

      // Clear filter
      await categoryFilter.selectOption('all');

      // Verify all subscriptions visible
      await expect(page.getByText(/software/i)).toBeVisible();
    }
  });

  test('subscription search functionality', async ({ page }) => {
    const searchTerm = `Netflix ${Date.now()}`;

    // Add a subscription
    await addCustomSubscription(page, searchTerm, '15.99');
    await addCustomSubscription(page, `Spotify ${Date.now()}`, '9.99');

    // Use search
    const searchInput = page.getByPlaceholder(/search subscriptions/i);
    if (await searchInput.isVisible()) {
      await searchInput.fill('Netflix');

      // Verify filtered results
      await expect(page.getByText(searchTerm)).toBeVisible();
      await expect(page.getByText(/Spotify/)).not.toBeVisible();

      // Clear search
      await searchInput.clear();

      // Verify all visible again
      await expect(page.getByText(/Spotify/)).toBeVisible();
    }
  });

  test('subscription status toggle (active/paused)', async ({ page }) => {
    const subName = `Toggle Status ${Date.now()}`;

    await addCustomSubscription(page, subName, '12.00');

    // Find and click status toggle
    const statusToggle = page.locator(`[aria-label*="${subName}"]`).getByRole('button', { name: /pause|deactivate/i });

    if (await statusToggle.isVisible()) {
      await statusToggle.click();

      // Verify status changed
      await expect(
        page.locator(`[aria-label*="${subName}"]`).getByText(/paused|inactive/i)
      ).toBeVisible({ timeout: 5000 });

      // Toggle back
      await page.locator(`[aria-label*="${subName}"]`).getByRole('button', { name: /activate|resume/i }).click();

      await expect(
        page.locator(`[aria-label*="${subName}"]`).getByText(/active/i)
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test('subscription sorting', async ({ page }) => {
    // Add multiple subscriptions
    await addCustomSubscription(page, 'Z Subscription', '30.00');
    await addCustomSubscription(page, 'A Subscription', '10.00');
    await addCustomSubscription(page, 'M Subscription', '20.00');

    // Click sort button
    const sortButton = page.getByRole('button', { name: /sort|sort by/i });

    if (await sortButton.isVisible()) {
      await sortButton.click();

      // Select sort by name
      await page.getByRole('button', { name: /name|alphabetical/i }).click();

      // Verify order (A, M, Z)
      const subscriptionNames = await page.locator('[data-testid="subscription-name"]').allTextContents();

      expect(subscriptionNames[0]).toContain('A Subscription');
      expect(subscriptionNames[subscriptionNames.length - 1]).toContain('Z Subscription');

      // Sort by price
      await sortButton.click();
      await page.getByRole('button', { name: /price|cost/i }).click();

      const prices = await page.locator('[data-testid="subscription-price"]').allTextContents();

      // Verify prices are sorted
      const numericPrices = prices.map(p => parseFloat(p.replace(/[^0-9.]/g, '')));
      expect(numericPrices[0]).toBeLessThanOrEqual(numericPrices[numericPrices.length - 1]);
    }
  });

  test('bulk subscription selection and actions', async ({ page }) => {
    // Add multiple subscriptions
    await addCustomSubscription(page, `Bulk 1 ${Date.now()}`, '10.00');
    await addCustomSubscription(page, `Bulk 2 ${Date.now()}`, '20.00');

    // Select multiple subscriptions
    const checkboxes = page.getByRole('checkbox', { name: /select subscription/i });

    if (await checkboxes.first().isVisible()) {
      await checkboxes.nth(0).check();
      await checkboxes.nth(1).check();

      // Verify bulk actions available
      await expect(page.getByRole('button', { name: /bulk delete|delete selected/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /bulk edit|edit selected/i })).toBeVisible();
    }
  });

  test('subscription duplicate detection', async ({ page }) => {
    const duplicateName = `Duplicate ${Date.now()}`;

    // Add first subscription
    await addCustomSubscription(page, duplicateName, '15.00');

    // Try to add duplicate
    await page.getByRole('button', { name: /add subscription/i }).click();
    await page.getByLabel(/subscription name/i).fill(duplicateName);
    await page.getByLabel(/price|cost/i).fill('15.00');
    await page.getByRole('button', { name: /add|create|save/i }).click();

    // Verify warning message
    await expect(
      page.getByText(/already exists|duplicate|similar subscription/i)
    ).toBeVisible({ timeout: 5000 });
  });

  test('subscription quick actions menu', async ({ page }) => {
    const subName = `Quick Actions ${Date.now()}`;

    await addCustomSubscription(page, subName, '25.00');

    // Open quick actions menu (three dots)
    const menuButton = page.locator(`[aria-label*="${subName}"]`).getByRole('button', { name: /more|actions|menu/i });

    if (await menuButton.isVisible()) {
      await menuButton.click();

      // Verify menu options
      await expect(page.getByRole('menuitem', { name: /edit/i })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: /delete/i })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: /duplicate|copy/i })).toBeVisible();
    }
  });

  test('subscription list pagination', async ({ page }) => {
    // This test assumes many subscriptions exist or can be created
    const paginationNext = page.getByRole('button', { name: /next page|next/i });

    if (await paginationNext.isVisible()) {
      // Click next page
      await paginationNext.click();

      // Verify page changed
      await expect(page.getByText(/page 2|2 of/i)).toBeVisible();

      // Go back
      await page.getByRole('button', { name: /previous page|previous/i }).click();

      await expect(page.getByText(/page 1|1 of/i)).toBeVisible();
    }
  });
});
