# Test Utilities

This directory contains reusable test utilities for the client application, including mock factories, API client mocks, custom matchers, render helpers, and test fixtures.

## Overview

The test utilities are designed to make writing tests easier, more consistent, and more maintainable. They provide:

- **Mock Factories**: Generate realistic test data with support for partial overrides
- **API Client Mocks**: Mock implementations of Supabase, Stripe, and other external services
- **Custom Matchers**: Domain-specific assertions for common test scenarios
- **Render Helpers**: Wrapper functions to render components with necessary providers
- **Test Fixtures**: Predefined data sets for common testing scenarios

## Installation

All test utilities are automatically available in tests through the setup file. Simply import what you need:

```typescript
import { 
  mockUser, 
  mockSubscription, 
  renderWithAuth, 
  fixtures 
} from '@/lib/test-utils';
```

## Mock Factories

Mock factories generate realistic test data using simple random generators. All factories support partial overrides.

### Available Factories

#### `mockUser(overrides?: Partial<MockUser>): MockUser`

Creates a mock user for authentication testing.

```typescript
// Default user
const user = mockUser();

// User with overrides
const admin = mockUser({ 
  email: 'admin@example.com',
  user_metadata: { role: 'admin' }
});
```

#### `mockSubscription(overrides?: Partial<Subscription>): Subscription`

Creates a mock subscription.

```typescript
const subscription = mockSubscription({
  name: 'Netflix',
  price: 15.99,
  billingCycle: 'monthly',
  status: 'active'
});
```

#### `mockPayment(overrides?: Partial<MockPayment>): MockPayment`

Creates a mock payment.

```typescript
const payment = mockPayment({
  amount: 15.99,
  status: 'succeeded',
  provider: 'stripe'
});
```

#### `mockNotification(overrides?: Partial<MockNotification>): MockNotification`

Creates a mock notification.

```typescript
const notification = mockNotification({
  type: 'renewal',
  read: false
});
```

#### Other Factories

- `mockTag()` - Creates a mock tag
- `mockMFAFactor()` - Creates a mock MFA factor
- `mockMFAStatus()` - Creates a mock MFA status
- `mockWebhookEvent()` - Creates a mock webhook event

## API Client Mocks

### Supabase Client Mock

```typescript
import { mockSupabaseClient } from '@/lib/test-utils';

const supabase = mockSupabaseClient();

// Configure mock behavior
supabase.from.mockReturnThis();
supabase.select.mockReturnThis();
supabase.single.mockResolvedValue({ 
  data: mockSubscription(), 
  error: null 
});

// Use in tests
const { data, error } = await supabase
  .from('subscriptions')
  .select('*')
  .eq('id', '123')
  .single();
```

### Stripe Client Mock

```typescript
import { mockStripeClient } from '@/lib/test-utils';

const stripe = mockStripeClient();

// Configure mock behavior
stripe.paymentIntents.create.mockResolvedValue({
  id: 'pi_test',
  status: 'succeeded'
});

// Use in tests
const paymentIntent = await stripe.paymentIntents.create({
  amount: 1000,
  currency: 'usd'
});
```

### Next.js Request Mock

```typescript
import { mockNextRequest } from '@/lib/test-utils';

const request = mockNextRequest({
  method: 'POST',
  url: 'http://localhost:3000/api/subscriptions',
  headers: { 'Content-Type': 'application/json' },
  body: { name: 'Netflix', price: 15.99 }
});
```

## Custom Matchers

Custom matchers extend Vitest's `expect` with domain-specific assertions.

### `toHaveSuccessResponse(expectedData?: unknown)`

Checks if a response has a successful API response structure.

```typescript
const response = { success: true, data: { id: '123' } };
expect(response).toHaveSuccessResponse();
expect(response).toHaveSuccessResponse({ id: '123' });
```

### `toHaveErrorResponse(expectedErrorCode?: string)`

Checks if a response has an error response structure.

```typescript
const response = { 
  success: false, 
  error: { code: 'NOT_FOUND', message: 'Not found' } 
};
expect(response).toHaveErrorResponse('NOT_FOUND');
```

### `toBeAccessible()`

Checks if an element meets basic accessibility requirements.

```typescript
const button = screen.getByRole('button');
expect(button).toBeAccessible();
```

### `toMatchPaginatedResponse()`

Checks if a response matches a paginated response structure.

```typescript
const response = {
  data: [{ id: '1' }, { id: '2' }],
  pagination: { total: 10, page: 1, pageSize: 2 }
};
expect(response).toMatchPaginatedResponse();
```

### `toHaveStatus(expectedStatus: number)`

Checks if a response has a specific HTTP status code.

```typescript
expect(response).toHaveStatus(200);
expect(response).toHaveStatus(404);
```

## Render Helpers

Render helpers provide wrapper functions to render components with necessary providers.

### `renderWithAuth(ui, user?, options?)`

Renders a component with authentication context.

```typescript
import { renderWithAuth, mockUser } from '@/lib/test-utils';
import { screen } from '@testing-library/react';

const { user } = renderWithAuth(<ProtectedComponent />);

// Interact with the component
await user.click(screen.getByRole('button'));
```

### `renderWithProviders(ui, options?)`

Renders a component with all necessary providers (theme, query client, etc.).

```typescript
import { renderWithProviders } from '@/lib/test-utils';

renderWithProviders(<MyComponent />, { 
  theme: 'dark' 
});
```

