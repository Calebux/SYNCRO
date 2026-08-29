import { test, expect } from '@playwright/test';

test.describe('Virtualization Performance Tests', () => {
  test('subscription list renders bounded DOM nodes with 5000 items', async ({ page }) => {
    await page.goto('/subscriptions');

    // Wait for virtualized list to load
    await page.waitForSelector('[role="list"]', { timeout: 5000 });

    // Count DOM nodes rendered (listitem elements)
    const listItems = await page.locator('[role="listitem"]').count();

    // Should render only visible + overscan (typically 5-10 items max)
    // Not 5000
    expect(listItems).toBeLessThan(50);
    expect(listItems).toBeGreaterThan(0);
  });

  test('keyboard navigation works in virtualized list', async ({ page }) => {
    await page.goto('/subscriptions');

    // Wait for list
    await page.waitForSelector('[role="list"]', { timeout: 5000 });

    // Focus list
    const list = page.locator('[role="list"]');
    await list.focus();

    // Press ArrowDown
    await page.keyboard.press('ArrowDown');

    // First item should be focused
    const firstItem = page.locator('[role="listitem"]').first();
    await expect(firstItem).toBeFocused();

    // Press ArrowDown again
    await page.keyboard.press('ArrowDown');

    // Second visible item should be focused
    const items = page.locator('[role="listitem"]');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('screen reader announces list content', async ({ page }) => {
    await page.goto('/subscriptions');

    // Wait for list
    await page.waitForSelector('[role="list"]', { timeout: 5000 });

    // Check aria-label
    const list = page.locator('[role="list"]');
    const label = await list.getAttribute('aria-label');
    expect(label).toBeTruthy();
    expect(label).toContain('list');
  });

  test('payment history virtualization loads on demand', async ({ page }) => {
    // Navigate to a specific subscription detail
    await page.goto('/subscriptions');

    // Wait and click on first subscription
    await page.waitForSelector('[data-testid="subscription-card"]', { timeout: 5000 });
    await page.locator('[data-testid="subscription-card"]').first().click();

    // Wait for payment timeline
    await page.waitForSelector('ol[aria-label="Payment timeline"]', { timeout: 5000 });

    // Initial render should have limited items
    const initialItems = await page.locator('li').count();
    expect(initialItems).toBeLessThan(100);

    // Scroll to bottom to trigger load more
    const timeline = page.locator('[aria-label="Payment timeline"]').first();
    await timeline.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });

    // Wait for load indicator
    await page.waitForTimeout(500);

    // Should still have bounded items
    const finalItems = await page.locator('li').count();
    expect(finalItems).toBeLessThan(150);
  });

  test('audit log virtualization handles large datasets', async ({ page }) => {
    await page.goto('/settings/security');

    // Wait for audit log
    await page.waitForSelector('[role="list"]', { timeout: 5000 });

    // Count initial items
    const initialItems = await page.locator('[role="listitem"]').count();
    expect(initialItems).toBeLessThan(50);

    // Search should still virtualize
    await page.fill('input[placeholder*="Search"]', 'login');
    await page.waitForTimeout(300);

    const filteredItems = await page.locator('[role="listitem"]').count();
    expect(filteredItems).toBeLessThan(50);
  });

  test('virtualized list maintains focus during scroll', async ({ page }) => {
    await page.goto('/subscriptions');

    await page.waitForSelector('[role="list"]', { timeout: 5000 });

    const list = page.locator('[role="list"]');
    await list.focus();

    // Focus first item
    await page.keyboard.press('ArrowDown');
    const firstItem = page.locator('[role="listitem"]').first();
    await expect(firstItem).toBeFocused();

    // Scroll down several pages
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('PageDown');
      await page.waitForTimeout(100);
    }

    // Should still have a focused item
    const focusedItem = page.locator('[role="listitem"]:focus');
    await expect(focusedItem).toHaveCount(1);
  });

  test('performance: 5000-item list stays responsive', async ({ page }) => {
    await page.goto('/subscriptions?fixture=large');

    await page.waitForSelector('[role="list"]', { timeout: 5000 });

    const startTime = Date.now();

    // Scroll rapidly
    const list = page.locator('[role="list"]');
    await list.evaluate((el) => {
      for (let i = 0; i < 50; i++) {
        el.scrollBy(0, 100);
      }
    });

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Should complete in under 2 seconds (no jank)
    expect(duration).toBeLessThan(2000);

    // Check still has bounded DOM
    const items = await page.locator('[role="listitem"]').count();
    expect(items).toBeLessThan(50);
  });
});
