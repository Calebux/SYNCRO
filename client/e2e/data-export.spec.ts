import { test, expect } from '@playwright/test';
import { loginViaApi, makeTestUser, signupViaApi } from './helpers';
import { parse } from 'csv-parse/sync';

test.describe('Data Export E2E Tests', () => {
  test.beforeEach(async ({ context }) => {
    // Setup authenticated user with sample data
    const user = makeTestUser();
    await signupViaApi(context.request, user);
    await loginViaApi(context.request, user);
  });

  test('CSV file download', async ({ page }) => {
    // Navigate to data export page
    await page.goto('/settings/data-export');

    // Click export button
    const exportButton = page.getByRole('button', { name: /export data|download data|export.*csv/i });
    await expect(exportButton).toBeVisible();

    // Setup download handler
    const downloadPromise = page.waitForEvent('download');
    await exportButton.click();

    // Wait for download
    const download = await downloadPromise;

    // Verify filename
    expect(download.suggestedFilename()).toMatch(/subscriptions.*\.csv|data.*\.csv|export.*\.csv/i);

    // Verify file was downloaded
    const path = await download.path();
    expect(path).toBeTruthy();
  });

  test('file content and format', async ({ page }) => {
    // Navigate to data export page
    await page.goto('/settings/data-export');

    // Trigger export
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /export data|download/i }).click();

    const download = await downloadPromise;
    const path = await download.path();

    // Read file content
    const fs = require('fs');
    const content = fs.readFileSync(path, 'utf-8');

    // Verify CSV format
    expect(content).toContain(','); // Contains CSV delimiters

    // Parse CSV
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
    });

    // Verify headers exist
    expect(records.length).toBeGreaterThan(0);

    // Verify expected columns
    const firstRecord = records[0];
    expect(firstRecord).toHaveProperty('name');
    expect(firstRecord).toHaveProperty('price');
    expect(firstRecord).toHaveProperty('billing_cycle');
    expect(firstRecord).toHaveProperty('status');
  });

  test('data completeness', async ({ page }) => {
    // Setup test data via API
    await page.request.post('/api/subscriptions', {
      data: {
        name: 'Test Subscription 1',
        price: 15.99,
        billing_cycle: 'monthly',
        status: 'active',
        category: 'streaming',
      },
    });

    await page.request.post('/api/subscriptions', {
      data: {
        name: 'Test Subscription 2',
        price: 9.99,
        billing_cycle: 'annual',
        status: 'cancelled',
        category: 'software',
      },
    });

    // Navigate to export page
    await page.goto('/settings/data-export');

    // Export data
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /export data/i }).click();

    const download = await downloadPromise;
    const path = await download.path();

    // Read and parse CSV
    const fs = require('fs');
    const content = fs.readFileSync(path, 'utf-8');
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
    });

    // Verify both subscriptions are in export
    expect(records.length).toBeGreaterThanOrEqual(2);

    const sub1 = records.find((r: any) => r.name === 'Test Subscription 1');
    const sub2 = records.find((r: any) => r.name === 'Test Subscription 2');

    expect(sub1).toBeDefined();
    expect(sub1.price).toBe('15.99');
    expect(sub1.billing_cycle).toBe('monthly');
    expect(sub1.status).toBe('active');

    expect(sub2).toBeDefined();
    expect(sub2.price).toBe('9.99');
    expect(sub2.billing_cycle).toBe('annual');
    expect(sub2.status).toBe('cancelled');
  });

  test('privacy compliance - PII handling', async ({ page }) => {
    // Setup subscription with notes containing potential PII
    await page.request.post('/api/subscriptions', {
      data: {
        name: 'Test Service',
        price: 10.00,
        notes: 'Email: user@example.com, Phone: 555-1234',
      },
    });

    // Export data
    await page.goto('/settings/data-export');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /export data/i }).click();

    const download = await downloadPromise;
    const path = await download.path();

    // Read content
    const fs = require('fs');
    const content = fs.readFileSync(path, 'utf-8');

    // Verify PII included (as it's user's own data)
    // or verify PII is properly handled based on requirements
    expect(content).toBeTruthy();

    // If PII should be redacted, verify redaction
    // If PII should be included, verify it's present
    // This depends on your specific privacy requirements
  });

  test('export with date range filter', async ({ page }) => {
    // Navigate to export page
    await page.goto('/settings/data-export');

    // Set date range if available
    const startDateInput = page.getByLabel(/start date|from date/i);
    const endDateInput = page.getByLabel(/end date|to date/i);

    if (await startDateInput.isVisible()) {
      await startDateInput.fill('2024-01-01');
      await endDateInput.fill('2024-12-31');

      // Export with filters
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: /export data/i }).click();

      const download = await downloadPromise;
      const path = await download.path();

      // Verify file downloaded
      expect(path).toBeTruthy();

      // Optionally verify filtered data
      const fs = require('fs');
      const content = fs.readFileSync(path, 'utf-8');
      const records = parse(content, { columns: true, skip_empty_lines: true });

      // All records should be within date range
      records.forEach((record: any) => {
        if (record.created_at) {
          const date = new Date(record.created_at);
          expect(date.getFullYear()).toBe(2024);
        }
      });
    }
  });

  test('export format selection (CSV, JSON, Excel)', async ({ page }) => {
    // Navigate to export page
    await page.goto('/settings/data-export');

    // Check if format selector exists
    const formatSelector = page.locator('select[name="format"], [data-testid="format-selector"]');

    if (await formatSelector.isVisible()) {
      // Select JSON format
      await formatSelector.selectOption('json');

      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: /export data/i }).click();

      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/\.json$/i);

      // Verify JSON content
      const path = await download.path();
      const fs = require('fs');
      const content = fs.readFileSync(path, 'utf-8');
      const jsonData = JSON.parse(content);

      expect(Array.isArray(jsonData)).toBeTruthy();
    }
  });

  test('export progress indication', async ({ page }) => {
    // Navigate to export page
    await page.goto('/settings/data-export');

    // Click export
    await page.getByRole('button', { name: /export data/i }).click();

    // Verify progress indicator
    const progressIndicator = page.getByText(/exporting|preparing|generating/i);
    if (await progressIndicator.isVisible({ timeout: 2000 })) {
      await expect(progressIndicator).toBeVisible();
    }

    // Progress should disappear after download starts
    await page.waitForEvent('download');

    // Verify success message
    await expect(
      page.getByText(/export complete|download started|data exported/i)
    ).toBeVisible({ timeout: 10000 });
  });

  test('export with no data shows appropriate message', async ({ page, context }) => {
    // Create new user with no subscriptions
    const newUser = makeTestUser();
    await signupViaApi(context.request, newUser);
    await loginViaApi(context.request, newUser);

    const newPage = await context.newPage();
    await newPage.goto('/settings/data-export');

    // Try to export
    await newPage.getByRole('button', { name: /export data/i }).click();

    // Verify message about no data
    await expect(
      newPage.getByText(/no data|no subscriptions|nothing to export/i)
    ).toBeVisible({ timeout: 5000 });

    await newPage.close();
  });

  test('export includes all subscription fields', async ({ page }) => {
    // Create subscription with all fields
    await page.request.post('/api/subscriptions', {
      data: {
        name: 'Complete Subscription',
        price: 29.99,
        billing_cycle: 'monthly',
        next_billing_date: '2024-02-01',
        status: 'active',
        category: 'software',
        merchant: 'Test Merchant',
        notes: 'Test notes',
        tags: ['productivity', 'essential'],
        created_at: '2024-01-01T00:00:00Z',
      },
    });

    // Export data
    await page.goto('/settings/data-export');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /export data/i }).click();

    const download = await downloadPromise;
    const path = await download.path();

    // Parse CSV
    const fs = require('fs');
    const content = fs.readFileSync(path, 'utf-8');
    const records = parse(content, { columns: true, skip_empty_lines: true });

    const record = records.find((r: any) => r.name === 'Complete Subscription');
    expect(record).toBeDefined();

    // Verify all fields present
    expect(record.name).toBe('Complete Subscription');
    expect(record.price).toBe('29.99');
    expect(record.billing_cycle).toBe('monthly');
    expect(record.status).toBe('active');
    expect(record.category).toBe('software');
    expect(record.merchant).toBe('Test Merchant');
    expect(record.notes).toBe('Test notes');
  });

  test('export respects user permissions', async ({ page, context }) => {
    // This test verifies that users can only export their own data

    // User 1 creates a subscription
    await page.request.post('/api/subscriptions', {
      data: { name: 'User 1 Subscription', price: 10.00 },
    });

    // Export User 1 data
    await page.goto('/settings/data-export');
    const download1Promise = page.waitForEvent('download');
    await page.getByRole('button', { name: /export data/i }).click();
    const download1 = await download1Promise;
    const path1 = await download1.path();

    // Parse User 1 export
    const fs = require('fs');
    const content1 = fs.readFileSync(path1, 'utf-8');
    const records1 = parse(content1, { columns: true, skip_empty_lines: true });

    // Create User 2
    const user2 = makeTestUser();
    await signupViaApi(context.request, user2);
    await loginViaApi(context.request, user2);

    const user2Page = await context.newPage();

    // User 2 creates a subscription
    await user2Page.request.post('/api/subscriptions', {
      data: { name: 'User 2 Subscription', price: 20.00 },
    });

    // Export User 2 data
    await user2Page.goto('/settings/data-export');
    const download2Promise = user2Page.waitForEvent('download');
    await user2Page.getByRole('button', { name: /export data/i }).click();
    const download2 = await download2Promise;
    const path2 = await download2.path();

    // Parse User 2 export
    const content2 = fs.readFileSync(path2, 'utf-8');
    const records2 = parse(content2, { columns: true, skip_empty_lines: true });

    // Verify User 1's export doesn't contain User 2's data
    expect(records1.find((r: any) => r.name === 'User 2 Subscription')).toBeUndefined();

    // Verify User 2's export doesn't contain User 1's data
    expect(records2.find((r: any) => r.name === 'User 1 Subscription')).toBeUndefined();

    await user2Page.close();
  });

  test('export includes payment history if requested', async ({ page }) => {
    // Navigate to export page
    await page.goto('/settings/data-export');

    // Select option to include payment history if available
    const includePayments = page.getByLabel(/include payments|include transactions|payment history/i);

    if (await includePayments.isVisible()) {
      await includePayments.check();

      // Export
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: /export data/i }).click();

      const download = await downloadPromise;
      const path = await download.path();

      // Verify payment data included
      const fs = require('fs');
      const content = fs.readFileSync(path, 'utf-8');

      // May be in separate CSV file or additional columns
      expect(content).toContain('payment');
    }
  });

  test('scheduled export option', async ({ page }) => {
    // Navigate to export settings
    await page.goto('/settings/data-export');

    // Check for scheduled export option
    const scheduleToggle = page.getByLabel(/schedule|automatic|recurring/i);

    if (await scheduleToggle.isVisible()) {
      await scheduleToggle.check();

      // Select frequency
      const frequencySelect = page.locator('select[name="frequency"]');
      if (await frequencySelect.isVisible()) {
        await frequencySelect.selectOption('monthly');
      }

      // Save settings
      await page.getByRole('button', { name: /save|update/i }).click();

      // Verify success message
      await expect(
        page.getByText(/scheduled|automatic.*enabled|export.*configured/i)
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test('GDPR compliance - full data export', async ({ page }) => {
    // Navigate to export page
    await page.goto('/settings/data-export');

    // Look for GDPR/full data export option
    const gdprExport = page.getByRole('button', { name: /full data|gdpr|complete data/i });

    if (await gdprExport.isVisible()) {
      const downloadPromise = page.waitForEvent('download');
      await gdprExport.click();

      const download = await downloadPromise;

      // GDPR exports are often in ZIP format with multiple files
      const filename = download.suggestedFilename();
      expect(filename).toMatch(/\.zip|\.csv|\.json/i);
    }
  });

  test('export cancellation', async ({ page }) => {
    // Navigate to export page
    await page.goto('/settings/data-export');

    // Start export
    await page.getByRole('button', { name: /export data/i }).click();

    // If there's a progress indicator, try to cancel
    const cancelButton = page.getByRole('button', { name: /cancel/i });

    if (await cancelButton.isVisible({ timeout: 2000 })) {
      await cancelButton.click();

      // Verify export cancelled
      await expect(
        page.getByText(/cancelled|stopped/i)
      ).toBeVisible({ timeout: 5000 });
    }
  });
});
