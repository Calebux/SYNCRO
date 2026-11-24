# @syncro/shared

Shared domain models and types for the Synchro application ecosystem.

## Purpose

This package provides centralized, typed domain models used across:
- Client (Next.js frontend)
- Backend (Express API)
- SDK (TypeScript SDK)

By centralizing these types, we:
- Prevent type drift between layers
- Reduce duplication and maintenance burden
- Eliminate ad-hoc type casts
- Ensure consistent data contracts

## Installation

```bash
# In client, backend, or sdk directories
npm install ../shared
```

## Usage

```typescript
import { 
  Subscription, 
  CreateSubscriptionInput,
  Payment,
  UserProfile 
} from '@syncro/shared';

// Use in your code with full type safety
const subscription: Subscription = {
  id: '123',
  userId: 'user-456',
  name: 'Netflix',
  // ... other fields
};
```

## Versioning Strategy

This package follows semantic versioning:

- **Major version (1.x.x → 2.x.x)**: Breaking changes to domain models
  - Removing fields
  - Changing field types incompatibly
  - Renaming fields

- **Minor version (x.1.x → x.2.x)**: Backwards-compatible additions
  - Adding new optional fields
  - Adding new types
  - Extending enums

- **Patch version (x.x.1 → x.x.2)**: Non-breaking fixes
  - Documentation updates
  - Type refinements that don't break existing code

## Development

```bash
# Build the package
npm run build

# Watch for changes during development
npm run watch
```

## Migration Guide

When migrating existing code to use shared types:

1. Install the package in your workspace
2. Replace local type definitions with imports from `@syncro/shared`
3. Update any transformation functions to use the shared types
4. Run type checking to catch any mismatches
5. Update tests to use shared types

## Contributing

When adding or modifying types:
1. Consider backwards compatibility
2. Update version according to semver rules
3. Document breaking changes in CHANGELOG
4. Update dependent packages (client, backend, sdk)
