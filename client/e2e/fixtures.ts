import { test as base } from '@playwright/test';

// Define test user credentials
export const testUser = {
  email: 'test@example.com',
  password: 'TestPassword123!',
};

// Extend base test with custom fixtures
export const test = base.extend({
  // Authenticated page fixture
  authenticatedPage: async ({ page, context }, use) => {
    // Login via API to avoid UI login for every test
    await context.request.post('/api/auth/login', {
      data: {
        email: testUser.email,
        password: testUser.password,
      },
    });

    await use(page);
  },

  // Database cleanup fixture
  cleanDatabase: async ({}, use) => {
    // Setup: Clean database before test
    // This would typically call a test API endpoint to reset state
    
    await use();

    // Teardown: Clean database after test
    // This ensures tests don't affect each other
  },
});

export { expect } from '@playwright/test';
