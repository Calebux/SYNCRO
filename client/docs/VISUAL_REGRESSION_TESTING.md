# Visual Regression Testing Guide

## Overview

This guide explains how to manage visual regression tests for the SYNCRO dashboard and onboarding flows.

## Running Visual Regression Tests

### Update Baselines

When intentional UI changes are made, update the baseline screenshots:

```bash
cd client
npx playwright test visual-regression.spec.ts --update-snapshots
```

### Run Tests

To run visual regression tests:

```bash
cd client
npx playwright test visual-regression.spec.ts
```

### Run Specific Test

```bash
cd client
npx playwright test visual-regression.spec.ts -g "dashboard layout matches baseline - desktop"
```

## Test Coverage

### Dashboard Visual Regression
- **Desktop Layout**: Full dashboard layout on desktop viewport (1920x1080)
- **Mobile Layout**: Full dashboard layout on mobile viewport (375x667)
- **Tablet Layout**: Full dashboard layout on tablet viewport (768x1024)
- **Subscription List**: Visual regression for subscription list component
- **Spending Chart**: Visual regression for spending chart visualization
- **Dashboard Header**: Visual regression for header component

### Onboarding Flow Visual Regression
- **Step 1**: Initial onboarding step
- **Step 2**: Second onboarding step
- **Mobile Onboarding**: Onboarding flow on mobile viewport
- **Tour Highlights**: Visual regression for tour highlight overlays

### Responsive Design Verification
Tests verify responsive design across multiple viewports:
- Mobile Small (320x568)
- Mobile (375x667)
- Mobile Large (414x896)
- Tablet (768x1024)
- Desktop (1920x1080)

Ensures no horizontal scrolling and proper layout adaptation.

### Dark Mode Visual Regression
- **Dashboard Dark Mode**: Dashboard appearance in dark theme
- **Onboarding Dark Mode**: Onboarding flow in dark theme

### Accessibility Visual Verification
- **Focus Indicators**: Verifies focus indicators are visible and properly styled

## Baseline Management

### Location
Baseline screenshots are stored in:
```
client/e2e/visual-regression.spec.ts-snapshots/
```

### Reviewing Changes

When a visual regression test fails:

1. **Review the diff**: Playwright generates a diff showing what changed
2. **Verify intentionality**: Confirm the change is intentional
3. **Update baseline**: If intentional, update the baseline with `--update-snapshots`
4. **Commit changes**: Commit both code and baseline updates together

### Masking Dynamic Content

Some elements are masked to prevent false positives:
- User avatars
- Timestamps
- Dynamic data

These are masked using the `mask` option in `toHaveScreenshot()`.

## CI/CD Integration

Visual regression tests run in CI with:
- Chromium browser
- Consistent viewport sizes
- Masked dynamic content
- Artifact upload on failure

### Handling CI Failures

If visual regression tests fail in CI:

1. Download the failure artifacts from the CI run
2. Review the diff images
3. If intentional, update baselines locally and push
4. If unintentional, fix the UI issue

## Best Practices

### 1. Keep Baselines Updated
- Update baselines immediately after intentional UI changes
- Include baseline updates in the same commit as code changes
- Add clear commit messages explaining the visual changes

### 2. Minimize False Positives
- Mask dynamic content (timestamps, avatars, etc.)
- Use consistent viewport sizes
- Wait for network idle before taking screenshots
- Avoid testing with real data that changes

### 3. Review Changes Carefully
- Always review visual diffs before updating baselines
- Ensure changes match the intended design
- Check responsive variants
- Verify dark mode appearance

### 4. Test Coverage
- Test all major UI components
- Include responsive variants
- Test dark mode
- Verify accessibility features

## Troubleshooting

### Screenshots Don't Match
1. Verify the viewport size matches the baseline
2. Check if dynamic content needs masking
3. Ensure fonts are loaded (wait for networkidle)
4. Check for timing issues (use explicit waits)

### False Positives
1. Add masking for dynamic content
2. Increase wait times for animations
3. Use consistent test data
4. Check for browser-specific rendering differences

### CI Failures
1. Download artifacts from CI run
2. Compare local vs CI screenshots
3. Check for environment-specific issues (fonts, rendering)
4. Run tests locally to reproduce

## Responsive Design Testing

The visual regression suite includes tests for multiple viewports to ensure responsive design:

```typescript
const viewports = [
  { name: 'mobile-small', width: 320, height: 568 },
  { name: 'mobile', width: 375, height: 667 },
  { name: 'mobile-large', width: 414, height: 896 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1920, height: 1080 },
];
```

Each viewport is tested to ensure:
- No horizontal scrolling
- Proper layout adaptation
- Component visibility
- Touch-friendly spacing on mobile

## Dark Mode Testing

Visual regression tests verify dark mode appearance:
- Dashboard in dark theme
- Onboarding flow in dark theme
- Proper contrast ratios
- Readable text

## Accessibility Testing

Visual regression tests include accessibility verification:
- Focus indicators are visible
- Keyboard navigation works
- Color contrast is sufficient
- Interactive elements are properly sized

## Updating Documentation

When adding new visual regression tests:
1. Update this guide with test descriptions
2. Document any new masking requirements
3. Explain responsive design considerations
4. Add troubleshooting tips if needed

## Related Documentation

- [Playwright Visual Comparisons](https://playwright.dev/docs/test-snapshots)
- [E2E Testing Guide](./TEST_INFRASTRUCTURE.md)
- [Accessibility Testing](./accessibility.spec.ts)
