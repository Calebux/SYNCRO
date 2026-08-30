# Server-First Data Layer

## Rule

> **All authenticated read-paths execute on the server.**  
> Client components are _interactive islands_ that receive pre-fetched data as props — never fetch on mount for first paint.

---

## What Belongs Where

### ✅ Server Components (app/\*\*/page.tsx)

- Fetch data directly from Supabase via `createClient()` from `@/lib/supabase/server`
- Call backend services to aggregate/transform data (**never from a client bundle**)
- Pass data as serialised props into client islands
- Handle auth checks and redirects

```tsx
// ✅ DO: Server component fetches data, passes into client island
import { getAnalyticsSummary } from "@/lib/dashboard-analytics";
import { AnalyticsPageContent } from "./analytics-content";

export default async function AnalyticsRoute() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const summary = await getAnalyticsSummary(user.id);
  return <AnalyticsPageContent initialSummary={summary} />;
}
```

### ✅ Client Components (components/\*\*/)

- Receive pre-fetched data as props — render it immediately
- Hold only **genuinely interactive** state: form inputs, modals, filter/sort, undo stacks
- May re-fetch data _after_ mount for mutations or polling, but must seed from server props

```tsx
// ✅ DO: Client island receives server data; re-fetches only on mutations
"use client";

export function SubscriptionList({ initialSubscriptions }: Props) {
  const [subs, setSubs] = useState(initialSubscriptions);   // ← seeded from server

  const handleDelete = async (id: string) => {
    await deleteSubscription(id);                           // mutation → re-fetch
    setSubs((prev) => prev.filter((s) => s.id !== id));
  };

  return subs.map((sub) => <SubscriptionCard key={sub.id} sub={sub} onDelete={handleDelete} />);
}
```

### ❌ NEVER: Client-side fetch for initial paint

```tsx
// ❌ DON'T: This produces a loading flash on every page load
"use client";

export function BadPage() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch("/api/data")              // <-- Post-mount fetch = loading state
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) return <Spinner />;  // <-- Users see this before seeing content
  return <Content data={data} />;
}
```

---

## Patterns

### 1. Single-query page

```txt
page.tsx        ← Server Component (fetch + auth + redirect)
└── content.tsx ← Client Island  (receive props, render)
```

### 2. Multi-query page

```txt
page.tsx        ← Server Component (parallel fetches)
└── page-data.ts ← Data-fetching module (separation of concerns)
└── content.tsx  ← Client Island
```

### 3. Nested routes

```txt
app/dashboard/
├── page.tsx              ← Server Component (dashboard stats)
├── dashboard-client.tsx  ← Client Island
├── analytics/
│   ├── page.tsx          ← Server Component (analytics data)
│   ├── analytics-content.tsx ← Client Island
│   └── loading.tsx       ← Skeleton fallback during SSR
```

---

## Data-Fetching Modules

Complex data transformations live in `lib/dashboard-*.ts` modules:

| Module | Purpose |
|--------|---------|
| `dashboard-analytics.ts` | Compute analytics summary from Supabase |
| `dashboard-data.ts` | Price changes & consolidation suggestions |
| `dashboard-bootstrap.ts` | Data load warnings & error handling |

All modules use `createClient()` from `@/lib/supabase/server` — never from `@/lib/supabase/client` or `browser-client`.

---

## Credential Safety

- **Never** import or use `NEXT_PUBLIC_SUPABASE_ANON_KEY` in any module that could end up in a client bundle
- Server components and server-side data modules use `@/lib/supabase/server` which accesses the key through `process.env` at build time only
- The bundle scan (`npm run check-bundle-size`) verifies no secret or service-role key leaks into client chunks
- Mutations from the client use API routes or Supabase browser client — never raw service-role tokens

---

## Before/After Reference

When adding a new server-first page, document the improvement:

| Metric | Before (client fetch) | After (server fetch) |
|--------|----------------------|----------------------|
| Time to first meaningful content | ~1.2s (spinner → content) | ~0.4s (content on first paint) |
| Post-mount network requests | 1–2 API calls | 0 (first paint) |
| Loading state visible | Yes (skeleton/spinner) | No |
| Auth token in browser requests | Yes | No (auth handled server-side) |

---

## Checklist for New Pages

- [ ] Page is a Server Component (`export default async function`)
- [ ] Auth check happens in the server component
- [ ] Data is fetched via `@/lib/supabase/server` or a `lib/dashboard-*.ts` module
- [ ] Client island receives all initial data as props
- [ ] Client island does NOT call `useEffect(fetch, [])` or `api.getX()` for first paint
- [ ] `loading.tsx` provides a skeleton/fallback during SSR
- [ ] Bundle scan passes (no service-role keys in client JS)