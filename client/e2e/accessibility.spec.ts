import { test, expect } from './fixtures';
import AxeBuilder from '@axe-core/playwright';

// Define core routes for accessibility testing
const routes = [
  { name: 'Landing Page', path: '/' },
  { name: 'Dashboard', path: '/dashboard', authenticated: true },
  { name: 'Analytics', path: '/dashboard/analytics', authenticated: true },
  { name: 'Settings', path: '/settings', authenticated: true },
  { name: '2FA Setup', path: '/auth/2fa', authenticated: true },
];

// Known violations that we are currently tracking and reducing
// Format: { route: string, ruleId: string, reason: string }
const knownViolations = [
  {
    route: '/dashboard',
    ruleId: 'color-contrast',
    reason: 'Legacy spend chart colors need updating (Issue #702)',
  },
  {
    route: '/dashboard/analytics',
    ruleId: 'region',
    reason: 'Third-party chart library missing aria-label (Issue #703)',
  },
];

test.describe('Accessibility (A11y) Checks', () => {
  for (const route of routes) {
    test(`should have no accessibility violations on ${route.name}`, async ({ page, authenticatedPage }) => {
      const targetPage = route.authenticated ? authenticatedPage : page;
      
      await targetPage.goto(route.path);
      
      // Wait for any dynamic content to load
      await targetPage.waitForLoadState('networkidle');

      const accessibilityScanResults = await new AxeBuilder({ page: targetPage })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      // Filter out known violations that are being tracked
      const filteredViolations = accessibilityScanResults.violations.filter(violation => {
        const isKnown = knownViolations.some(kv => 
          kv.route === route.path && kv.ruleId === violation.id
        );
        return !isKnown;
      });

      if (filteredViolations.length > 0) {
        console.error(`Accessibility violations on ${route.path}:`, JSON.stringify(filteredViolations, null, 2));
      }

      expect(filteredViolations).toHaveLength(0);
    });
  }
});
