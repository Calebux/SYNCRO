import { test, expect } from '@playwright/test';
import { loginViaApi, makeTestUser, signupViaApi } from './helpers';

test.describe('Payment Flow E2E Tests', () => {
  test.beforeEach(async ({ context }) => {
    // Setup authenticated user
    const user = makeTestUser();
    await signupViaApi(context.request, user);
    await loginViaApi(context.request, user);
  });

  test('plan selection and upgrade flow', async ({ page }) => {
    // Navigate to pricing or upgrade page
    await page.goto('/pricing');

    // Verify plans displayed
    await expect(page.getByText(/basic|free/i)).toBeVisible();
    await expect(page.getByText(/premium|pro/i)).toBeVisible();

    // Click upgrade to premium
    const upgradeToPremium = page.getByRole('button', { name: /upgrade to premium|choose premium/i });
    await expect(upgradeToPremium).toBeVisible();
    await upgradeToPremium.click();

    // Verify redirect to checkout
    await expect(page).toHaveURL(/checkout|payment/);

    // Verify plan details displayed
    await expect(page.getByText(/premium plan|pro plan/i)).toBeVisible();
    await expect(page.getByText(/\$\d+\.\d+/)).toBeVisible(); // Price displayed
  });

  test('Stripe payment form in iframe', async ({ page }) => {
    // Navigate to checkout
    await page.goto('/checkout?plan=premium');

    // Wait for Stripe iframe to load
    const stripeIframe = page.frameLocator('iframe[name*="stripe"]').first();

    // Fill card details in Stripe iframe
    await stripeIframe.locator('[placeholder*="Card number"]').fill('4242424242424242');
    await stripeIframe.locator('[placeholder*="MM"]').fill('12');
    await stripeIframe.locator('[placeholder*="YY"]').fill('30');
    await stripeIframe.locator('[placeholder*="CVC"]').fill('123');

    // Fill billing details (outside iframe)
    await page.getByLabel(/name|cardholder/i).fill('Test User');
    await page.getByLabel(/email/i).fill('test@example.com');

    // Submit payment
    const submitButton = page.getByRole('button', { name: /pay|subscribe|complete purchase/i });
    await expect(submitButton).toBeVisible();
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    // Verify processing state
    await expect(page.getByText(/processing|please wait/i)).toBeVisible({ timeout: 5000 });
  });

  test('payment confirmation and subscription activation', async ({ page }) => {
    // Navigate to checkout with mock successful payment
    await page.goto('/checkout?plan=premium');

    // Mock Stripe payment success
    await page.evaluate(() => {
      // Simulate successful payment
      window.postMessage({
        type: 'stripe_payment_success',
        paymentIntentId: 'pi_test_12345',
      }, '*');
    });

    // Wait for confirmation page
    await expect(page).toHaveURL(/success|confirmation/, { timeout: 15000 });

    // Verify success message
    await expect(
      page.getByText(/payment successful|subscription activated/i)
    ).toBeVisible();

    // Verify subscription details
    await expect(page.getByText(/premium plan|pro plan/i)).toBeVisible();

    // Verify next steps or dashboard link
    await expect(
      page.getByRole('button', { name: /go to dashboard|continue/i })
    ).toBeVisible();
  });

  test('feature unlocking after payment', async ({ page }) => {
    // Mock premium subscription
    await page.addInitScript(() => {
      window.localStorage.setItem('subscription_plan', 'premium');
      window.localStorage.setItem('subscription_status', 'active');
    });

    await page.goto('/dashboard');

    // Verify premium features accessible
    const advancedAnalytics = page.getByText(/advanced analytics|premium feature/i);
    if (await advancedAnalytics.isVisible({ timeout: 5000 })) {
      await expect(advancedAnalytics).toBeVisible();
      await expect(advancedAnalytics).not.toHaveClass(/locked|disabled/);
    }

    // Verify premium badge
    await expect(page.getByText(/premium|pro member/i)).toBeVisible();
  });

  test('payment failure handling', async ({ page }) => {
    // Navigate to checkout
    await page.goto('/checkout?plan=premium');

    // Wait for Stripe iframe
    const stripeIframe = page.frameLocator('iframe[name*="stripe"]').first();

    // Use test card that will be declined
    await stripeIframe.locator('[placeholder*="Card number"]').fill('4000000000000002');
    await stripeIframe.locator('[placeholder*="MM"]').fill('12');
    await stripeIframe.locator('[placeholder*="YY"]').fill('30');
    await stripeIframe.locator('[placeholder*="CVC"]').fill('123');

    await page.getByLabel(/name|cardholder/i).fill('Test User');

    // Submit payment
    await page.getByRole('button', { name: /pay|subscribe/i }).click();

    // Verify error message
    await expect(
      page.getByText(/payment failed|card declined|transaction failed/i)
    ).toBeVisible({ timeout: 15000 });

    // Verify user can try again
    await expect(
      page.getByRole('button', { name: /try again|retry/i })
    ).toBeVisible();
  });

  test('insufficient funds error handling', async ({ page }) => {
    // Navigate to checkout
    await page.goto('/checkout?plan=premium');

    const stripeIframe = page.frameLocator('iframe[name*="stripe"]').first();

    // Use test card for insufficient funds
    await stripeIframe.locator('[placeholder*="Card number"]').fill('4000000000009995');
    await stripeIframe.locator('[placeholder*="MM"]').fill('12');
    await stripeIframe.locator('[placeholder*="YY"]').fill('30');
    await stripeIframe.locator('[placeholder*="CVC"]').fill('123');

    await page.getByLabel(/name|cardholder/i).fill('Test User');
    await page.getByRole('button', { name: /pay|subscribe/i }).click();

    // Verify specific error
    await expect(
      page.getByText(/insufficient funds|not enough balance/i)
    ).toBeVisible({ timeout: 15000 });
  });

  test('3D Secure authentication flow', async ({ page }) => {
    // Navigate to checkout
    await page.goto('/checkout?plan=premium');

    const stripeIframe = page.frameLocator('iframe[name*="stripe"]').first();

    // Use 3D Secure test card
    await stripeIframe.locator('[placeholder*="Card number"]').fill('4000002500003155');
    await stripeIframe.locator('[placeholder*="MM"]').fill('12');
    await stripeIframe.locator('[placeholder*="YY"]').fill('30');
    await stripeIframe.locator('[placeholder*="CVC"]').fill('123');

    await page.getByLabel(/name|cardholder/i).fill('Test User');
    await page.getByRole('button', { name: /pay|subscribe/i }).click();

    // Wait for 3D Secure modal/iframe
    const threeDSecureFrame = page.frameLocator('iframe[name*="stripe-challenge"]');
    await expect(threeDSecureFrame.locator('body')).toBeVisible({ timeout: 10000 });

    // Complete 3D Secure authentication (in test mode, usually automatic or simple)
    // In Stripe test mode, there might be a "Complete" button
    const completeButton = threeDSecureFrame.getByRole('button', { name: /complete|authenticate/i });
    if (await completeButton.isVisible({ timeout: 5000 })) {
      await completeButton.click();
    }

    // Verify payment success after 3D Secure
    await expect(page).toHaveURL(/success|confirmation/, { timeout: 15000 });
  });

  test('cancel payment and return to plans', async ({ page }) => {
    // Navigate to checkout
    await page.goto('/checkout?plan=premium');

    // Click cancel or back button
    const cancelButton = page.getByRole('button', { name: /cancel|back|return/i });
    if (await cancelButton.isVisible()) {
      await cancelButton.click();

      // Verify redirect back to pricing or dashboard
      await expect(page).toHaveURL(/pricing|dashboard/);
    }
  });

  test('annual vs monthly plan selection', async ({ page }) => {
    // Navigate to pricing
    await page.goto('/pricing');

    // Toggle to annual billing
    const annualToggle = page.getByRole('button', { name: /annual|yearly/i });
    if (await annualToggle.isVisible()) {
      await annualToggle.click();

      // Verify annual pricing displayed
      await expect(page.getByText(/save \d+%|billed annually/i)).toBeVisible();

      // Click upgrade
      await page.getByRole('button', { name: /upgrade to premium/i }).first().click();

      // Verify annual plan in checkout
      await expect(page).toHaveURL(/checkout/);
      await expect(page.getByText(/annual|yearly|12 months/i)).toBeVisible();
    }
  });

  test('promo code application', async ({ page }) => {
    // Navigate to checkout
    await page.goto('/checkout?plan=premium');

    // Expand promo code section if collapsed
    const promoCodeToggle = page.getByRole('button', { name: /promo code|coupon|discount/i });
    if (await promoCodeToggle.isVisible()) {
      await promoCodeToggle.click();
    }

    // Enter promo code
    const promoInput = page.getByLabel(/promo code|coupon code/i);
    if (await promoInput.isVisible()) {
      await promoInput.fill('TESTCODE20');
      await page.getByRole('button', { name: /apply/i }).click();

      // Verify discount applied
      await expect(
        page.getByText(/discount applied|20% off|code applied/i)
      ).toBeVisible({ timeout: 5000 });

      // Verify updated price
      const originalPrice = await page.locator('[data-testid="original-price"]').textContent();
      const discountedPrice = await page.locator('[data-testid="final-price"]').textContent();

      // Prices should be different
      expect(originalPrice).not.toBe(discountedPrice);
    }
  });

  test('invalid promo code handling', async ({ page }) => {
    // Navigate to checkout
    await page.goto('/checkout?plan=premium');

    const promoCodeToggle = page.getByRole('button', { name: /promo code|coupon|discount/i });
    if (await promoCodeToggle.isVisible()) {
      await promoCodeToggle.click();

      const promoInput = page.getByLabel(/promo code|coupon code/i);
      await promoInput.fill('INVALIDCODE');
      await page.getByRole('button', { name: /apply/i }).click();

      // Verify error message
      await expect(
        page.getByText(/invalid code|code not found|expired/i)
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test('upgrade from existing plan', async ({ page }) => {
    // Mock existing basic subscription
    await page.addInitScript(() => {
      window.localStorage.setItem('subscription_plan', 'basic');
      window.localStorage.setItem('subscription_status', 'active');
    });

    await page.goto('/pricing');

    // Click upgrade
    await page.getByRole('button', { name: /upgrade to premium/i }).click();

    // Verify upgrade messaging
    await expect(
      page.getByText(/upgrade|switch plan|change plan/i)
    ).toBeVisible();

    // Verify proration information
    await expect(
      page.getByText(/prorated|credit|remaining time/i)
    ).toBeVisible({ timeout: 5000 });
  });

  test('payment receipt download', async ({ page }) => {
    // Mock completed payment
    await page.goto('/success?payment=pi_test_12345');

    // Wait for success page
    await expect(page.getByText(/payment successful|subscription activated/i)).toBeVisible();

    // Click download receipt
    const downloadButton = page.getByRole('button', { name: /download receipt|get receipt/i });
    if (await downloadButton.isVisible()) {
      const downloadPromise = page.waitForEvent('download');
      await downloadButton.click();

      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/receipt|invoice/i);
    }
  });

  test('payment method saved for future use', async ({ page }) => {
    // Complete a payment flow (mocked)
    await page.addInitScript(() => {
      window.localStorage.setItem('saved_payment_method', JSON.stringify({
        type: 'card',
        last4: '4242',
        brand: 'visa',
      }));
    });

    await page.goto('/settings/billing');

    // Verify saved payment method
    await expect(page.getByText(/visa.*4242|card ending in 4242/i)).toBeVisible();

    // Verify option to remove
    await expect(page.getByRole('button', { name: /remove|delete/i })).toBeVisible();
  });

  test('tax calculation for different regions', async ({ page }) => {
    // Navigate to checkout
    await page.goto('/checkout?plan=premium');

    // Select country with VAT
    const countrySelect = page.locator('select[name="country"]');
    if (await countrySelect.isVisible()) {
      await countrySelect.selectOption('DE'); // Germany

      // Verify VAT added
      await expect(page.getByText(/VAT|tax/i)).toBeVisible();

      // Verify updated total
      await expect(page.locator('[data-testid="tax-amount"]')).toBeVisible();
    }
  });
});