### `renderWithAuthAndProviders(ui, user?, options?)`

Renders a component with both auth and providers.

```typescript
import { renderWithAuthAndProviders, mockUser } from '@/lib/test-utils';

const admin = mockUser({ user_metadata: { role: 'admin' } });
const { user } = renderWithAuthAndProviders(<Dashboard />, admin);
```

### Helper Functions

- `waitForLoadingToFinish()` - Waits for loading states to complete
- `typeWithDelay(user, element, text, delay?)` - Simulates typing with realistic delays
- `submitForm(user, form)` - Simulates form submission
- `waitForElementToBeRemoved(callback)` - Waits for an element to be removed

## Test Fixtures

Test fixtures provide predefined data sets for common testing scenarios.

### Available Fixtures

```typescript
import { fixtures } from '@/lib/test-utils';

// Active subscriptions
fixtures.activeSubscriptions // Array of active subscriptions

// Cancelled subscriptions
fixtures.cancelledSubscriptions // Array of cancelled subscriptions

// Trial subscriptions
fixtures.trialSubscriptions // Array of trial subscriptions

// Payment history
fixtures.paymentHistory // Array of successful payments
fixtures.failedPayments // Array of failed payments
fixtures.pendingPayments // Array of pending payments

// Notifications
fixtures.notifications // All notifications
fixtures.unreadNotifications // Unread notifications only
fixtures.readNotifications // Read notifications only

// Tags
fixtures.tags // Array of tags

// Empty states
fixtures.emptyStates.subscriptions // Empty array
fixtures.emptyStates.payments // Empty array
fixtures.emptyStates.notifications // Empty array

// Edge cases
fixtures.edgeCases.expensiveSubscription // Very high price
fixtures.edgeCases.cheapSubscription // Very low price
fixtures.edgeCases.noRenewalDateSubscription // No renewal date
fixtures.edgeCases.pastRenewalSubscription // Past renewal date
```

### Usage Example

```typescript
import { fixtures } from '@/lib/test-utils';
import { render, screen } from '@testing-library/react';

test('displays active subscriptions', () => {
  render(<SubscriptionList subscriptions={fixtures.activeSubscriptions} />);
  
  expect(screen.getByText('Netflix')).toBeInTheDocument();
  expect(screen.getByText('Spotify')).toBeInTheDocument();
});

test('handles empty state', () => {
  render(<SubscriptionList subscriptions={fixtures.emptyStates.subscriptions} />);
  
  expect(screen.getByText('No subscriptions found')).toBeInTheDocument();
});
```

## Best Practices

1. **Use Factories for Dynamic Data**: Use mock factories when you need unique data for each test
2. **Use Fixtures for Static Data**: Use fixtures when you need consistent, predefined data
3. **Override Only What You Need**: Both factories and fixtures support partial overrides
4. **Mock External Services**: Always use mock clients for Supabase, Stripe, etc.
5. **Use Custom Matchers**: Use custom matchers for domain-specific assertions
6. **Render with Providers**: Always use render helpers to ensure components have necessary context

## Examples

### Testing a Component with Authentication

```typescript
import { renderWithAuth, mockUser } from '@/lib/test-utils';
import { screen } from '@testing-library/react';
import { UserProfile } from './UserProfile';

test('displays user profile', () => {
  const user = mockUser({ email: 'test@example.com' });
  renderWithAuth(<UserProfile />, user);
  
  expect(screen.getByText('test@example.com')).toBeInTheDocument();
});
```

### Testing an API Route

```typescript
import { mockSupabaseClient, mockUser, mockSubscription } from '@/lib/test-utils';
import { GET } from './route';

test('returns subscriptions for authenticated user', async () => {
  const user = mockUser();
  const subscription = mockSubscription({ user_id: user.id });
  
  const supabase = mockSupabaseClient(user);
  supabase.from.mockReturnThis();
  supabase.select.mockReturnThis();
  supabase.eq.mockResolvedValue({ data: [subscription], error: null });
  
  const response = await GET();
  const json = await response.json();
  
  expect(json).toHaveSuccessResponse();
  expect(json.data).toHaveLength(1);
});
```

### Testing with Fixtures

```typescript
import { fixtures } from '@/lib/test-utils';
import { calculateTotalSpending } from './utils';

test('calculates total spending correctly', () => {
  const total = calculateTotalSpending(fixtures.activeSubscriptions);
  
  expect(total).toBeGreaterThan(0);
});

test('handles empty subscriptions', () => {
  const total = calculateTotalSpending(fixtures.emptyStates.subscriptions);
  
  expect(total).toBe(0);
});
```

## Troubleshooting

### Import Errors

If you encounter import errors, make sure you're importing from the index file:

```typescript
// ✅ Correct
import { mockUser } from '@/lib/test-utils';

// ❌ Incorrect
import { mockUser } from '@/lib/test-utils/factories';
```

### Custom Matchers Not Working

Custom matchers are automatically registered via the setup file. Make sure your `vitest.config.ts` includes the setup file:

```typescript
export default defineConfig({
  test: {
    setupFiles: ['./lib/test-utils/setup.ts'],
  },
});
```

### JSX Syntax Errors

If you encounter JSX syntax errors in test files, make sure the file extension is `.tsx` (not `.ts`).

## Contributing

When adding new test utilities:

1. Add the utility to the appropriate file (factories.ts, mocks.ts, etc.)
2. Export it from index.ts
3. Add tests to verify it works correctly
4. Update this README with usage examples
