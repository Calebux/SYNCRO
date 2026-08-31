# Implementation Plan: Client Test Coverage Enhancement

## Overview

This implementation plan establishes comprehensive test coverage for the client application using TypeScript, Vitest, React Testing Library, and Playwright. The approach follows the test pyramid principle (70% unit, 20% integration, 10% E2E) and introduces reusable test utilities, coverage enforcement, and flaky test detection. All tasks build incrementally, with checkpoints to ensure stability before proceeding.

## Tasks

- [x] 1. Set up test infrastructure and configuration
  - [x] 1.1 Configure Vitest with coverage thresholds and exclusions
    - Update `vitest.config.ts` with V8 coverage provider
    - Set thresholds: 70% lines, 65% branches, 75% functions, 70% statements
    - Exclude node_modules, .storybook, stories, config files, and type definitions
    - Configure HTML, JSON, and LCOV reporters
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  
  - [x] 1.2 Configure Playwright with retry logic and reporting
    - Update `playwright.config.ts` with retry configuration (2 retries in CI, 0 locally)
    - Configure multiple reporters: list, HTML, and custom flaky reporter
    - Set up test fixtures for authentication and database state
    - _Requirements: 6.4, 9.6_
  
  - [x] 1.3 Update CI pipeline with coverage enforcement
    - Modify `.github/workflows/test.yml` to run tests with coverage
    - Add coverage threshold check step
    - Add PR comment step for coverage changes
    - Configure Codecov integration for coverage tracking
    - _Requirements: 5.2, 5.3, 5.4, 5.6_

- [x] 2. Create test utilities and helpers
  - [x] 2.1 Implement mock factories for domain models
    - Create `client/lib/test-utils/factories.ts` with faker-based factories
    - Implement `mockUser`, `mockSubscription`, `mockPayment`, `mockNotification` factories
    - Support partial overrides for flexible test data generation
    - _Requirements: 7.1_
  
  - [x] 2.2 Implement API client mocks
    - Create `client/lib/test-utils/mocks.ts` with Supabase and Stripe mocks
    - Implement `mockSupabaseClient` with chainable query methods
    - Implement `mockStripeClient` with payment and webhook methods
    - _Requirements: 7.2_
  
  - [x] 2.3 Create custom test matchers
    - Create `client/lib/test-utils/matchers.ts` with domain-specific assertions
    - Implement `toHaveSuccessResponse`, `toHaveErrorResponse`, `toBeAccessible` matchers
    - Register matchers with Vitest expect
    - _Requirements: 7.4_
  
  - [x] 2.4 Implement render helpers for React components
    - Create `client/lib/test-utils/render.ts` with provider wrappers
    - Implement `renderWithAuth` for authenticated component testing
    - Implement `renderWithProviders` for theme and query client setup
    - _Requirements: 7.5_
  
  - [x] 2.5 Create test fixtures for common scenarios
    - Create `client/lib/test-utils/fixtures.ts` with predefined data sets
    - Implement fixtures for active subscriptions, cancelled subscriptions, payment history
    - _Requirements: 7.3_

- [x] 3. Checkpoint - Verify test utilities
  - Ensure all test utilities are working correctly, ask the user if questions arise.

