# Label Taxonomy Migration (slash → colon)

## Decision

**Colon-style labels are canonical** (e.g. `area:frontend`, `priority:p1`).

This matches the labels already present on the GitHub remote. Local
`.github/labels.yml`, triage docs, and issue templates previously used
slash-style names (`area/client`, `priority/P1`) and are updated to colon-style.

## Mapping

| Old (slash) | New (colon) | Notes |
| :--- | :--- | :--- |
| `area/client` | `area:frontend` | UI work; API routes use `area:client-api` |
| `area/backend` | `area:backend` | |
| `area/contracts` | `area:blockchain` | |
| `area/supabase` | `area:data` | |
| `area/sdk` | `area:integrations` | Shared SDK / external tooling |
| `area/shared` | `area:architecture` | Cross-cutting shared code |
| `area/docs` | `area:docs` | |
| `area/scripts` | `area:ops` | |
| `area/governance` | `area:governance` | |
| `area/ops` | `area:ops` | |
| `priority/P0` | `priority:p0` | |
| `priority/P1` | `priority:p1` | |
| `priority/P2` | `priority:p2` | |
| `priority/P3` | `priority:p2` | No remote `p3`; treat as medium |
| `type/bug` | `type:bug` | Create on GitHub if missing |
| `type/feature` | `type:feature` | |
| `type/refactor` | `type:refactor` | |
| `type/chore` | `type:chore` | |
| `type/security` | `type:security` | |
| `type/documentation` | `type:documentation` | |
| `type/performance` | `type:performance` | |
| `risk/low` | `risk:low` | |
| `risk/medium` | `risk:medium` | |
| `risk/high` | `risk:high` | |
| `status/triage` | `status:triage` | |
| `status/backlog` | `status:backlog` | |
| `status/in-progress` | `status:in-progress` | |
| `status/in-review` | `status:in-review` | |
| `status/blocked` | `status:blocked` | |
| `status/wontfix` | `status:wontfix` | |
| `status/done` | `status:done` | |

## Migrating existing issues

1. Create any missing colon-style labels from `.github/labels.yml` (GitHub UI, or a sync action).
2. For open issues still on slash-style labels, retag using the mapping above.
3. Optionally delete obsolete slash-style labels after all open issues are migrated.
4. Run drift check:

```bash
node scripts/check-label-drift.js
# Fail CI when local labels are missing remotely:
GITHUB_TOKEN=... node scripts/check-label-drift.js --strict
```

5. Confirm governance still passes:

```bash
node scripts/check-issue-governance.js
```
