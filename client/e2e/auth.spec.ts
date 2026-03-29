import { test, expect } from '@playwright/test';
import { loginViaApi, makeTestUser, signupViaApi } from './helpers';

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
