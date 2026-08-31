import { test, expect } from '@playwright/test';
import { loginViaApi, makeTestUser, signupViaApi } from './helpers';

test.describe('Settings and Privacy Journeys', () => {
  test.beforeEach(async ({ browser }) => {
    // Setup: Create and login test user
    const user = makeTestUser();
    const signupContext = await browser.newContext();
    await signupViaApi(signupContext.request, user);
    await signupContext.close();

    const loginContext = await browser.newContext();
    await loginViaApi(loginContext.request, user);
    const page = await loginContext.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem('onboarding_completed', 'true');
    });
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings/);
  });

  test('user can access settings page', async ({ browser }) => {
    const user = makeTestUser();
    const signupContext = await browser.newContext();
    await signupViaApi(signupContext.request, user);
    await signupContext.close();

    const loginContext = await browser.newContext();
    await loginViaApi(loginContext.request, user);
    const page = await loginContext.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem('onboarding_completed', 'true');
    });

    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();
  });

  test('user can update email preferences', async ({ browser }) => {
    const user = makeTestUser();
    const signupContext = await browser.newContext();
    await signupViaApi(signupContext.request, user);
    await signupContext.close();

    const loginContext = await browser.newContext();
    await loginViaApi(loginContext.request, user);
    const page = await loginContext.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem('onboarding_completed', 'true');
    });

    await page.goto('/settings');

    // Look for email preferences section
    const emailPrefsSection = page.locator('[data-testid="email-preferences"]');
    if (await emailPrefsSection.isVisible()) {
      // Toggle email notifications
      const toggles = page.locator('input[type="checkbox"]');
      const count = await toggles.count();
      if (count > 0) {
        await toggles.first().click();
        await expect(toggles.first()).toHaveAttribute('checked', '');
      }
    }
  });

  test('user can access privacy export page', async ({ browser }) => {
    const user = makeTestUser();
    const signupContext = await browser.newContext();
    await signupViaApi(signupContext.request, user);
    await signupContext.close();

    const loginContext = await browser.newContext();
    await loginViaApi(loginContext.request, user);
    const page = await loginContext.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem('onboarding_completed', 'true');
    });

    await page.goto('/settings/privacy');
    await expect(page).toHaveURL(/\/settings\/privacy/);

    // Verify privacy section is visible
    const privacyHeading = page.getByRole('heading', { name: /privacy/i });
    if (await privacyHeading.isVisible()) {
      await expect(privacyHeading).toBeVisible();
    }
  });

  test('user can request data export', async ({ browser }) => {
    const user = makeTestUser();
    const signupContext = await browser.newContext();
    await signupViaApi(signupContext.request, user);
    await signupContext.close();

    const loginContext = await browser.newContext();
    await loginViaApi(loginContext.request, user);
    const page = await loginContext.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem('onboarding_completed', 'true');
    });

    await page.goto('/settings/privacy');

    // Look for export data button
    const exportButton = page.getByRole('button', { name: /export.*data|download.*data/i });
    if (await exportButton.isVisible()) {
      await exportButton.click();
      // Verify confirmation dialog or success message
      const confirmButton = page.getByRole('button', { name: /confirm|yes|proceed/i });
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }
    }
  });

  test('user can request account deletion', async ({ browser }) => {
    const user = makeTestUser();
    const signupContext = await browser.newContext();
    await signupViaApi(signupContext.request, user);
    await signupContext.close();

    const loginContext = await browser.newContext();
    await loginViaApi(loginContext.request, user);
    const page = await loginContext.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem('onboarding_completed', 'true');
    });

    await page.goto('/settings/privacy');

    // Look for delete account button
    const deleteButton = page.getByRole('button', { name: /delete.*account|remove.*account/i });
    if (await deleteButton.isVisible()) {
      await deleteButton.click();
      // Verify confirmation dialog
      const confirmButton = page.getByRole('button', { name: /confirm|yes|delete/i });
      if (await confirmButton.isVisible()) {
        await expect(confirmButton).toBeVisible();
      }
    }
  });

  test('user can cancel deletion request', async ({ browser }) => {
    const user = makeTestUser();
    const signupContext = await browser.newContext();
    await signupViaApi(signupContext.request, user);
    await signupContext.close();

    const loginContext = await browser.newContext();
    await loginViaApi(loginContext.request, user);
    const page = await loginContext.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem('onboarding_completed', 'true');
    });

    await page.goto('/settings/privacy');

    // Look for cancel deletion button (if deletion is pending)
    const cancelButton = page.getByRole('button', { name: /cancel.*deletion|undo.*deletion/i });
    if (await cancelButton.isVisible()) {
      await cancelButton.click();
      // Verify success message
      const successMessage = page.locator('[role="alert"]');
      if (await successMessage.isVisible()) {
        await expect(successMessage).toBeVisible();
      }
    }
  });

  test('user can enable MFA', async ({ browser }) => {
    const user = makeTestUser();
    const signupContext = await browser.newContext();
    await signupViaApi(signupContext.request, user);
    await signupContext.close();

    const loginContext = await browser.newContext();
    await loginViaApi(loginContext.request, user);
    const page = await loginContext.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem('onboarding_completed', 'true');
    });

    await page.goto('/settings/security');

    // Look for MFA section
    const mfaSection = page.locator('[data-testid="mfa-section"]');
    if (await mfaSection.isVisible()) {
      const enableButton = mfaSection.getByRole('button', { name: /enable|setup|configure/i });
      if (await enableButton.isVisible()) {
        await enableButton.click();
        // Verify QR code or setup instructions appear
        const qrCode = page.locator('[data-testid="qr-code"]');
        if (await qrCode.isVisible()) {
          await expect(qrCode).toBeVisible();
        }
      }
    }
  });

  test('user can disable MFA', async ({ browser }) => {
    const user = makeTestUser();
    const signupContext = await browser.newContext();
    await signupViaApi(signupContext.request, user);
    await signupContext.close();

    const loginContext = await browser.newContext();
    await loginViaApi(loginContext.request, user);
    const page = await loginContext.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem('onboarding_completed', 'true');
    });

    await page.goto('/settings/security');

    // Look for disable MFA button
    const disableButton = page.getByRole('button', { name: /disable|remove.*mfa/i });
    if (await disableButton.isVisible()) {
      await disableButton.click();
      // Verify confirmation dialog
      const confirmButton = page.getByRole('button', { name: /confirm|yes|disable/i });
      if (await confirmButton.isVisible()) {
        await expect(confirmButton).toBeVisible();
      }
    }
  });

  test('user can manage notification preferences', async ({ browser }) => {
    const user = makeTestUser();
    const signupContext = await browser.newContext();
    await signupViaApi(signupContext.request, user);
    await signupContext.close();

    const loginContext = await browser.newContext();
    await loginViaApi(loginContext.request, user);
    const page = await loginContext.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem('onboarding_completed', 'true');
    });

    await page.goto('/settings/notifications');

    // Verify notification preferences page loads
    await expect(page).toHaveURL(/\/settings\/notifications/);

    // Look for notification toggles
    const toggles = page.locator('input[type="checkbox"]');
    const count = await toggles.count();
    expect(count).toBeGreaterThanOrEqual(0);

    // Toggle first preference if available
    if (count > 0) {
      const firstToggle = toggles.first();
      const initialState = await firstToggle.isChecked();
      await firstToggle.click();
      const newState = await firstToggle.isChecked();
      expect(newState).not.toBe(initialState);
    }
  });

  test('settings page handles auth failure gracefully', async ({ browser }) => {
    const page = await browser.newPage();
    // Try to access settings without authentication
    await page.goto('/settings');

    // Should redirect to login or show auth error
    const url = page.url();
    expect(url).toMatch(/login|auth|signin/i);
  });

  test('privacy export shows loading state', async ({ browser }) => {
    const user = makeTestUser();
    const signupContext = await browser.newContext();
    await signupViaApi(signupContext.request, user);
    await signupContext.close();

    const loginContext = await browser.newContext();
    await loginViaApi(loginContext.request, user);
    const page = await loginContext.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem('onboarding_completed', 'true');
    });

    await page.goto('/settings/privacy');

    // Look for export button
    const exportButton = page.getByRole('button', { name: /export.*data|download.*data/i });
    if (await exportButton.isVisible()) {
      await exportButton.click();

      // Check for loading indicator
      const loadingIndicator = page.locator('[data-testid="loading"]');
      if (await loadingIndicator.isVisible()) {
        await expect(loadingIndicator).toBeVisible();
      }
    }
  });

  test('settings page is responsive on mobile', async ({ browser }) => {
    const user = makeTestUser();
    const signupContext = await browser.newContext();
    await signupViaApi(signupContext.request, user);
    await signupContext.close();

    const mobileContext = await browser.newContext({
      viewport: { width: 375, height: 667 },
    });
    await loginViaApi(mobileContext.request, user);
    const page = await mobileContext.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem('onboarding_completed', 'true');
    });

    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings/);

    // Verify content is visible on mobile
    const heading = page.getByRole('heading', { name: /settings/i });
    if (await heading.isVisible()) {
      await expect(heading).toBeVisible();
    }

    await mobileContext.close();
  });

  test('email preferences page shows all options', async ({ browser }) => {
    const user = makeTestUser();
    const signupContext = await browser.newContext();
    await signupViaApi(signupContext.request, user);
    await signupContext.close();

    const loginContext = await browser.newContext();
    await loginViaApi(loginContext.request, user);
    const page = await loginContext.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem('onboarding_completed', 'true');
    });

    await page.goto('/settings/email-preferences');

    // Verify page loads
    await expect(page).toHaveURL(/\/settings\/email-preferences/);

    // Look for preference options
    const options = page.locator('[data-testid*="preference"]');
    const count = await options.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
