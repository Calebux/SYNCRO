# @syncro/ui

SYNCRO design-system package. Owns the shared UI primitives used across the
client. This package is the single component root for primitives — components
that were previously scattered across `client/components`, `client/src/components`,
and `client/stories` now live here.

## Public API surface

Import everything from the package entry point:

```ts
import {
  Alert,
  AriaLiveAnnouncer,
  Badge,
  Button,
  Card,
  Command,
  ConfirmationDialog,
  EmptyState,
  ErrorBoundary,
  Input,
  Label,
  LoadingSpinner,
  NotesEditor,
  Progress,
  Select,
  Skeleton,
  StatusBadge,
  Switch,
  Toast,
  ToastContainer,
  ToastProvider,
  useToast,
  showToast,
  VirtualizedList,
  AdvancedFilterBar,
  EMPTY_FILTERS,
  hasActiveFilters,
  announcePolite,
  announceAssertive,
  badgeVariants,
  buttonVariants,
  normalizeStatus,
  cn,
} from "@syncro/ui";
```

## Ownership rules

- **Single root:** all new UI primitives must be added here, not to
  `client/components`, `client/src/components`, or `client/stories`.
- **No deep imports:** importing past the entry point (e.g.
  `@syncro/ui/src/components/button`) is banned by ESLint
  (`no-restricted-imports` in `client/.eslintrc.cjs`).
- **Keep primitives dependency-free:** a primitive must not import from the
  Next.js app (`@/lib`, `@/hooks`, `@/components`). App-specific widgets that
  need client services live in `client/components/widgets`, not here.

## Development

```sh
npm install
npm run typecheck -w @syncro/ui
```

The package is workspace-resolved as raw TypeScript source
(`exports["./"].import` → `./src/index.ts`); the client transpiles it via
`transpilePackages` in `client/next.config.mjs`.