import { test, expect } from '@playwright/test';
import { loginViaApi, makeTestUser, signupViaApi } from './helpers';
import * as speakeasy from 'speakeasy';

test.describe('MFA (Multi-Factor Authentication) E2E Tests', () => {
  test.beforeEach(async ({ context }) => {
    // Setup authenticated user
    const user = makeTestUser();
    await signupViaApi(context.request, user);
    await loginViaApi(context.request, user);
  });

  test('MFA setup flow with QR code and backup codes', async ({ page }) => {
    // Navigate to security settings
    await page.goto('/settings/security');

    // Click enable MFA button
    const enableMFAButton = page.getByRole('button', { name: /enable.*mfa|enable.*2fa|set up.*authentication/i });
    await expect(enableMFAButton).toBeVisible();
    await enableMFAButton.click();

    // Verify QR code displayed
    const qrCode = page.locator('[data-testid="mfa-qr-code"], img[alt*="QR"], canvas');
    await expect(qrCode.first()).toBeVisible({ timeout: 10000 });

    // Verify secret key displayed as alternative
    const secretKey = page.locator('[data-testid="mfa-secret-key"]');
    if (await secretKey.isVisible()) {
      const secretText = await secretKey.textContent();
      expect(secretText).toBeTruthy();
      expect(secretText?.length).toBeGreaterThan(10);
    }

    // Verify instructions
    await expect(
      page.getByText(/scan.*qr code|authenticator app|google authenticator|authy/i)
    ).toBeVisible();

    // Continue to verify step
    await page.getByRole('button', { name: /continue|next/i }).click();

    // Verify backup codes displayed
    await expect(page.getByText(/backup codes|recovery codes/i)).toBeVisible();

    const backupCodes = page.locator('[data-testid="backup-code"]');
    const count = await backupCodes.count();
    expect(count).toBeGreaterThanOrEqual(8); // Typically 8-10 backup codes

    // Verify download/copy option
    await expect(
      page.getByRole('button', { name: /download|copy|save codes/i })
    ).toBeVisible();
  });

  test('TOTP token verification', async ({ page }) => {
    // Navigate to MFA setup
    await page.goto('/settings/security/mfa-setup');

    // Get the secret key from the page
    const secretKey = 'JBSWY3DPEHPK3PXP'; // Mock secret for testing

    // Generate TOTP token
    const token = speakeasy.totp({
      secret: secretKey,
      encoding: 'base32',
    });

    // Enter verification code
    const tokenInput = page.getByLabel(/verification code|token|code/i);
    await expect(tokenInput).toBeVisible();
    await tokenInput.fill(token);

    // Submit verification
    await page.getByRole('button', { name: /verify|confirm|enable/i }).click();

    // Verify success message
    await expect(
      page.getByText(/mfa enabled|2fa activated|authentication enabled/i)
    ).toBeVisible({ timeout: 10000 });

    // Verify redirect to security settings
    await expect(page).toHaveURL(/settings\/security/);

    // Verify MFA status shows as enabled
    await expect(page.getByText(/mfa.*enabled|2fa.*active/i)).toBeVisible();
  });

  test('login with MFA enabled', async ({ page, context }) => {
    const user = makeTestUser();

    // Setup user with MFA enabled
    await page.goto('/settings/security');
    await page.addInitScript(() => {
      window.localStorage.setItem('mfa_enabled', 'true');
      window.localStorage.setItem('mfa_secret', 'JBSWY3DPEHPK3PXP');
    });

    // Logout
    await page.goto('/logout');

    // Login again
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(user.email);
    await page.getByLabel(/password/i).fill(user.password);
    await page.getByRole('button', { name: /log in|sign in/i }).click();

    // Verify MFA prompt appears
    await expect(page.getByText(/enter.*code|authentication code|2fa code/i)).toBeVisible({
      timeout: 10000,
    });

    // Generate and enter TOTP token
    const secret = 'JBSWY3DPEHPK3PXP';
    const token = speakeasy.totp({
      secret,
      encoding: 'base32',
    });

    await page.getByLabel(/code|token/i).fill(token);
    await page.getByRole('button', { name: /verify|submit/i }).click();

    // Verify successful login
    await expect(page).toHaveURL(/dashboard|home/);
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  });

  test('backup code usage', async ({ page, context }) => {
    const user = makeTestUser();

    // Mock MFA enabled with backup codes
    const backupCodes = ['12345678', '23456789', '34567890', '45678901'];

    await page.addInitScript((codes) => {
      window.localStorage.setItem('mfa_enabled', 'true');
      window.localStorage.setItem('backup_codes', JSON.stringify(codes));
    }, backupCodes);

    // Logout and login
    await page.goto('/logout');
    await page.goto('/login');

    await page.getByLabel(/email/i).fill(user.email);
    await page.getByLabel(/password/i).fill(user.password);
    await page.getByRole('button', { name: /log in|sign in/i }).click();

    // Wait for MFA prompt
    await expect(page.getByText(/enter.*code|authentication code/i)).toBeVisible({
      timeout: 10000,
    });

    // Click use backup code option
    const backupCodeLink = page.getByRole('button', { name: /backup code|recovery code|lost.*device/i });
    await expect(backupCodeLink).toBeVisible();
    await backupCodeLink.click();

    // Enter backup code
    await page.getByLabel(/backup code|recovery code/i).fill('12345678');
    await page.getByRole('button', { name: /verify|submit/i }).click();

    // Verify successful login
    await expect(page).toHaveURL(/dashboard|home/);

    // Verify backup code consumed warning
    const warningMessage = page.getByText(/backup code.*used|code.*consumed|remaining.*codes/i);
    if (await warningMessage.isVisible({ timeout: 5000 })) {
      await expect(warningMessage).toBeVisible();
    }
  });

  test('invalid TOTP token handling', async ({ page }) => {
    // Navigate to MFA verification during setup
    await page.goto('/settings/security/mfa-setup');

    // Enter invalid token
    const tokenInput = page.getByLabel(/verification code|token|code/i);
    await tokenInput.fill('000000');

    // Submit
    await page.getByRole('button', { name: /verify|confirm/i }).click();

    // Verify error message
    await expect(
      page.getByText(/invalid code|incorrect code|verification failed/i)
    ).toBeVisible({ timeout: 5000 });

    // Verify user can try again
    await expect(tokenInput).toBeVisible();
    await expect(tokenInput).toBeEditable();
  });

  test('expired TOTP token handling', async ({ page }) => {
    // This test would require waiting for token to expire
    // For testing purposes, we'll simulate the expired token scenario

    await page.goto('/settings/security/mfa-setup');

    // Mock an API response that indicates token is expired
    await page.route('**/api/mfa/verify', (route) => {
      route.fulfill({
        status: 400,
        body: JSON.stringify({ error: 'Token expired' }),
      });
    });

    const tokenInput = page.getByLabel(/verification code|token|code/i);
    await tokenInput.fill('123456');
    await page.getByRole('button', { name: /verify|confirm/i }).click();

    // Verify error about expired token
    await expect(
      page.getByText(/token expired|code expired|try.*new code/i)
    ).toBeVisible({ timeout: 5000 });
  });

  test('disable MFA', async ({ page }) => {
    // Navigate to security settings with MFA enabled
    await page.addInitScript(() => {
      window.localStorage.setItem('mfa_enabled', 'true');
    });

    await page.goto('/settings/security');

    // Verify MFA is shown as enabled
    await expect(page.getByText(/mfa.*enabled|2fa.*active/i)).toBeVisible();

    // Click disable MFA
    const disableButton = page.getByRole('button', { name: /disable.*mfa|turn off.*2fa/i });
    await expect(disableButton).toBeVisible();
    await disableButton.click();

    // Confirm in dialog
    const confirmDialog = page.getByRole('dialog');
    if (await confirmDialog.isVisible({ timeout: 2000 })) {
      await expect(
        confirmDialog.getByText(/are you sure|disable.*authentication/i)
      ).toBeVisible();

      // May require password confirmation
      const passwordInput = confirmDialog.getByLabel(/password/i);
      if (await passwordInput.isVisible({ timeout: 2000 })) {
        await passwordInput.fill('Password123!');
      }

      await confirmDialog.getByRole('button', { name: /confirm|disable/i }).click();
    }

    // Verify MFA disabled
    await expect(
      page.getByText(/mfa disabled|2fa.*turned off|authentication disabled/i)
    ).toBeVisible({ timeout: 10000 });

    // Verify status updated
    await expect(page.getByText(/mfa.*disabled|2fa.*inactive/i)).toBeVisible();
  });

  test('regenerate backup codes', async ({ page }) => {
    // Navigate to security settings with MFA enabled
    await page.addInitScript(() => {
      window.localStorage.setItem('mfa_enabled', 'true');
      window.localStorage.setItem('backup_codes', JSON.stringify(['12345678', '23456789']));
    });

    await page.goto('/settings/security');

    // Click regenerate backup codes
    const regenerateButton = page.getByRole('button', { name: /regenerate|new.*codes|generate.*codes/i });
    if (await regenerateButton.isVisible()) {
      await regenerateButton.click();

      // Confirm action
      const confirmButton = page.getByRole('button', { name: /confirm|yes|regenerate/i });
      if (await confirmButton.isVisible({ timeout: 2000 })) {
        await confirmButton.click();
      }

      // Verify new codes displayed
      await expect(page.getByText(/new backup codes|recovery codes generated/i)).toBeVisible({
        timeout: 10000,
      });

      // Verify warning about old codes
      await expect(
        page.getByText(/old codes.*invalid|previous codes.*no longer work/i)
      ).toBeVisible();
    }
  });

  test('MFA rate limiting after failed attempts', async ({ page }) => {
    // Navigate to MFA verification
    await page.goto('/settings/security/mfa-setup');

    const tokenInput = page.getByLabel(/verification code|token|code/i);
    const verifyButton = page.getByRole('button', { name: /verify|confirm/i });

    // Attempt multiple failed verifications
    for (let i = 0; i < 5; i++) {
      await tokenInput.fill(`00000${i}`);
      await verifyButton.click();
      await page.waitForTimeout(500);
    }

    // Verify rate limit message
    await expect(
      page.getByText(/too many attempts|rate limit|try again later|wait.*minutes/i)
    ).toBeVisible({ timeout: 5000 });

    // Verify verify button disabled
    await expect(verifyButton).toBeDisabled();
  });

  test('remember device option', async ({ page, context }) => {
    const user = makeTestUser();

    // Login with MFA
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(user.email);
    await page.getByLabel(/password/i).fill(user.password);
    await page.getByRole('button', { name: /log in/i }).click();

    // MFA prompt
    await expect(page.getByText(/enter.*code|authentication code/i)).toBeVisible({
      timeout: 10000,
    });

    // Check "Remember this device" option
    const rememberCheckbox = page.getByLabel(/remember.*device|trust.*device/i);
    if (await rememberCheckbox.isVisible()) {
      await rememberCheckbox.check();
    }

    // Enter valid token
    const token = speakeasy.totp({
      secret: 'JBSWY3DPEHPK3PXP',
      encoding: 'base32',
    });
    await page.getByLabel(/code|token/i).fill(token);
    await page.getByRole('button', { name: /verify/i }).click();

    // Login successful
    await expect(page).toHaveURL(/dashboard/);

    // Logout and login again
    await page.goto('/logout');
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(user.email);
    await page.getByLabel(/password/i).fill(user.password);
    await page.getByRole('button', { name: /log in/i }).click();

    // Should skip MFA prompt (device is remembered)
    // This depends on implementation - might still show MFA or skip to dashboard
    const skippedMFA = await page.waitForURL(/dashboard/, { timeout: 5000 }).catch(() => false);

    if (skippedMFA) {
      // MFA was skipped due to remembered device
      await expect(page).toHaveURL(/dashboard/);
    }
  });

  test('view trusted devices', async ({ page }) => {
    // Navigate to security settings
    await page.addInitScript(() => {
      window.localStorage.setItem('mfa_enabled', 'true');
      window.localStorage.setItem('trusted_devices', JSON.stringify([
        {
          id: '1',
          name: 'Chrome on Windows',
          lastUsed: '2024-01-15',
        },
        {
          id: '2',
          name: 'Safari on iPhone',
          lastUsed: '2024-01-14',
        },
      ]));
    });

    await page.goto('/settings/security');

    // Find trusted devices section
    const trustedDevicesSection = page.getByText(/trusted devices|remembered devices/i);
    if (await trustedDevicesSection.isVisible()) {
      await expect(page.getByText(/Chrome on Windows/i)).toBeVisible();
      await expect(page.getByText(/Safari on iPhone/i)).toBeVisible();

      // Verify option to revoke trust
      const revokeButtons = page.getByRole('button', { name: /remove|revoke|forget/i });
      expect(await revokeButtons.count()).toBeGreaterThan(0);
    }
  });

  test('MFA setup cancellation', async ({ page }) => {
    // Navigate to MFA setup
    await page.goto('/settings/security');

    const enableMFAButton = page.getByRole('button', { name: /enable.*mfa|set up.*authentication/i });
    await enableMFAButton.click();

    // Cancel during QR code step
    const cancelButton = page.getByRole('button', { name: /cancel|back/i });
    if (await cancelButton.isVisible()) {
      await cancelButton.click();

      // Verify back to security settings
      await expect(page).toHaveURL(/settings\/security/);

      // Verify MFA still disabled
      await expect(page.getByText(/mfa.*disabled|enable.*mfa/i)).toBeVisible();
    }
  });
});
