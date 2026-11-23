# Provider directory (console)

Public, read-only catalogue of paid APIs (#1863). It is the console side of the
provider directory API (#1829).

| Route | Purpose |
|-------|---------|
| `/directory` | Search and filter opted-in providers (category, asset, unit, price range) |
| `/directory/:providerId` | Manifest, uptime, example call, "Try in playground" |

Both routes are public: see `isPublicDirectoryRoute` in `lib/provider-directory.ts`,
used by `lib/supabase/middleware.ts`.

## API contract assumed from #1829

Unauthenticated `GET`s against `NEXT_PUBLIC_API_URL`:

- `/api/v3/directory/providers` → `{ providers: DirectoryProvider[] }`
- `/api/v3/directory/providers/:providerId` → `DirectoryProvider` (404 when missing)

`DirectoryProvider` is defined in `lib/provider-directory.ts`. If #1829 ships a
different shape, change the types and `createDirectoryClient` only; the
components and helpers depend on the types, not the wire format.

## Opt-in rule

Only providers with `optedIn === true` are ever shown. The API is expected to
filter, and the console enforces it again so a backend regression cannot list a
provider that has not consented:

- `createDirectoryClient().list()` drops non-opted-in providers.
- `createDirectoryClient().get()` treats a non-opted-in provider as not found.
- `ProviderDirectory` filters on load, so such a provider is never in page state:
  it cannot appear in the list, the filter options, or the result count.

## Accessibility (#1506)

- Every control has a visible label; the filter form is a labelled `search` landmark.
- Uptime status is always text ("Healthy", "Degraded", "Failing", "No data"),
  never colour alone.
- Result counts and copy confirmations are announced through `role="status"`;
  load failures through `role="alert"`.
- The route table has a caption and column headers; code samples are focusable
  so keyboard users can scroll them.
- `/directory` is covered by the axe scan in `e2e/accessibility.spec.ts`.

## Playground

"Try in playground" links to `/playground?provider=<id>&method=<m>&path=<p>`
(`PLAYGROUND_PATH`). The playground page itself is not part of this change.
