/**
 * Test utilities index
 * 
 * Central export point for all test utilities.
 * Import from this file to access factories, mocks, matchers, render helpers, and fixtures.
 * 
 * @example
 * import { mockUser, mockSubscription, renderWithAuth, fixtures } from '@/lib/test-utils';
 */

// Export factories
export {
  mockUser,
  mockSubscription,
  mockPayment,
  mockNotification,
  mockMFAFactor,
  mockMFAStatus,
  mockTag,
  mockWebhookEvent,
  mockCancellationGuide,
  type MockUser,
  type MockPayment,
  type MockNotification,
  type MockTag,
  type MockWebhookEvent,
} from './factories';

// Export mocks
export {
  mockSupabaseClient,
  mockStripeClient,
  mockNextRequest,
  mockNextResponse,
  mockFetch,
  type MockSupabaseClient,
  type MockStripeClient,
  type MockNextRequest,
} from './mocks';

// Export render helpers
export {
  renderWithAuth,
  renderWithProviders,
  renderWithAuthAndProviders,
  createMockAuthContext,
  waitForLoadingToFinish,
  typeWithDelay,
  submitForm,
  waitForElementToBeRemoved,
} from './render.tsx';

// Export fixtures
export { fixtures, default as defaultFixtures } from './fixtures';

// Custom matchers are automatically registered via setup.ts
// No need to export them explicitly
