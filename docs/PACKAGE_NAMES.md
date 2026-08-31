# Package naming

All first-party npm packages use the `@syncro/*` scope with intentional names:

| Path | Package name |
|------|----------------|
| `client/package.json` | `@syncro/client` |
| `backend/package.json` | `@syncro/backend` |
| `sdk/package.json` | `@syncro/sdk` |
| `shared/package.json` | `@syncro/shared` |

Placeholder names (for example `my-v0-project` from v0 scaffolding) are not allowed.

## Validation

```bash
node scripts/check-package-names.js
node --test scripts/check-package-names.test.js
```

CI runs `check-package-names.js` on every pull request.