- [x] 4. Implement API route tests
  - [x] 4.1 Create payment API route tests
    - Create `client/app/api/payments/__tests__/route.test.ts`
    - Test payment intent creation with amount, currency, and metadata
    - Test authentication and authorization checks
    - Test error handling for invalid amounts and missing parameters
    - Test response structure and status codes
    - _Requirements: 1.1, 1.6, 2.2_
  
  - [ ]* 4.2 Write unit tests for payment API edge cases
    - Test zero amount rejection
    - Test negative amount rejection
    - Test unsupported currency handling
    - Test concurrent payment request handling
    - _Requirements: 1.6, 2.4_
  
  - [x] 4.3 Create webhook API route tests
    - Create `client/app/api/webhooks/__tests__/stripe.test.ts`
    - Test webhook signature validation with valid and invalid signatures
    - Test event parsing for payment_intent.succeeded, payment_intent.failed
    - Test database updates after successful webhook processing
    - Test idempotency for duplicate webhook events
    - _Requirements: 1.2, 1.6, 2.1, 2.5_
  
  - [ ]* 4.4 Write unit tests for webhook edge cases
    - Test malformed webhook payloads
    - Test unknown event types
    - Test webhook processing with database errors
    - _Requirements: 1.6, 2.4_
  
  - [x] 4.5 Create subscription API route tests
    - Create `client/app/api/subscriptions/__tests__/route.test.ts`
    - Test GET endpoint with filtering, pagination, and sorting
    - Test POST endpoint with validation and database insertion
    - Test authorization checks for user-owned subscriptions
    - _Requirements: 1.3, 1.6_
  
  - [x] 4.6 Create subscription detail API route tests
    - Create `client/app/api/subscriptions/__tests__/[id]/route.test.ts`
    - Test GET endpoint for single subscription retrieval
    - Test PUT endpoint for subscription updates
    - Test DELETE endpoint with soft delete logic
    - Test ownership verification for all operations
    - _Requirements: 1.3, 1.6_
  
  - [ ]* 4.7 Write unit tests for subscription API edge cases
    - Test invalid subscription ID formats
    - Test updates to non-existent subscriptions
    - Test concurrent update conflicts
    - _Requirements: 1.6_
  
  - [x] 4.8 Create analytics API route tests
    - Create `client/app/api/analytics/__tests__/route.test.ts`
    - Test spending aggregation by category and time period
    - Test date range filtering and validation
    - Test data format and structure
    - _Requirements: 1.4, 1.6_
  
  - [x] 4.9 Create tags API route tests
    - Create `client/app/api/tags/__tests__/route.test.ts`
    - Test tag creation, retrieval, update, and deletion
    - Test tag assignment to subscriptions
    - Test duplicate tag name handling
    - _Requirements: 1.5, 1.6_

- [x] 5. Checkpoint - Verify API route tests
  - Ensure all API route tests pass, ask the user if questions arise.

- [ ] 6. Implement payment and webhook integration tests
  - [ ] 6.1 Create payment flow integration tests
    - Create `client/__tests__/integration/payment-flows.test.ts`
    - Test complete payment intent creation and confirmation flow
    - Test subscription upgrade with proration calculation
    - Test subscription downgrade with credit application
    - _Requirements: 2.2, 2.3, 8.6_
  
  - [ ]* 6.2 Write integration tests for payment failure scenarios
    - Test payment failure with user notification
    - Test retry logic for transient failures
    - Test audit logging for all payment operations
    - _Requirements: 2.4, 2.6_
  
  - [ ] 6.3 Create webhook processing integration tests
    - Create `client/__tests__/integration/webhook-processing.test.ts`
    - Test end-to-end webhook signature validation and event processing
    - Test database state changes after webhook processing
    - Test notification triggers from webhook events
    - _Requirements: 2.1, 2.5, 8.6_

- [x] 7. Implement settings and security flow tests
  - [x] 7.1 Create notification settings tests
    - Create `client/app/settings/__tests__/notifications.test.tsx`
    - Test notification preference toggle rendering and state
    - Test preference updates and persistence
    - Test notification delivery based on preferences
    - _Requirements: 3.1, 4.2_
  
  - [x] 7.2 Create budget settings tests
    - Create `client/app/settings/__tests__/budget.test.tsx`
    - Test budget limit input validation (positive numbers only)
    - Test budget update submission and database persistence
    - Test budget alert threshold configuration
    - _Requirements: 3.2, 4.2_
  
  - [x] 7.3 Create MFA setup flow tests
    - Create `client/app/settings/__tests__/mfa-setup.test.tsx`
    - Test TOTP secret generation and QR code display
    - Test backup codes generation and display
    - Test token verification before enabling MFA
    - _Requirements: 3.3, 4.3_
  
  - [x] 7.4 Create MFA verification tests
    - Create `client/app/settings/__tests__/mfa-verify.test.tsx`
    - Test TOTP token validation with valid and invalid codes
    - Test session management after successful MFA verification
    - Test backup code usage and invalidation
    - _Requirements: 3.4, 4.3_
  
  - [x] 7.5 Create security settings tests
    - Create `client/app/settings/__tests__/security.test.tsx`
    - Test password change form validation
    - Test session invalidation after password change
    - Test security audit log display
    - _Requirements: 3.5, 4.2_
  
  - [x] 7.6 Create data export tests
    - Create `client/app/settings/__tests__/data-export.test.tsx`
    - Test CSV export generation with all subscription data
    - Test data completeness and format correctness
    - Test privacy compliance (PII handling)
    - _Requirements: 3.6, 4.2_

- [x] 8. Checkpoint - Verify settings and security tests
  - Ensure all settings and security tests pass, ask the user if questions arise.

