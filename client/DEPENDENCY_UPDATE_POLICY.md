# Dependency Update Policy

## Guiding Principle

All runtime and development dependencies **must** use explicit `^MAJOR.MINOR.PATCH` semver ranges in `package.json`.  
This ensures:

- **Reproducible installs** — The same resolved version is used locally, in CI, and in production.
- **Intentional upgrades** — A dependency is only updated when a human reviews and approves the change.
- **Reviewable diffs** — A PR that bumps a dependency shows exactly what changed in `package.json` and `package-lock.json`.

---

## Prohibited Range Patterns

| Pattern | Problem | Compliant alternative |
|---|---|---|
| `latest` | Resolves to the *latest published version at install time* — completely non-deterministic | `^1.2.3` |
| `*` | Same issue as `latest` | `^1.2.3` |
| `^19` (bare major, no minor/patch) | Allows any 19.x.y — minor/patch releases can contain breaking changes in practice | `^19.2.5` |
| `>=1.0.0` | Unbounded upper end — resolves to unknown future versions | `^1.2.3` |

---

## How to Add a New Dependency

```bash
# Install and record the exact resolved version
npm install <package>@<version>
# or, to get the latest and then pin it:
npm install <package>@latest
```

After installing, **check that package.json shows a full `MAJOR.MINOR.PATCH` range**, not just a major:

```diff
- "some-package": "^2"
+ "some-package": "^2.4.1"
```

Commit both `package.json` and the updated `package-lock.json`.

---

## How to Upgrade an Existing Dependency

Upgrades must be **intentional and reviewable**:

1. **Manual:** Edit `package.json` to the desired version, then run `npm install`.
2. **Automated (recommended for patch/minor):** Use [Renovate Bot](https://docs.renovatebot.com/) or [Dependabot](https://docs.github.com/en/code-security/dependabot). Both tools open PRs with changelogs, making upgrades traceable.

### Suggested Renovate Config

Create `.github/renovate.json` (or `renovate.json` at the repo root):

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended"],
  "packageRules": [
    {
      "matchUpdateTypes": ["patch"],
      "automerge": true
    },
    {
      "matchUpdateTypes": ["minor", "major"],
      "automerge": false,
      "reviewers": ["team:frontend"]
    }
  ]
}
```

This auto-merges safe patch updates and requires human review for minor/major bumps.

---

## CI Enforcement

Add the following guard to your CI pipeline (GitHub Actions example):

```yaml
- name: Verify lockfile is up-to-date
  run: npm ci --ignore-scripts
```

`npm ci` fails if `package-lock.json` is out of sync with `package.json`, preventing stale or missing lockfile issues.

Optionally, lint version ranges with a script:

```bash
# Fail if any 'latest' or bare-major pattern (e.g. "^19") is found in package.json
node -e "
const pkg = require('./package.json');
const bad = [];
for (const [name, ver] of Object.entries({...pkg.dependencies, ...pkg.devDependencies})) {
  if (ver === 'latest' || ver === '*' || /^\^?\d+$/.test(ver)) bad.push(name + '@' + ver);
}
if (bad.length) { console.error('Loose ranges found:', bad); process.exit(1); }
"
```

---

## Version History

| Date | Change | Author |
|---|---|---|
| 2026-04-28 | Initial policy; pinned `react`/`react-dom` from `^19` to `^19.2.5`; replaced `latest` on `@supabase/ssr`, `@supabase/supabase-js`, `date-fns`, `next-themes`, `react-qr-code`, `stripe` with explicit ranges | automated fix |
