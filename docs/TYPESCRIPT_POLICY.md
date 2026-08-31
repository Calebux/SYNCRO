# TypeScript Version Policy

## Canonical Version

All packages in this monorepo pin to **TypeScript `^5.9.3`**.

| Package   | Version   |
|-----------|-----------|
| root      | `^5.9.3`  |
| backend   | `^5.9.3`  |
| client    | `^5.9.3`  |
| sdk       | `^5.9.3`  |
| shared    | `^5.9.3`  |

## Rationale

- TypeScript 5.x is the current stable major version.
- `^6.0.3` referenced a pre-release / nightly build that does not exist on the public npm registry as a stable release, causing toolchain instability (issue #600).
- A single version eliminates version-skew bugs between packages that share types via `@syncro/shared`.

## Upgrade Policy

1. Upgrades are evaluated when a new TypeScript **stable** minor or major is released.
2. All packages are updated together in a single PR.
3. The PR must include a passing typecheck across every package (`npm run typecheck --workspaces`).
4. Deviations (e.g. a package temporarily pinned to an older patch) must be documented here with a justification and a target remediation date.

## Current Deviations

None.
