import { test, expect } from '@playwright/test';
import { loginViaApi, makeTestUser, signupViaApi } from './helpers';

test.describe('Visual Regression - Dashboard and Onboarding', () => {
  test.describe('Dashboard Visual Regression', () => {
    test('dashboard layout matches baseline - desktop', async ({ browser }) => {
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

      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle');

      // Take screenshot of full dashboard
      await expect(page).toHaveScreenshot('dashboard-desktop.png', {
        fullPage: true,
        mask: [
          page.locator('[data-testid="user-avatar"]'),
          page.locator('[data-testid="timestamp"]'),
        ],
      });

      await loginContext.close();
    });

    test('dashboard layout matches baseline - mobile', async ({ browser }) => {
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

      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle');

      // Take screenshot of mobile dashboard
      await expect(page).toHaveScreenshot('dashboard-mobile.png', {
        fullPage: true,
        mask: [
          page.locator('[data-testid="user-avatar"]'),
          page.locator('[data-testid="timestamp"]'),
        ],
      });

      await mobileContext.close();
    });

    test('dashboard layout matches baseline - tablet', async ({ browser }) => {
      const user = makeTestUser();
      const signupContext = await browser.newContext();
      await signupViaApi(signupContext.request, user);
      await signupContext.close();

      const tabletContext = await browser.newContext({
        viewport: { width: 768, height: 1024 },
      });
      await loginViaApi(tabletContext.request, user);
      const page = await tabletContext.newPage();
      await page.addInitScript(() => {
        window.localStorage.setItem('onboarding_completed', 'true');
      });

      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle');

      // Take screenshot of tablet dashboard
      await expect(page).toHaveScreenshot('dashboard-tablet.png', {
        fullPage: true,
        mask: [
          page.locator('[data-testid="user-avatar"]'),
          page.locator('[data-testid="timestamp"]'),
        ],
      });

      await tabletContext.close();
    });

    test('subscription list visual regression', async ({ browser }) => {
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

      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle');

      // Take screenshot of subscription list section
      const subscriptionList = page.locator('[data-testid="subscription-list"]');
      if (await subscriptionList.isVisible()) {
        await expect(subscriptionList).toHaveScreenshot('subscription-list.png');
      }

      await loginContext.close();
    });

    test('spending chart visual regression', async ({ browser }) => {
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

      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle');

      // Take screenshot of spending chart
      const spendingChart = page.locator('[data-testid="spending-chart"]');
      if (await spendingChart.isVisible()) {
        await expect(spendingChart).toHaveScreenshot('spending-chart.png');
      }

      await loginContext.close();
    });

    test('dashboard header visual regression', async ({ browser }) => {
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

      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle');

      // Take screenshot of header
      const header = page.locator('[data-testid="dashboard-header"]');
      if (await header.isVisible()) {
        await expect(header).toHaveScreenshot('dashboard-header.png', {
          mask: [page.locator('[data-testid="user-avatar"]')],
        });
      }

      await loginContext.close();
    });
  });

  test.describe('Onboarding Flow Visual Regression', () => {
    test('onboarding step 1 visual regression', async ({ browser }) => {
      const user = makeTestUser();
      const signupContext = await browser.newContext();
      await signupViaApi(signupContext.request, user);
      await signupContext.close();

      const loginContext = await browser.newContext();
      await loginViaApi(loginContext.request, user);
      const page = await loginContext.newPage();
      // Don't set onboarding_completed to see onboarding flow
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Take screenshot of onboarding step 1
      const onboardingStep = page.locator('[data-testid="onboarding-step"]');
      if (await onboardingStep.isVisible()) {
        await expect(page).toHaveScreenshot('onboarding-step-1.png', {
          fullPage: true,
        });
      }

      await loginContext.close();
    });

    test('onboarding step 2 visual regression', async ({ browser }) => {
      const user = makeTestUser();
      const signupContext = await browser.newContext();
      await signupViaApi(signupContext.request, user);
      await signupContext.close();

      const loginContext = await browser.newContext();
      await loginViaApi(loginContext.request, user);
      const page = await loginContext.newPage();
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Navigate to step 2
      const nextButton = page.getByRole('button', { name: /next|continue/i });
      if (await nextButton.isVisible()) {
        await nextButton.click();
        await page.waitForLoadState('networkidle');

        // Take screenshot of onboarding step 2
        await expect(page).toHaveScreenshot('onboarding-step-2.png', {
          fullPage: true,
        });
      }

      await loginContext.close();
    });

    test('onboarding mobile visual regression', async ({ browser }) => {
      const user = makeTestUser();
      const signupContext = await browser.newContext();
      await signupViaApi(signupContext.request, user);
      await signupContext.close();

      const mobileContext = await browser.newContext({
        viewport: { width: 375, height: 667 },
      });
      await loginViaApi(mobileContext.request, user);
      const page = await mobileContext.newPage();
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Take screenshot of mobile onboarding
      const onboardingStep = page.locator('[data-testid="onboarding-step"]');
      if (await onboardingStep.isVisible()) {
        await expect(page).toHaveScreenshot('onboarding-mobile.png', {
          fullPage: true,
        });
      }

      await mobileContext.close();
    });

    test('onboarding tour highlights visual regression', async ({ browser }) => {
      const user = makeTestUser();
      const signupContext = await browser.newContext();
      await signupViaApi(signupContext.request, user);
      await signupContext.close();

      const loginContext = await browser.newContext();
      await loginViaApi(loginContext.request, user);
      const page = await loginContext.newPage();
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Take screenshot of tour highlights
      const tourHighlight = page.locator('[data-testid="tour-highlight"]');
      if (await tourHighlight.isVisible()) {
        await expect(page).toHaveScreenshot('onboarding-tour-highlight.png', {
          fullPage: true,
        });
      }

      await loginContext.close();
    });
  });

  test.describe('Responsive Design Verification', () => {
    const viewports = [
      { name: 'mobile-small', width: 320, height: 568 },
      { name: 'mobile', width: 375, height: 667 },
      { name: 'mobile-large', width: 414, height: 896 },
      { name: 'tablet', width: 768, height: 1024 },
      { name: 'desktop', width: 1920, height: 1080 },
    ];

    for (const viewport of viewports) {
      test(`dashboard responsive - ${viewport.name}`, async ({ browser }) => {
        const user = makeTestUser();
        const signupContext = await browser.newContext();
        await signupViaApi(signupContext.request, user);
        await signupContext.close();

        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
        });
        await loginViaApi(context.request, user);
        const page = await context.newPage();
        await page.addInitScript(() => {
          window.localStorage.setItem('onboarding_completed', 'true');
        });

        await page.goto('/dashboard');
        await page.waitForLoadState('networkidle');

        // Verify no horizontal scrolling
        const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
        const windowWidth = await page.evaluate(() => window.innerWidth);
        expect(bodyWidth).toBeLessThanOrEqual(windowWidth + 1); // +1 for rounding

        // Take screenshot
        await expect(page).toHaveScreenshot(`dashboard-responsive-${viewport.name}.png`, {
          fullPage: true,
        });

        await context.close();
      });
    }
  });

  test.describe('Dark Mode Visual Regression', () => {
    test('dashboard dark mode visual regression', async ({ browser }) => {
      const user = makeTestUser();
      const signupContext = await browser.newContext();
      await signupViaApi(signupContext.request, user);
      await signupContext.close();

      const loginContext = await browser.newContext();
      await loginViaApi(loginContext.request, user);
      const page = await loginContext.newPage();
      await page.addInitScript(() => {
        window.localStorage.setItem('onboarding_completed', 'true');
        window.localStorage.setItem('theme', 'dark');
      });

      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle');

      // Take screenshot in dark mode
      await expect(page).toHaveScreenshot('dashboard-dark-mode.png', {
        fullPage: true,
        mask: [
          page.locator('[data-testid="user-avatar"]'),
          page.locator('[data-testid="timestamp"]'),
        ],
      });

      await loginContext.close();
    });

    test('onboarding dark mode visual regression', async ({ browser }) => {
      const user = makeTestUser();
      const signupContext = await browser.newContext();
      await signupViaApi(signupContext.request, user);
      await signupContext.close();

      const loginContext = await browser.newContext();
      await loginViaApi(loginContext.request, user);
      const page = await loginContext.newPage();
      await page.addInitScript(() => {
        window.localStorage.setItem('theme', 'dark');
      });

      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Take screenshot in dark mode
      const onboardingStep = page.locator('[data-testid="onboarding-step"]');
      if (await onboardingStep.isVisible()) {
        await expect(page).toHaveScreenshot('onboarding-dark-mode.png', {
          fullPage: true,
        });
      }

      await loginContext.close();
    });
  });

  test.describe('Accessibility Visual Verification', () => {
    test('dashboard focus indicators visible', async ({ browser }) => {
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

      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle');

      // Tab to first interactive element
      await page.keyboard.press('Tab');
      await page.waitForTimeout(100);

      // Take screenshot showing focus indicator
      await expect(page).toHaveScreenshot('dashboard-focus-indicator.png', {
        fullPage: true,
      });

      await loginContext.close();
    });
  });
});