- [x] 9. Implement critical component tests
  - [x] 9.1 Create subscription card component tests
    - Create `client/components/__tests__/subscription-card.test.tsx`
    - Test rendering of subscription name, price, billing cycle, and status
    - Test edit and delete action button interactions
    - Test accessibility attributes and keyboard navigation
    - Test responsive behavior and dark mode support
    - _Requirements: 4.1, 4.4, 4.6_
  
  - [ ]* 9.2 Write snapshot tests for subscription card
    - Test snapshot for active subscription state
    - Test snapshot for cancelled subscription state
    - Test snapshot for expired subscription state
    - _Requirements: 4.1_
  
  - [x] 9.3 Create notifications panel component tests
    - Create `client/components/__tests__/notifications-panel.test.tsx`
    - Test notification list rendering with multiple notifications
    - Test mark as read functionality
    - Test notification dismissal
    - Test empty state display
    - _Requirements: 4.2, 4.4_
  
  - [x] 9.4 Create spend chart component tests
    - Create `client/components/__tests__/spend-chart.test.tsx`
    - Test chart rendering with spending data
    - Test date range filtering
    - Test tooltip display on hover
    - Test responsive behavior
    - _Requirements: 4.3, 4.6_
  
  - [x] 9.5 Create modal component tests
    - Create `client/components/modals/__tests__/add-subscription.test.tsx`
    - Test modal opening and focus management
    - Test keyboard navigation (Tab, Escape)
    - Test ARIA attributes for accessibility
    - Test form submission and validation
    - _Requirements: 4.4, 4.5_
  
  - [x] 9.6 Create edit subscription modal tests
    - Create `client/components/modals/__tests__/edit-subscription.test.tsx`
    - Test pre-population of form fields with existing data
    - Test validation and error display
    - Test successful update flow
    - _Requirements: 4.4, 4.5_
  
  - [x] 9.7 Create delete confirmation modal tests
    - Create `client/components/modals/__tests__/delete-confirmation.test.tsx`
    - Test confirmation message display
    - Test cancel and confirm actions
    - Test loading state during deletion
    - _Requirements: 4.4, 4.5_
  
  - [x] 9.8 Create subscription form tests
    - Create `client/components/forms/__tests__/subscription-form.test.tsx`
    - Test form field validation (required fields, number formats)
    - Test error message display
    - Test loading state during submission
    - Test success feedback
    - _Requirements: 4.5, 4.6_
  
  - [ ]* 9.9 Write accessibility tests for all critical components
    - Run axe accessibility tests on subscription card
    - Run axe accessibility tests on notifications panel
    - Run axe accessibility tests on modals
    - Run axe accessibility tests on forms
    - _Requirements: 4.4_

- [x] 10. Checkpoint - Verify component tests
  - Ensure all component tests pass, ask the user if questions arise.

- [x] 11. Set up coverage enforcement in CI
  - [x] 11.1 Add coverage reporting to CI workflow
    - Update `.github/workflows/test.yml` with coverage report generation
    - Add step to upload coverage to Codecov
    - Add step to comment on PRs with coverage changes
    - _Requirements: 5.5, 5.6_
  
  - [x] 11.2 Configure coverage threshold checks
    - Add CI step to fail build if coverage thresholds not met
    - Configure threshold enforcement for lines, branches, functions, statements
    - _Requirements: 5.2, 5.3, 5.4_
  
  - [x] 11.3 Set up coverage badge and dashboard
    - Add coverage badge to README
    - Configure Codecov dashboard for trend tracking
    - _Requirements: 5.5_

- [x] 12. Implement flaky test detection
  - [x] 12.1 Create flaky test detector utility
    - Create `client/lib/test-utils/flaky-detector.ts`
    - Implement test result tracking with timestamps
    - Implement flake rate calculation
    - Implement flaky test flagging logic (>30% flake rate in 10 runs)
    - _Requirements: 6.1, 6.2, 6.3_
  
  - [x] 12.2 Create custom Playwright reporter for flaky tests
    - Create `client/lib/test-utils/flaky-reporter.ts`
    - Integrate with Playwright reporter API
    - Track test retries and failures
    - Generate flaky test report
    - _Requirements: 6.4, 6.6_
  
  - [x] 12.3 Implement flaky test stabilization tracking
    - Add logic to remove flaky flag after 20 consecutive passes
    - Implement dashboard for flaky test trends
    - _Requirements: 6.5, 6.6_

