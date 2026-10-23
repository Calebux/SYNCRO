# Query Layer Foundation

This document describes the shared query/cache layer established for managing remote data access throughout the SYNCRO client application.

## Overview

The query layer uses **TanStack React Query** (also known as React Query) to provide:
- Centralized cache management
- Automatic background refetching
- Optimistic updates
- Request deduplication
- Loading and error states
- Query invalidation

## Query Provider

The `QueryProvider` is mounted in `app/layout.tsx` and provides the query client to the entire application.

**Location**: `client/components/providers/query-provider.tsx`

The provider uses centralized configuration from `client/lib/query-config.ts`.

## Query Configuration

**Location**: `client/lib/query-config.ts`

### Default Policies

The shared query configuration establishes conservative defaults based on existing hook behavior:

| Setting | Value | Rationale |
|---------|-------|-----------|
| `retry` | 2 attempts | Preserves the `retryWithBackoff` pattern used in existing hooks |
| `staleTime` | 60 seconds | Data is considered fresh for 1 minute, balancing responsiveness with server load |
| `refetchOnWindowFocus` | `false` | Avoids aggressive refetching during development/debugging |
| `refetchOnReconnect` | `true` | Ensures data refresh after offline periods |
| `refetchOnMount` | `true` | Fetches fresh data when components mount |

### Mutation Policy

- `retry`: 1 attempt - Mutations retry once on failure

## Cache Key Convention

Cache keys follow a hierarchical, deterministic pattern to enable efficient invalidation and updates.

### Pattern

```typescript
// Collection queries
['resource', 'list', filters?]

// Individual resources
['resource', resourceId]

// Parameterized/action queries
['resource', 'action', params?]
```

### Examples

#### Email Accounts
```typescript
// All email accounts
['email-accounts', 'list']

// Filtered email accounts
['email-accounts', 'list', { status: 'active' }]

// Single email account
['email-account', 42]

// Primary email account
['email-accounts', 'primary']
```

#### Subscriptions
```typescript
// All subscriptions
['subscriptions', 'list']

// Filtered subscriptions
['subscriptions', 'list', { status: 'active' }]

// Single subscription
['subscription', 123]
```

#### Integrations
```typescript
// All integrations
['integrations', 'list']

// Single integration
['integration', 1]
```

### Key Factories

The `queryKeys` object in `client/lib/query-config.ts` provides factory functions for generating cache keys:

```typescript
import { queryKeys } from '@/lib/query-config';

// Use in hooks
const { data } = useQuery({
  queryKey: queryKeys.emailAccounts.lists(),
  queryFn: fetchEmailAccounts,
});
```

## Migration Status

### Completed

✅ **use-email-accounts** - First hook migrated to the shared query layer
  - Uses `useQuery` for data fetching
  - Uses `useMutation` for create/update/delete operations
  - Maintains backward-compatible public API
  - Tests updated to work with React Query

### Not Yet Migrated

The following hooks still use bespoke state management:

- `use-subscriptions` - Partially uses React Query (mutations only), needs full migration
- `use-notifications` - Uses `useState` and `useEffect`
- `use-auth` - Uses manual state management
- `use-tags` - Uses manual state management
- Other data-fetching hooks in `client/hooks/`

## API Client Pattern

API client functions are organized in `client/lib/api/` by resource:

**Example**: `client/lib/api/email-accounts.ts`

```typescript
export async function fetchEmailAccounts(): Promise<EmailAccount[]> {
  const response = await fetch("/api/email-accounts");
  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.statusText}`);
  }
  return response.json();
}
```

These functions:
- Handle HTTP requests
- Normalize API responses
- Throw errors for failed requests
- Are used by query hooks via `queryFn`

## Usage Example

### Basic Query

```typescript
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-config';
import { fetchEmailAccounts } from '@/lib/api/email-accounts';

export function useEmailAccounts() {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.emailAccounts.lists(),
    queryFn: fetchEmailAccounts,
  });

  return { emailAccounts: data, isLoading, error };
}
```

### Basic Mutation

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-config';
import { createEmailAccount } from '@/lib/api/email-accounts';

export function useCreateEmailAccount() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: createEmailAccount,
    onSuccess: () => {
      // Invalidate and refetch email accounts
      queryClient.invalidateQueries({
        queryKey: queryKeys.emailAccounts.all,
      });
    },
  });

  return mutation;
}
```

## Testing

Tests for query-based hooks require a QueryClient wrapper:

```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

test('fetches data', async () => {
  const { result } = renderHook(() => useMyHook(), {
    wrapper: createWrapper(),
  });

  await waitFor(() => {
    expect(result.current.isLoading).toBe(false);
  });

  expect(result.current.data).toBeDefined();
});
```

## Future Work

### Remaining Migrations

1. **use-subscriptions** - Complete migration (currently mixed state management)
2. **use-notifications** - Migrate to query layer
3. **use-auth** - Migrate authentication state
4. **use-tags** - Migrate tag management

### Mutation Invalidation Rules

Define which mutations should invalidate which queries:

- Subscription create/update/delete → invalidate `['subscriptions']`
- Email account changes → invalidate `['email-accounts']` and affected `['subscriptions']`
- Tag changes → invalidate `['tags']` and `['subscriptions']`

### Optimistic Updates

Implement optimistic updates for better UX:
- Subscription edits
- Tag assignments
- Email account updates

### Dashboard Auto-Refresh

After mutations, automatically refresh related dashboard data without manual page reload.

## Resources

- [TanStack Query Documentation](https://tanstack.com/query/latest/docs/framework/react/overview)
- [Query Keys Guide](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys)
- [Mutations Guide](https://tanstack.com/query/latest/docs/framework/react/guides/mutations)
