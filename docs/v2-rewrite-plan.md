# SYNCRO v2 rewrite: wave plan and status index

Source of truth for [#1323](https://github.com/Calebux/SYNCRO/issues/1323), the umbrella
tracking issue. This document sequences the v2 rewrite's nine epics into four waves with
explicit prerequisites, gives each wave objectively checkable exit criteria, and is the
single place to check overall progress without reading every issue.

**Last synced against GitHub:** 2026-08-31, via `gh issue list -R Calebux/SYNCRO --label
v2-rewrite`. 55 open, 45 closed (100 total). This document tracks the 55 open issues; the
titles of the 45 already-closed issues are not reproduced here — check the
[closed v2-rewrite issues](https://github.com/Calebux/SYNCRO/issues?q=is%3Aissue+is%3Aclosed+label%3Av2-rewrite)
for that history.

## How to read this document

- Every issue below is tagged with its real GitHub number, title, and epic letter (`A`–`I`),
  taken directly from each issue's `Epic: X — name` footer.
- **Waves are not epics.** An epic groups issues by *subject area*; a wave groups issues by
  *when they're safe to start*. Several epics (especially A and D) have issues split across
  multiple waves because some of their issues are enabling work and others are hardening
  work that depends on the enabling work.
- "Depends on" links point at the specific issue in this document, not at a vague epic.
- Milestones: GitHub milestones for this repo do not exist yet (checked 2026-08-31). Creating
  them (`Wave 0`, `Wave 1`, `Wave 2`, `Wave 3`) and assigning every issue below to its wave's
  milestone is the first concrete action item this document produces — see
  [Open gaps](#open-gaps-and-honest-unknowns).

## Epic key

| Letter | Epic |
|---|---|
| A | Contract foundation |
| B | Per-contract rewrites |
| C | Contract delivery & integration |
| D | Backend architecture |
| E | Backend domain rewrites |
| F | Client rewrite |
| G | SDK & shared packages |
| H | Infrastructure, CI & DevEx |
| I | Repo hygiene, docs & governance |

## Status summary

| Wave | Goal | Open issues | Status |
|---|---|---|---|
| [Wave 0](#wave-0--foundations) | Unblock everything else | 4 | Not started |
| [Wave 1](#wave-1--correctness-and-safety) | Stop active risk to user funds and auth | 13 | Not started |
| [Wave 2](#wave-2--architecture) | Structural rewrites that need Wave 0/1 underneath them | 17 | Not started |
| [Wave 3](#wave-3--hardening-polish-and-delivery) | Testing depth, delivery, and polish | 20 | Not started |

(Update the Status column as PRs land — `Not started` / `In progress` / `Blocked on #NNNN` /
`Done`. This table is the thing a reviewer should be able to read in 30 seconds.)

---

## Wave 0 — Foundations

**Goal:** land the pieces every later wave assumes exist, so no later wave has to be redone
because a foundational assumption changed underneath it.

| # | Title | Epic | Why it's Wave 0 |
|---|---|---|---|
| [#1224](https://github.com/Calebux/SYNCRO/issues/1224) | Extract a shared `syncro-contract-common` crate | A | Every other contract crate issue in Waves 1–3 either depends on shared admin/pause/error helpers this crate provides, or duplicates work this crate removes. Must land before any other contract crate change to avoid rebasing the same logic twice. |
| [#1262](https://github.com/Calebux/SYNCRO/issues/1262) | Introduce a repository layer to remove direct Supabase calls from services | D | Explicitly named in #1323's own context as a hard ordering constraint: "the repository layer precedes the domain rewrites." Blocks #1261 (layered architecture) and all of Epic E. |
| [#1228](https://github.com/Calebux/SYNCRO/issues/1228) | Reproducible WASM builds with hash verification in CI | A | Named directly in #1323's Wave 0 scope ("reproducible builds"). The deployment manifest (#1257) and every multisig/guardian approval in Wave 1 is only trustworthy if the WASM hash being approved is provably reproducible. |
| [#1317](https://github.com/Calebux/SYNCRO/issues/1317) | Root directory still contains 18 `fix*.js` scripts and placeholder files | I | Named directly in #1323's Wave 0 scope ("root cleanup"). No technical prerequisite — `good first issue` — and cheap to land first. |
| — | *config validation* | — | Named in #1323's Wave 0 scope but **no open issue matches this** — see [Open gaps](#open-gaps-and-honest-unknowns). |

**Exit criteria (objectively checkable):**
- [ ] `syncro-contract-common` is a workspace member and `grep -c 'fn require_admin' contracts/contracts/*/src/lib.rs` outside the common crate returns 0.
- [ ] At least one repository (subscriptions or payments) exists with user-scoping enforced at construction, and `grep -r 'supabase.from' backend/src/services --include='*.ts'` for that aggregate returns 0 matches outside `backend/src/repositories`.
- [ ] CI has a double-build determinism check for contract WASM and it's green on `main`.
- [ ] Repository root contains no `fix*.js`, `findbackticks.js`, `100`, `500`, or `pr_body.txt`.

---

## Wave 1 — Correctness and safety

**Goal:** close active correctness and fund-safety gaps that don't require the bigger
architectural rewrites underneath them. These are bugs and missing safety nets, not
redesigns — they should not wait on Wave 2.

| # | Title | Epic | Depends on |
|---|---|---|---|
| [#1242](https://github.com/Calebux/SYNCRO/issues/1242) | `register()` stores a bool where scopes are read as `u32` | B | none — `critical`/`p0` bug, fix first |
| [#1243](https://github.com/Calebux/SYNCRO/issues/1243) | Rewrite `Scope` as a composable bitflag set | B | #1242 — same subsystem; fix the type-confusion bug first, then replace the single-scope enum it exposed |
| [#1233](https://github.com/Calebux/SYNCRO/issues/1233) | Standardize cross-contract auth delegation between renewal, logging and virtual-card | A | #1224 |
| [#1236](https://github.com/Calebux/SYNCRO/issues/1236) | Emergency escape hatch to return user funds when a contract is frozen | A | #1224 |
| [#1235](https://github.com/Calebux/SYNCRO/issues/1235) | Migrate every contract admin to a guardian multisig | A | #1224; pairs with #1233/#1236 — same trust-model change to the same contracts |
| [#1240](https://github.com/Calebux/SYNCRO/issues/1240) | Anti-griefing limits on renewal lock acquisition | B | #1233 (uses agent-registry scopes for the owner/agent/admin check) |
| [#1270](https://github.com/Calebux/SYNCRO/issues/1270) | Apply idempotency as middleware on every mutating route | D | none — implementable as standalone Express middleware, verified in this repo |
| [#1276](https://github.com/Calebux/SYNCRO/issues/1276) | Rewrite the reminder engine as a deterministic, timezone-safe scheduler | E | none — pure-function rewrite, no dependency on the repository layer |
| [#1225](https://github.com/Calebux/SYNCRO/issues/1225) | Establish a global, unique contract error-code registry | A | #1224 |
| [#1226](https://github.com/Calebux/SYNCRO/issues/1226) | Add `version()` and interface metadata to every contract | A | #1224 |
| [#1227](https://github.com/Calebux/SYNCRO/issues/1227) | Versioned storage schema and migration path for persistent structs | A | #1224; needed before Wave 2's contract-upgrade governance work (#1255) is safe to exercise |
| [#1230](https://github.com/Calebux/SYNCRO/issues/1230) | Enable `clippy -D warnings` and a lint baseline for all contract crates | A | #1224 (fix violations once, in the crate that will absorb most of the duplicated code) |
| [#1232](https://github.com/Calebux/SYNCRO/issues/1232) | Golden-file tests pinning event payload schemas | A | none, but should land before #1237 (renew() decomposition) so the refactor has a regression safety net |
| — | *webhook pipeline* | — | Named in #1323's Wave 1 scope but **no open issue matches this** — see [Open gaps](#open-gaps-and-honest-unknowns). |

**Exit criteria:**
- [ ] `has_scope` and every `require_scope` gate return correct answers immediately after `register()`, verified by regression test.
- [ ] Every fund-holding contract (`escrow`, `payment-channel`, `virtual-card`) has an escape-hatch withdrawal path, gated only by a compile-time grace period.
- [ ] Destructive admin operations require threshold approval on every contract, not a single key.
- [ ] Payment, refund and webhook routes have replay tests proving a retried request doesn't re-execute side effects.
- [ ] A year of monthly reminders from a Jan-31 anchor produces no cumulative drift, tested across at least five timezones including both DST transitions.

---

## Wave 2 — Architecture

**Goal:** the structural rewrites that Wave 0 was built to unblock. These are large,
cross-cutting changes — do them once Wave 0/1 are stable underneath them, not before.

| # | Title | Epic | Depends on |
|---|---|---|---|
| [#1261](https://github.com/Calebux/SYNCRO/issues/1261) | Adopt a layered module architecture (route → controller → service → repository) | D | #1262 (repository layer) |
| [#1263](https://github.com/Calebux/SYNCRO/issues/1263) | Replace ad-hoc route files with a versioned router registry | D | #1261 (layering gives the registry something to route into) |
| [#1273](https://github.com/Calebux/SYNCRO/issues/1273) | Define and enforce the v2 response envelope and pagination contract | D | #1263 (envelope is implemented "in the router registry") |
| [#1274](https://github.com/Calebux/SYNCRO/issues/1274) | Generate route handlers and validators from the OpenAPI spec | D | #1263, #1273 — this is the "OpenAPI inversion" #1323 names as a hard prerequisite for client generation |
| [#1272](https://github.com/Calebux/SYNCRO/issues/1272) | Rewrite `secret-provider` with pluggable KMS and Vault backends | D | none technically, but high-risk — sequence alongside the rest of Epic D so it gets the same review attention |
| [#1277](https://github.com/Calebux/SYNCRO/issues/1277) | Model renewal execution as a saga with compensating actions | E | #1261, #1262 (saga persistence needs the repository layer) |
| [#1278](https://github.com/Calebux/SYNCRO/issues/1278) | Continuous reconciliation between on-chain state and the backend ledger | E | #1277 (reconciliation needs the saga's per-attempt state to classify discrepancies) |
| [#1255](https://github.com/Calebux/SYNCRO/issues/1255) | Govern multiple target contracts from one registry | B | #1227 (versioned storage/migration path should exist before upgrade governance is exercised across multiple targets) |
| [#1249](https://github.com/Calebux/SYNCRO/issues/1249) | Watchtower interface for third-party dispute submission | B | #1233 (cross-contract auth model) |
| [#1237](https://github.com/Calebux/SYNCRO/issues/1237) | Decompose the 268-line `renew()` into an explicit state machine | B | #1232 (golden-file event tests, as a safety net for the refactor) |
| [#1238](https://github.com/Calebux/SYNCRO/issues/1238) | Property-test the renewal state machine with proptest | B | #1237 (property-tests the state machine that issue produces) |
| [#1234](https://github.com/Calebux/SYNCRO/issues/1234) | Collision-safe monotonic ID issuance with overflow guards | A | #1224 |
| [#1299](https://github.com/Calebux/SYNCRO/issues/1299) | Define the v2 public API surface with a semver and deprecation policy | G | none — should land before other SDK v2 work so later SDK issues build against a declared surface, not an accidental one |
| [#1300](https://github.com/Calebux/SYNCRO/issues/1300) | Generate contract bindings from the WASM ABI in CI | G | #1224, #1226 (needs `version()` metadata to stamp bindings) |
| [#1301](https://github.com/Calebux/SYNCRO/issues/1301) | Dual ESM/CJS build with an exports map and tree-shaking | G | #1299 |
| [#1302](https://github.com/Calebux/SYNCRO/issues/1302) | Separate browser and Node entrypoints for crypto primitives | G | #1301 (same exports-map mechanism) |
| [#1305](https://github.com/Calebux/SYNCRO/issues/1305) | Generate types from the database schema and contract ABIs | G | #1262 (schema snapshot), #1300 (contract ABI generation) |
| — | *client data layer* | — | Named in #1323's Wave 2 scope but **no open issue matches this** — see [Open gaps](#open-gaps-and-honest-unknowns). |

**Exit criteria:**
- [ ] `backend/ARCHITECTURE.md` documents the layers and an eslint boundary rule fails CI on a violating import.
- [ ] The OpenAPI spec is the authored source; a handler that doesn't match it fails typecheck, not just review.
- [ ] Renewal state is persisted per attempt; a process killed between any two saga steps resumes or compensates correctly.
- [ ] The SDK builds as dual ESM/CJS with subpath exports, and importing one subpath is proven not to pull in another via a bundle-size fixture.

---

## Wave 3 — Hardening, polish, and delivery

**Goal:** everything that makes the rewritten system trustworthy and pleasant to work in,
but that doesn't block anything else from shipping. This wave is intentionally the largest —
it's where testing depth, delivery automation, and cross-cutting quality work lands once the
structure underneath it (Waves 0–2) has stopped moving.

| # | Title | Epic | Depends on |
|---|---|---|---|
| [#1275](https://github.com/Calebux/SYNCRO/issues/1275) | Contract tests asserting every route matches the OpenAPI schema | D | #1274 |
| [#1260](https://github.com/Calebux/SYNCRO/issues/1260) | Adversarial negative-path test suite derived from the threat model | C | #1233, #1236, #1235 (Wave 1 trust-model work should exist before testing it exhaustively) |
| [#1256](https://github.com/Calebux/SYNCRO/issues/1256) | Full-lifecycle integration test across all eight contracts | C | #1224, #1233 |
| [#1257](https://github.com/Calebux/SYNCRO/issues/1257) | Canonical deployment manifest and per-network address registry | C | #1228 (manifest records a hash that must already be reproducible) |
| [#1229](https://github.com/Calebux/SYNCRO/issues/1229) | Per-contract WASM size budgets enforced in CI | A | #1224 (budget should be set after the common-crate refactor changes baseline size) |
| [#1231](https://github.com/Calebux/SYNCRO/issues/1231) | Resource-fee and instruction budgeting harness for every entrypoint | A | #1237 (budget the decomposed `renew()`, not the 268-line version about to be replaced) |
| [#1303](https://github.com/Calebux/SYNCRO/issues/1303) | Typed error taxonomy with a documented retry and backoff policy | G | #1225 (contract error registry feeds the SDK's error decoder) |
| [#1304](https://github.com/Calebux/SYNCRO/issues/1304) | Integration suite against a local Soroban sandbox | G | #1300 (generated bindings), #1256 |
| [#1306](https://github.com/Calebux/SYNCRO/issues/1306) | Property tests for `subscription-math` | G | none |
| [#1307](https://github.com/Calebux/SYNCRO/issues/1307) | Break circular imports in `shared/src` and enforce an import graph | G | none — already delivered; see repo history |
| [#1305 dependents] | *(#1305 itself is Wave 2 — see above)* | | |
| [#1298](https://github.com/Calebux/SYNCRO/issues/1298) | Route-level code splitting audit and per-route budgets | F | #1301 (SDK tree-shaking budget work sets the pattern) |
| [#1289](https://github.com/Calebux/SYNCRO/issues/1289) | Extract shared UI primitives into a design-system package | F | none |
| [#1311](https://github.com/Calebux/SYNCRO/issues/1311) | Local stack via docker compose (Postgres, Redis, Soroban RPC, mail catcher) | H | none |
| [#1310](https://github.com/Calebux/SYNCRO/issues/1310) | One-command local bootstrap with a devcontainer | H | #1311 |
| [#1309](https://github.com/Calebux/SYNCRO/issues/1309) | Monorepo task graph with affected-package targeting and remote caching | H | none |
| [#1308](https://github.com/Calebux/SYNCRO/issues/1308) | Consolidate 23 workflows into reusable composite workflows | H | none |
| [#1314](https://github.com/Calebux/SYNCRO/issues/1314) | SBOM generation and build provenance attestation | H | #1228 (provenance is only meaningful once WASM builds are reproducible) |
| [#1313](https://github.com/Calebux/SYNCRO/issues/1313) | Automated versioning and changelogs across packages | H | #1299 (SDK semver policy should exist before automating version bumps against it) |
| [#1321](https://github.com/Calebux/SYNCRO/issues/1321) | Domain glossary and canonical data model | I | none |
| [#1322](https://github.com/Calebux/SYNCRO/issues/1322) | Rewrite issue and PR templates with automation | I | none |
| — | *theming, i18n, previews, docs site, performance budgets (client)* | — | Named in #1323's Wave 3 scope but **no open issue matches these** — see [Open gaps](#open-gaps-and-honest-unknowns). |

**Exit criteria:**
- [ ] Every documented API operation has a contract test hitting a real handler.
- [ ] A single test deploys and wires all eight contracts and drives the full renewal lifecycle, including at least four adversarial variants.
- [ ] `docker compose up` brings up a complete local stack with no external credentials, and CI integration jobs use the same compose definition.
- [ ] An SBOM and build provenance attestation are attached to every release.

---

## Open gaps and honest unknowns

This section exists so the plan doesn't quietly imply more coverage than it has. Recorded
2026-08-31, against the GitHub API (rate-limited beyond page 1 of unauthenticated browsing;
this section reflects a `gh issue list` export of all 55 open `v2-rewrite` issues, cross-checked
by hand against #1323's own wave-scope text).

**Named in #1323's own wave scope but not found among the 55 open `v2-rewrite` issues:**
- Wave 0: *config validation*
- Wave 1: *webhook pipeline* (rewrite)
- Wave 2: *client data layer*
- Wave 3: *theming*, *i18n*, *previews*, *docs site*, *client performance budgets*

Each of these is either already closed (among the 45 closed `v2-rewrite` issues, whose titles
this document does not have), not yet filed as a separate issue, or folded into the scope of
an issue with a different title than the one #1323 used. Before treating the wave plan above
as complete, whoever owns each wave should check the closed-issues list for these names and,
if genuinely missing, file them.

**Milestones do not exist yet.** Creating `Wave 0`–`Wave 3` as GitHub milestones and assigning
every issue in this document to its milestone is unstarted — acceptance criterion 1 of #1323
is not yet met.

**Two issues in this plan are already substantively complete** as of this writing (verified by
direct implementation, not by re-reading the issue): [#1270](https://github.com/Calebux/SYNCRO/issues/1270)
(idempotency middleware) and [#1307](https://github.com/Calebux/SYNCRO/issues/1307) (shared
import layering). Their wave placement above reflects where they'd sequence if starting fresh;
close them out or update their status rather than re-deriving the plan for them.

**Dependency edges above are derived from reading each issue's own Context/Scope text**, not
from GitHub's native issue-linking ("blocked by" / "blocks"). If issues are relinked using
GitHub's native dependency feature, treat that as authoritative over this document and update
this document to match, not the other way around.
