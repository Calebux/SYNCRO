# Global Styles Documentation

## Single Source of Truth

**Canonical Global Stylesheet:** `client/app/globals.css`

This is the **only** global stylesheet for the SYNCRO application. All global styles, CSS variables, and theme definitions are maintained in this file.

## Location Rationale

The global stylesheet is located in `client/app/globals.css` following Next.js App Router conventions:
- Co-located with the root layout (`client/app/layout.tsx`)
- Imported directly in the layout file
- Also imported in Storybook configuration for component development

## Style Architecture

### Color System
The application uses a **Mailchimp-inspired color palette**:
- **Primary**: Deep Navy (`#1e2a35`)
- **Secondary**: Warm Mustard (`#ffd166`)
- **Accent**: Terracotta (`#e86a33`)
- **Success**: Forest Green (`#007a5c`)
- **Background**: Off-white Cream (`#f9f6f2`)

### CSS Variables
All theme variables are defined using CSS custom properties with both light and dark mode support:
- Color tokens (background, foreground, card, popover, etc.)
- Sidebar colors
- Chart colors (5 variants)
- Border radius values
- Font families (Geist Sans and Geist Mono)

### Features Included
1. **Tailwind CSS Integration**: Uses `@import "tailwindcss"` and `tw-animate-css`
2. **Dark Mode Support**: Complete dark theme with `.dark` class
3. **Accessibility**:
   - Screen reader only utility (`.sr-only`)
   - Focus visible styles for keyboard navigation
   - Minimum 44x44px touch targets on mobile
4. **Mobile Optimizations**:
   - Prevents horizontal scroll
   - Responsive touch target sizing
5. **Browser Compatibility**:
   - Flexbox prefixes for older browsers
   - Smooth scrolling
   - Optimized text rendering

## Import Usage

### Root Layout
```typescript
// client/app/layout.tsx
import "./globals.css";
```

### Storybook
```typescript
// client/.storybook/preview.ts
import '../app/globals.css'
```

## Modification Guidelines

When updating global styles:

1. **Always edit** `client/app/globals.css` - this is the single source of truth
2. **Never create** duplicate global stylesheets in other directories
3. **Test both themes**: Verify changes work in both light and dark modes
4. **Maintain accessibility**: Ensure focus states and touch targets remain compliant
5. **Update this documentation**: If adding new features or changing architecture

## CSS Variable Naming Convention

Variables follow a consistent pattern:
- Root-level: `--{name}` (e.g., `--background`, `--primary`)
- Tailwind theme: `--color-{name}` (e.g., `--color-background`, `--color-primary`)
- Radius: `--radius-{size}` (e.g., `--radius-sm`, `--radius-lg`)

## Related Files

- **Layout**: `client/app/layout.tsx` - Imports and applies global styles
- **Tailwind Config**: `client/postcss.config.mjs` - PostCSS configuration
- **Component Styles**: Individual component CSS modules (if any)
- **Storybook**: `client/.storybook/preview.ts` - Storybook style imports

## Historical Note

Previously, a duplicate global stylesheet existed at `client/styles/globals.css`. This was removed in issue #491 to establish a single source of truth and prevent style drift.

## Support

For questions about styling or to propose changes to the global stylesheet, please:
1. Review this documentation
2. Check existing CSS variables before adding new ones
3. Test changes across all pages and components
4. Ensure accessibility standards are maintained
