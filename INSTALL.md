# Installing the SYNCRO tech-debt policy

Five files, dropped into your repo at these paths:

```
scripts/check-todos.mjs          # the scanner (zero dependencies, Node built-ins only)
DEBT.md                          # registry + triage workflow
.husky/pre-commit                # local pre-commit gate
.github/workflows/debt-policy.yml# CI gate on PRs + pushes to main
INSTALL.md                       # this file
```

## 1. Copy the files

Place each file at the path shown above, in your repo root.

## 2. Add the npm script

In `package.json`, add to `"scripts"`:

```json
{
  "scripts": {
    "lint:todos": "node scripts/check-todos.mjs"
  }
}
```

(Your current `package.json` has no `scripts` block — just add one.)

## 3. Husky

You already have `.husky/`. Make the hook executable:

```bash
chmod +x .husky/pre-commit
```

If `.husky/pre-commit` already exists, append the line
`node scripts/check-todos.mjs` to it rather than overwriting.

If Husky isn't actually initialized yet:

```bash
npm install -D husky
npx husky init
```

## 4. (Optional) ESLint in-editor hint

You have `eslint.config.mjs`. To surface bare TODOs while typing, add a rule.
Note this is a softer signal than the scanner — `no-warning-comments` can't
require the `(#NNN)` format, only flag the keywords:

```js
// eslint.config.mjs
export default [
  // ...your existing config
  {
    rules: {
      "no-warning-comments": [
        "warn",
        { terms: ["todo", "fixme"], location: "anywhere" },
      ],
    },
  },
];
```

The authoritative format enforcement stays in `scripts/check-todos.mjs`.

## 5. Verify

```bash
node scripts/check-todos.mjs
# Add a bad TODO to test the gate:
echo 'const t = 1; // TODO: no issue ref' >> backend/some-file.ts
node scripts/check-todos.mjs   # should fail with exit 1
git checkout backend/some-file.ts
```

## Tuning

- **Critical paths**: edit `CRITICAL_PATHS` in `scripts/check-todos.mjs`, and
  mirror the change in `DEBT.md`.
- **Issue format**: the scanner expects GitHub-style `(#NNN)`. If you later move
  to Jira, change the `TRACKED_TODO` regex to `/(TODO|FIXME)\((PROJ-\d+)\)/`.
- **Source extensions**: `SOURCE_EXTENSIONS` controls which files are scanned;
  markdown and docs are intentionally excluded.
