# Per-route bundle budgets

Budgets live in [`client/bundle-size.json`](../bundle-size.json). CI runs
`node scripts/check-bundle-size.js --json --baseline` on every pull request,
fails when a route exceeds its budget, and comments a per-route delta table.

A report is also written on every `next build` (`client/.next/route-bundle-report.json`).

## How to raise a route budget

Raising a budget is an intentional product decision, not a silent bump.

1. Measure the new size locally:

   ```bash
   cd client
   npm run build
   npm run check-bundle-size
   ```

2. Edit `budgets.perRoute["/the-route"]` (or `total` / `shared` / `perChunk`) in
   `bundle-size.json`. Values are uncompressed KB.

3. In the PR description, include:
   - the old and new budget
   - why the route grew (new dependency, feature)
   - confirmation that charting / crypto / wallet still stay off `/` and `/auth/2fa`

4. Do **not** raise `/` or `/auth/2fa` to hide a split regression. Split the
   heavy import with `next/dynamic` instead. Those routes list forbidden
   needles in `budgets.forbiddenInRoutes`.

## Splitting heavy dependencies

Charting (`recharts`, `@tremor/react`), PDF (`@react-pdf/renderer`), and wallet
code (`lib/stellar-wallet.ts`) must load only on the routes that use them.
Use `next/dynamic` or `await import()` from a click handler. Webpack cache
groups in `next.config.mjs` keep those packages in async chunks.
