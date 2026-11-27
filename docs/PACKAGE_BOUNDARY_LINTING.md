# Package Boundary Linting

## Rules

Each package enforces `no-restricted-imports` in its ESLint config to prevent cross-layer coupling.

| Package | Forbidden imports |
|---------|------------------|
| `client` | `../backend/**`, `../sdk/src/**`, `../shared/src/**` |
| `backend` | `../client/**`, `../sdk/src/**`, `../shared/src/**` |
| `sdk` | `../client/**`, `../backend/**`, `../shared/src/**` |

**Shared code must always be consumed via the `@syncro/shared` package alias**, never via relative source paths.

## Allowed dependency direction

```
client  ──┐
backend ──┤──▶  @syncro/shared
sdk     ──┘
```

`client` and `backend` must **never** import each other. `sdk` must not import `client` or `backend`.

## CI enforcement

The `lint-backend` and `lint-client` jobs in `.github/workflows/lint.yml` run ESLint with `--max-warnings 0`. A boundary violation is an `error`-level rule and will fail the job.

The `lint-sdk` job runs on every `force_full_run` and on SDK file changes.

## Adding a new forbidden import

Edit the `no-restricted-imports` rule in the relevant `<package>/.eslintrc.cjs` (or `.eslintrc.json`) file and add a pattern with a descriptive `message`.