- [x] 13. Create integration test suite
  - [x] 13.1 Create subscription workflow integration tests
    - Create `client/__tests__/integration/subscription-workflows.test.tsx`
    - Test add subscription flow: form submission, list update, spending total update, notification
    - Test delete subscription flow: confirmation, removal, audit log, cleanup
    - Test edit subscription flow: form pre-population, update, list refresh
    - _Requirements: 8.1, 8.2, 8.6_
  
  - [x] 13.2 Create filtering and search integration tests
    - Create `client/__tests__/integration/filtering-and-search.test.tsx`
    - Test filter by tag with UI updates
    - Test filter by category with UI updates
    - Test search across name, merchant, and notes fields
    - Test combined filters and search
    - _Requirements: 8.3, 8.4, 8.6_
  
  - [x] 13.3 Create bulk operations integration tests
    - Create `client/__tests__/integration/bulk-operations.test.tsx`
    - Test bulk selection state management
    - Test bulk delete with confirmation dialog
    - Test bulk tag assignment
    - Test bulk status updates
    - _Requirements: 8.5, 8.6_
  
  - [ ]* 13.4 Write integration tests for notification workflows
    - Test notification creation from subscription events
    - Test notification delivery based on user preferences
    - Test notification dismissal and persistence
    - _Requirements: 8.6_

- [x] 14. Checkpoint - Verify integration tests
  - Ensure all integration tests pass, ask the user if questions arise.

- [x] 15. Expand E2E test suite
  - [x] 15.1 Expand signup and onboarding E2E tests
    - Update `client/e2e/auth.spec.ts` with complete signup flow
    - Test account creation with email and password
    - Test email verification flow
    - Test onboarding tour completion
    - _Requirements: 9.1, 9.6_
  
  - [x] 15.2 Create email connection E2E tests
    - Create `client/e2e/email-connection.spec.ts`
    - Test Gmail OAuth flow with popup handling
    - Test token storage and persistence
    - Test email scanning trigger
    - Test connection status display
    - _Requirements: 9.2, 9.6_
  
  - [x] 15.3 Create payment flow E2E tests
    - Create `client/e2e/payment-flows.spec.ts`
    - Test plan selection and upgrade flow
    - Test Stripe payment form in iframe
    - Test payment confirmation and subscription activation
    - Test feature unlocking after payment
    - _Requirements: 9.3, 9.6_
  
  - [x] 15.4 Create MFA E2E tests
    - Create `client/e2e/mfa-flows.spec.ts`
    - Test MFA setup flow with QR code and backup codes
    - Test TOTP token verification
    - Test login with MFA enabled
    - Test backup code usage
    - _Requirements: 9.4, 9.6_
  
  - [x] 15.5 Create data export E2E tests
    - Create `client/e2e/data-export.spec.ts`
    - Test CSV file download
    - Test file content and format
    - Test data completeness
    - _Requirements: 9.5, 9.6_
  
  - [x] 15.6 Expand subscription CRUD E2E tests
    - Update `client/e2e/subscription-flows.spec.ts` with additional scenarios
    - Test subscription creation with all fields
    - Test subscription editing with validation
    - Test subscription deletion with confirmation
    - Test subscription filtering and search
    - _Requirements: 9.6_

- [ ] 16. Checkpoint - Verify E2E tests
  - Ensure all E2E tests pass in multiple browsers, ask the user if questions arise.

- [ ] 17. Create test documentation
  - [ ] 17.1 Write testing guide
    - Create `client/docs/TESTING.md` with comprehensive testing guide
    - Document test types: unit, integration, E2E
    - Document testing conventions and best practices
    - Document when to use each test type
    - _Requirements: 10.1, 10.5_
  
  - [ ] 17.2 Document test execution and debugging
    - Add section on running tests locally and in CI
    - Add section on running tests in watch mode
    - Add section on debugging failing tests
    - Add section on interpreting coverage reports
    - _Requirements: 10.3, 10.4_
  
  - [ ] 17.3 Create testing examples
    - Add examples for common testing scenarios
    - Add examples for mocking external services
    - Add examples for testing async operations
    - Add examples for accessibility testing
    - _Requirements: 10.2_
  
  - [ ] 17.4 Document test maintenance process
    - Add guidelines for updating tests when requirements change
    - Add guidelines for handling flaky tests
    - Add guidelines for maintaining test utilities
    - _Requirements: 10.6_

- [ ] 18. Final checkpoint - Complete test suite verification
  - Run full test suite with coverage reporting
  - Verify all coverage thresholds are met
  - Verify CI pipeline passes with all checks
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation and stability
- All tests use TypeScript with Vitest, React Testing Library, and Playwright
- Test utilities are created early to enable efficient test authoring
- Coverage enforcement prevents regression in test coverage
- Flaky test detection improves CI reliability
- Integration tests verify component interactions
- E2E tests validate complete user journeys in real browsers
