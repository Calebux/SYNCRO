import { test, expect } from '@playwright/test';
import { loginViaApi, makeTestUser, signupViaApi } from './helpers';

test.describe('Authentication and Onboarding E2E Tests', () => {
  test('user can sign up and log in', async ({ browser }) => {
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

    await page.goto('/');

    const individualButton = page.getByRole('button', { name: /continue as individual/i });
    if (await individualButton.isVisible()) {
      await individualButton.click();
    }

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await loginContext.close();
  });

  test('complete signup flow with email and password', async ({ page }) => {
    const user = makeTestUser();

    // Navigate to signup page
    await page.goto('/signup');

    // Fill signup form
    await page.getByLabel(/email/i).fill(user.email);
    await page.getByLabel(/^password/i).fill(user.password);
    await page.getByLabel(/confirm password/i).fill(user.password);

    // Accept terms
    const termsCheckbox = page.getByLabel(/agree to terms/i);
    if (await termsCheckbox.isVisible()) {
      await termsCheckbox.check();
    }

    // Submit form
    await page.getByRole('button', { name: /sign up|create account/i }).click();

    // Verify success message or redirect
    await expect(
      page.getByText(/account created|check your email|verify your email/i)
    ).toBeVisible({ timeout: 10000 });
  });

  test('email verification flow', async ({ page, context }) => {
    const user = makeTestUser();

    // Sign up via API
    await signupViaApi(context.request, user);

    // Simulate email verification link click
    // In a real scenario, this would come from email
    const verificationToken = 'mock-verification-token';
    await page.goto(`/verify-email?token=${verificationToken}`);

    // Verify success message
    await expect(
      page.getByText(/email verified|verification successful/i)
    ).toBeVisible({ timeout: 10000 });

    // Verify redirect to dashboard or login
    await expect(page).toHaveURL(/\/(dashboard|login)/);
  });

  test('onboarding tour completion', async ({ browser }) => {
    const user = makeTestUser();

    // Setup authenticated user
    const context = await browser.newContext();
    await signupViaApi(context.request, user);
    await loginViaApi(context.request, user);

    const page = await context.newPage();
    await page.goto('/');

    // Check if onboarding tour starts
    const tourStep1 = page.getByText(/welcome|get started|let's begin/i);
    if (await tourStep1.isVisible({ timeout: 5000 })) {
      // Step 1: Welcome
      await expect(tourStep1).toBeVisible();
      await page.getByRole('button', { name: /next|continue/i }).click();

      // Step 2: Add your first subscription
      await expect(
        page.getByText(/add subscription|track subscriptions/i)
      ).toBeVisible();
      await page.getByRole('button', { name: /next|continue/i }).click();

      // Step 3: Set budget alerts
      await expect(page.getByText(/budget|alerts|notifications/i)).toBeVisible();
      await page.getByRole('button', { name: /next|continue/i }).click();

      // Step 4: Complete tour
      await page.getByRole('button', { name: /finish|done|get started/i }).click();

      // Verify onboarding completed
      await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
    }

    await context.close();
  });

  test('skip onboarding tour', async ({ browser }) => {
    const user = makeTestUser();

    // Setup authenticated user
    const context = await browser.newContext();
    await signupViaApi(context.request, user);
    await loginViaApi(context.request, user);

    const page = await context.newPage();
    await page.goto('/');

    // Check if skip button exists
    const skipButton = page.getByRole('button', { name: /skip|skip tour/i });
    if (await skipButton.isVisible({ timeout: 5000 })) {
      await skipButton.click();

      // Verify redirect to dashboard
      await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
    }

    await context.close();
  });

  test('account creation with invalid email shows error', async ({ page }) => {
    await page.goto('/signup');

    // Fill with invalid email
    await page.getByLabel(/email/i).fill('invalid-email');
    await page.getByLabel(/^password/i).fill('Password123!');
    await page.getByLabel(/confirm password/i).fill('Password123!');

    // Submit form
    await page.getByRole('button', { name: /sign up|create account/i }).click();

    // Verify error message
    await expect(
      page.getByText(/invalid email|enter a valid email/i)
    ).toBeVisible();
  });

  test('account creation with weak password shows error', async ({ page }) => {
    const user = makeTestUser();

    await page.goto('/signup');

    // Fill with weak password
    await page.getByLabel(/email/i).fill(user.email);
    await page.getByLabel(/^password/i).fill('123');
    await page.getByLabel(/confirm password/i).fill('123');

    // Submit form
    await page.getByRole('button', { name: /sign up|create account/i }).click();

    // Verify error message
    await expect(
      page.getByText(/password.*strong|password.*characters|password.*requirements/i)
    ).toBeVisible();
  });

  test('account creation with mismatched passwords shows error', async ({ page }) => {
    const user = makeTestUser();

    await page.goto('/signup');

    // Fill with mismatched passwords
    await page.getByLabel(/email/i).fill(user.email);
    await page.getByLabel(/^password/i).fill('Password123!');
    await page.getByLabel(/confirm password/i).fill('DifferentPassword123!');

    // Submit form
    await page.getByRole('button', { name: /sign up|create account/i }).click();

    // Verify error message
    await expect(
      page.getByText(/passwords.*match|passwords.*same/i)
    ).toBeVisible();
  });

  test('prevent duplicate account creation', async ({ page, context }) => {
    const user = makeTestUser();

    // Create account via API
    await signupViaApi(context.request, user);

    // Try to sign up again with same email
    await page.goto('/signup');
    await page.getByLabel(/email/i).fill(user.email);
    await page.getByLabel(/^password/i).fill(user.password);
    await page.getByLabel(/confirm password/i).fill(user.password);

    await page.getByRole('button', { name: /sign up|create account/i }).click();

    // Verify error message
    await expect(
      page.getByText(/email.*already.*use|account.*exists/i)
    ).toBeVisible({ timeout: 10000 });
  });

  test('login with incorrect credentials shows error', async ({ page }) => {
    await page.goto('/login');

    // Fill with incorrect credentials
    await page.getByLabel(/email/i).fill('nonexistent@example.com');
    await page.getByLabel(/password/i).fill('WrongPassword123!');

    // Submit
    await page.getByRole('button', { name: /log in|sign in/i }).click();

    // Verify error message
    await expect(
      page.getByText(/invalid credentials|incorrect email or password/i)
    ).toBeVisible({ timeout: 10000 });
  });

  test('logout functionality', async ({ browser }) => {
    const user = makeTestUser();

    // Setup authenticated user
    const context = await browser.newContext();
    await signupViaApi(context.request, user);
    await loginViaApi(context.request, user);

    const page = await context.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem('onboarding_completed', 'true');
    });
    await page.goto('/');

    // Wait for dashboard
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

    // Click user menu or logout button
    const userMenuButton = page.getByRole('button', { name: /account|profile|user/i });
    if (await userMenuButton.isVisible()) {
      await userMenuButton.click();
    }

    // Click logout
    await page.getByRole('button', { name: /log out|sign out/i }).click();

    // Verify redirect to login
    await expect(page).toHaveURL(/\/(login|$)/);

    await context.close();
  });

  test('persistent session across page reloads', async ({ browser }) => {
    const user = makeTestUser();

    // Setup authenticated user
    const context = await browser.newContext();
    await signupViaApi(context.request, user);
    await loginViaApi(context.request, user);

    const page = await context.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem('onboarding_completed', 'true');
    });
    await page.goto('/');

    // Wait for dashboard
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

    // Reload page
    await page.reload();

    // Verify still authenticated
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

    await context.close();
  });
});
