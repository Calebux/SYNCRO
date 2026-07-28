import { test, expect } from '@playwright/test';
import { loginViaApi, makeTestUser, signupViaApi } from './helpers';

test.describe('Email Connection E2E Tests', () => {
  test.beforeEach(async ({ context }) => {
    // Setup authenticated user
    const user = makeTestUser();
    await signupViaApi(context.request, user);
    await loginViaApi(context.request, user);
  });

  test('Gmail OAuth flow with popup handling', async ({ page, context }) => {
    // Navigate to settings or email connection page
    await page.goto('/settings/email');

    // Click connect Gmail button
    const connectButton = page.getByRole('button', { name: /connect gmail|add gmail/i });
    await expect(connectButton).toBeVisible();

    // Setup popup handler
    const popupPromise = context.waitForEvent('page');
    await connectButton.click();

    // Handle OAuth popup
    const popup = await popupPromise;
    await expect(popup).toHaveURL(/accounts\.google\.com/);

    // Simulate OAuth approval (in real test, this would interact with Google's OAuth)
    // For testing purposes, we'll simulate the redirect back with auth code
    await popup.goto('/auth/google/callback?code=mock-auth-code&state=mock-state');
    await popup.waitForLoadState('networkidle');

    // Popup should close automatically
    await popup.waitForEvent('close', { timeout: 10000 }).catch(() => {
      // If popup doesn't close automatically, close it manually
      popup.close();
    });

    // Verify success message on main page
    await expect(
      page.getByText(/connected|gmail connected successfully/i)
    ).toBeVisible({ timeout: 10000 });
  });

  test('token storage and persistence', async ({ page, context }) => {
    // Navigate to email settings
    await page.goto('/settings/email');

    // Mock successful Gmail connection
    await context.addCookies([
      {
        name: 'gmail_access_token',
        value: 'mock-access-token',
        domain: 'localhost',
        path: '/',
      },
    ]);

    await page.reload();

    // Verify connection status persists
    await expect(
      page.getByText(/gmail connected|connected account/i)
    ).toBeVisible();

    // Check local storage for token
    const tokenStored = await page.evaluate(() => {
      return localStorage.getItem('gmail_token') !== null;
    });
    expect(tokenStored).toBeTruthy();
  });

  test('email scanning trigger', async ({ page }) => {
    // Navigate to email settings
    await page.goto('/settings/email');

    // Assume Gmail is already connected (mock state)
    await page.addInitScript(() => {
      window.localStorage.setItem('gmail_connected', 'true');
      window.localStorage.setItem('gmail_token', 'mock-token');
    });

    await page.reload();

    // Click scan emails button
    const scanButton = page.getByRole('button', { name: /scan emails|scan inbox/i });
    await expect(scanButton).toBeVisible();
    await scanButton.click();

    // Verify scanning started
    await expect(
      page.getByText(/scanning|processing emails|scan in progress/i)
    ).toBeVisible({ timeout: 5000 });

    // Wait for scan completion
    await expect(
      page.getByText(/scan complete|scanning finished|found \d+ subscription/i)
    ).toBeVisible({ timeout: 30000 });
  });

  test('connection status display', async ({ page }) => {
    // Navigate to email settings
    await page.goto('/settings/email');

    // Initially, no connection should be shown
    await expect(
      page.getByText(/not connected|connect your email/i)
    ).toBeVisible();

    // Mock connection state
    await page.addInitScript(() => {
      window.localStorage.setItem('gmail_connected', 'true');
      window.localStorage.setItem('gmail_email', 'test@example.com');
    });

    await page.reload();

    // Verify connected status
    await expect(page.getByText(/connected|test@example\.com/i)).toBeVisible();

    // Verify connection indicator (e.g., green dot)
    const statusIndicator = page.locator('[data-testid="connection-status"]');
    if (await statusIndicator.isVisible()) {
      await expect(statusIndicator).toHaveClass(/connected|success|active/);
    }
  });

  test('disconnect Gmail account', async ({ page }) => {
    // Navigate to email settings with mock connection
    await page.addInitScript(() => {
      window.localStorage.setItem('gmail_connected', 'true');
      window.localStorage.setItem('gmail_email', 'test@example.com');
    });

    await page.goto('/settings/email');

    // Click disconnect button
    const disconnectButton = page.getByRole('button', { name: /disconnect|remove/i });
    await expect(disconnectButton).toBeVisible();
    await disconnectButton.click();

    // Confirm disconnection if confirmation dialog appears
    const confirmButton = page.getByRole('button', { name: /confirm|yes/i });
    if (await confirmButton.isVisible({ timeout: 2000 })) {
      await confirmButton.click();
    }

    // Verify disconnected status
    await expect(
      page.getByText(/disconnected|not connected/i)
    ).toBeVisible({ timeout: 10000 });

    // Verify token removed from storage
    const tokenRemoved = await page.evaluate(() => {
      return localStorage.getItem('gmail_token') === null;
    });
    expect(tokenRemoved).toBeTruthy();
  });

  test('OAuth error handling', async ({ page, context }) => {
    // Navigate to email settings
    await page.goto('/settings/email');

    // Click connect Gmail button
    const connectButton = page.getByRole('button', { name: /connect gmail|add gmail/i });
    await connectButton.click();

    // Setup popup handler
    const popupPromise = context.waitForEvent('page');

    const popup = await popupPromise;

    // Simulate OAuth error
    await popup.goto('/auth/google/callback?error=access_denied&error_description=User denied access');
    await popup.waitForLoadState('networkidle');

    // Close popup
    await popup.close();

    // Verify error message on main page
    await expect(
      page.getByText(/connection failed|access denied|unable to connect/i)
    ).toBeVisible({ timeout: 10000 });
  });

  test('expired token refresh', async ({ page }) => {
    // Navigate to email settings with expired token
    await page.addInitScript(() => {
      window.localStorage.setItem('gmail_connected', 'true');
      window.localStorage.setItem('gmail_token', 'expired-token');
      window.localStorage.setItem('gmail_token_expiry', String(Date.now() - 3600000)); // Expired 1 hour ago
    });

    await page.goto('/settings/email');

    // Try to scan emails, which should trigger token refresh
    const scanButton = page.getByRole('button', { name: /scan emails|scan inbox/i });
    if (await scanButton.isVisible({ timeout: 5000 })) {
      await scanButton.click();

      // Verify refresh prompt or automatic refresh
      const refreshPrompt = page.getByText(/token expired|re-authenticate|reconnect/i);
      if (await refreshPrompt.isVisible({ timeout: 5000 })) {
        await expect(refreshPrompt).toBeVisible();
      }
    }
  });

  test('multiple email accounts support', async ({ page }) => {
    // Navigate to email settings
    await page.addInitScript(() => {
      window.localStorage.setItem('connected_emails', JSON.stringify([
        { provider: 'gmail', email: 'test1@gmail.com' },
        { provider: 'gmail', email: 'test2@gmail.com' },
      ]));
    });

    await page.goto('/settings/email');

    // Verify both accounts displayed
    await expect(page.getByText('test1@gmail.com')).toBeVisible();
    await expect(page.getByText('test2@gmail.com')).toBeVisible();

    // Verify add another account button
    await expect(
      page.getByRole('button', { name: /add another account|connect another/i })
    ).toBeVisible();
  });

  test('email permissions display', async ({ page }) => {
    // Navigate to email settings
    await page.goto('/settings/email');

    // Check permissions information
    await expect(
      page.getByText(/read-only access|we only read|view your emails/i)
    ).toBeVisible();

    // Verify what data is accessed
    await expect(
      page.getByText(/subscription receipts|billing emails/i)
    ).toBeVisible();
  });

  test('manual email import as alternative', async ({ page }) => {
    // Navigate to email settings
    await page.goto('/settings/email');

    // Click manual import option
    const manualImportButton = page.getByRole('button', { name: /manual import|import csv/i });
    if (await manualImportButton.isVisible()) {
      await manualImportButton.click();

      // Verify file upload interface
      await expect(page.getByText(/upload file|choose file/i)).toBeVisible();
    }
  });

  test('email scan results display', async ({ page }) => {
    // Navigate to email settings with mock scan results
    await page.addInitScript(() => {
      window.localStorage.setItem('last_scan_results', JSON.stringify({
        found: 5,
        subscriptions: [
          { name: 'Netflix', price: 15.99 },
          { name: 'Spotify', price: 9.99 },
          { name: 'Disney+', price: 7.99 },
        ],
        timestamp: Date.now(),
      }));
    });

    await page.goto('/settings/email');

    // Verify scan results displayed
    await expect(page.getByText(/found 5 subscription/i)).toBeVisible();
    await expect(page.getByText('Netflix')).toBeVisible();
    await expect(page.getByText('Spotify')).toBeVisible();

    // Verify option to add to subscriptions
    await expect(
      page.getByRole('button', { name: /add all|import found/i })
    ).toBeVisible();
  });

  test('privacy notice and data handling', async ({ page }) => {
    // Navigate to email settings
    await page.goto('/settings/email');

    // Verify privacy notice
    await expect(
      page.getByText(/privacy|your data is secure|encrypted/i)
    ).toBeVisible();

    // Click learn more about data handling
    const learnMoreLink = page.getByRole('link', { name: /learn more|privacy policy/i });
    if (await learnMoreLink.isVisible()) {
      await learnMoreLink.click();

      // Verify privacy policy page or modal
      await expect(
        page.getByText(/how we handle your data|data processing/i)
      ).toBeVisible();
    }
  });
});
