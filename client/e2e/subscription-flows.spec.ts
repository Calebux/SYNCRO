import { test, expect } from '@playwright/test';
import { addCustomSubscription, bootstrapMockAuthenticatedUi, openSubscriptions } from './helpers';

test.beforeEach(async ({ page }) => {
  await bootstrapMockAuthenticatedUi(page);
});

test('user can add a subscription', async ({ page }) => {
  const subName = `Playwright Plus ${Date.now()}`;
  await addCustomSubscription(page, subName, '15.99');
  await expect(page.getByText(subName).first()).toBeVisible();
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

test('user can delete a subscription', async ({ page }) => {
  const subName = `Delete Me ${Date.now()}`;

  await addCustomSubscription(page, subName, '22.00');
  await page.getByLabel(`Delete ${subName}`).click();

  await expect(page.getByText('Delete subscription?')).toBeVisible();
  await page.getByRole('button', { name: 'Delete' }).click();

  await expect(page.getByText(subName)).toHaveCount(0);
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
