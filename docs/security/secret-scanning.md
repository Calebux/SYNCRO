# Secret Scanning & Remediation

Issue: [#1082](https://github.com/Calebux/SYNCRO/issues/1082)

Two layers stop credentials reaching the repository:

| Layer | What runs | When |
| --- | --- | --- |
| **Local (opt-in)** | `gitleaks protect --staged`, or `node scripts/scan-secrets.js --staged` if gitleaks isn't installed | Before you commit — run it yourself, or wire it into a local hook |
| **CI** | `gitleaks/gitleaks-action` + `scripts/scan-secrets.js --all` | Every push and PR to `main`/`develop`, plus a weekly full-history sweep |

The repository ships no commit hooks, so the local check is opt-in and any
hook you add can be bypassed with `--no-verify`. **CI is the gate.**

To run the local check by hand before committing:

```bash
node scripts/scan-secrets.js --staged
```

## I have a finding. What now?

### 1. Decide whether it is real

A finding is real if the value would authenticate against anything: a live API,
a hosted database, a staging environment. If you are not certain, **treat it as
real**.

### 2. If it is real — rotate first, then remove

Order matters. Removing the code does not un-leak the credential.

1. **Rotate the credential immediately** at its source (Supabase dashboard,
   Stripe dashboard, GitHub settings, …). Assume it is already compromised —
   scanners crawl public repos within seconds of a push.
2. **Remove it from the code** and read it from an environment variable
   instead. See [`SECRET_ROTATION_POLICY.md`](../SECRET_ROTATION_POLICY.md) and
   [`GITHUB_SECRETS_CHECKLIST.md`](../../GITHUB_SECRETS_CHECKLIST.md).
3. **If it was already pushed**, rotation is the fix. Rewriting history with
   `git filter-repo` or BFG is optional cleanup, requires a force-push and
   coordination with everyone who has a clone, and does *not* remove the value
   from forks, GitHub's API caches, or anyone's local copy.
4. **If it is not yet pushed**, amend it out:
   ```bash
   git restore --staged <file>   # unstage
   # remove the value from the file, then
   git add <file> && git commit --amend
   ```

### 3. If it is a false positive

Pick the narrowest option that fits.

**One line, one time** — annotate the line:

```ts
const demoToken = 'eyJhbGci...'; // gitleaks:allow — Supabase localhost demo token
```

**A whole category** — add to the `[allowlist]` table in `.gitleaks.toml`
(paths that never hold credentials, or patterns that are structurally
placeholders). Explain why in a comment; this is a security decision.

**A specific reviewed finding** — add it to `.secrets-baseline.json`:

```bash
node scripts/scan-secrets.js --all --update-baseline
```

Then **replace the generated placeholder `reason` with a real justification**.
Existing reasons are preserved across regenerations. A baseline entry says "a
human looked at this and confirmed it is not a credential" — an entry without a
reason is worthless to the next reviewer.

Baseline fingerprints are `sha256(path:rule:secret)`, so they survive the line
moving but not the file being renamed or the value changing — which is the
intent: a changed value deserves a fresh look.

## Running the scanner manually

```bash
node scripts/scan-secrets.js --staged              # what you are about to commit
node scripts/scan-secrets.js --all                 # every tracked file
node scripts/scan-secrets.js --range main..HEAD    # a branch's changes
node scripts/scan-secrets.js --all --update-baseline
```

Exit code 1 means at least one finding is neither allowlisted nor baselined.
Matched values are redacted in the output, so scanner logs are safe to paste.

With gitleaks installed locally you get the same engine CI uses:

```bash
brew install gitleaks                              # macOS
gitleaks detect --config .gitleaks.toml --redact
gitleaks protect --staged --config .gitleaks.toml --redact
```

## What the bundled scanner detects

Private key blocks, AWS access keys and secret keys, GitHub tokens, Slack tokens
and webhooks, Stripe secret keys, Google API keys, Telegram bot tokens, npm
tokens, JWTs (Supabase `service_role` keys look like this), and generic
`api_key = "…"`-style assignments with a long literal value.

It deliberately skips lockfiles, `node_modules/`, build output, and binary
files, and ignores values that reference configuration (`process.env.…`,
`${{ secrets.… }}`) or are obvious placeholders.

It is a smaller net than gitleaks' full rule set — it exists so the local check
works on a fresh clone with no extra tooling. **CI's gitleaks run is
authoritative.**

## Current baseline

14 findings are baselined, all reviewed: the Supabase local-development demo
token (published by Supabase, valid only against `localhost:54321`), test
fixtures whose realistic shape is the point of the test, and credential examples
quoted in documentation. See `.secrets-baseline.json` for the per-entry
justification.

## Never do this

- Do not commit a real credential to a `.env.example` file. CI checks these
  explicitly — they are allowlisted by path precisely because they are supposed
  to be inert.
- Do not add a path to `.gitleaks.toml` to silence a single finding. Allowlisting
  a path disables scanning for everything in it, forever.
- Do not `git commit --no-verify` past a finding you have not investigated. CI
  will catch it, and by then it is in the push.
