#!/usr/bin/env node
/*
 * Dependency Vulnerability Gate
 *
 * Runs `npm audit --json` in a workspace directory, classifies each finding
 * by GHSA advisory id (walking transitive via-chains), and blocks CI when a
 * High or Critical advisory is present that is NOT in the triaged allowlist
 * at `.github/dependency-audit-allowlist.json`, or whose allowlist entry has
 * passed its `expires_at` date.
 *
 * Severity model (issue #1079 acceptance criteria):
 *   critical  - hard-fail unless triaged
 *   high      - hard-fail unless triaged
 *   moderate  - warn-only (printed, does not block)
 *   low       - warn-only (printed, does not block)
 *
 * Usage:
 *   node scripts/security-audit-gate.js <workspace-dir> [<workspace-name>]
 *
 * Exit codes:
 *   0 - clean or every high/critical finding is triaged + unexpired
 *   1 - unallowed high/critical finding, or expired allowlist entry that
 *       applies to this workspace
 *   2 - usage / allowlist-load error
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ALLOWLIST_PATH = path.join(ROOT, '.github', 'dependency-audit-allowlist.json');

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Usage: node scripts/security-audit-gate.js <workspace-dir> [<workspace-name>]');
  process.exit(2);
}
const [workspaceDir, workspaceName = path.basename(workspaceDir)] = args;
const absDir = path.resolve(ROOT, workspaceDir);

// Load and validate allowlist --------------------------------------------------
if (!fs.existsSync(ALLOWLIST_PATH)) {
  console.error(`Allowlist not found: ${ALLOWLIST_PATH}`);
  console.error('Create one, or restore from git, before enabling this gate.');
  process.exit(2);
}

/** @type {{ ignored_advisories: Record<string, any> }} */
const raw = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
const source = raw.ignored_advisories || {};
if (typeof source !== 'object') {
  console.error('Allowlist is malformed: "ignored_advisories" must be an object keyed by GHSA id.');
  process.exit(2);
}

// Canonicalize GHSA keys to UPPERCASE so a future contributor can paste them
// in any case and the match still works.
const allowlist = Object.create(null);
for (const [k, v] of Object.entries(source)) {
  if (!v || typeof v !== 'object') {
    console.error(`Allowlist entry ${k} is malformed.`);
    process.exit(2);
  }
  if (!v.expires_at || isNaN(Date.parse(v.expires_at))) {
    console.error(`Allowlist entry ${k} is missing or has a bad "expires_at" date.`);
    process.exit(2);
  }
  allowlist[k.toUpperCase()] = v;
}

const today = new Date();

// Expired entries for THIS workspace go straight to blockers so a forgotten
// accept cannot silently outlive its promised review date even after the
// underlying advisory is no longer reported.
const expiredForWorkspace = Object.entries(allowlist)
  .filter(([, e]) => new Date(e.expires_at) < today && matchesWorkspace(e))
  .map(([ghsa, e]) => ({ ghsa, package: e.package, severity: e.severity, expires_at: e.expires_at }));

// Run npm audit --json ---------------------------------------------------------
console.log(`▶ Running npm audit in ${workspaceName} (${absDir})…`);
// `--audit-level=none` keeps `npm audit` from exiting non-zero on its own so
// the JSON document is always produced and we can classify on our side.
// However, npm still exits non-zero on lockfile mismatch, registry failures,
// or broken `node_modules`. Wrap defensively and fall back to its stdout
// (which is usually valid JSON with a top-level `error` key in those cases).
let stdout;
try {
  stdout = execFileSync(
    'npm',
    ['audit', '--json', '--audit-level=none'],
    { cwd: absDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
  );
} catch (err) {
  if (err && err.stdout) {
    stdout = String(err.stdout);
  } else {
    console.error(`✗ npm audit in ${workspaceName} crashed with no JSON output:`);
    console.error(`  ${(err && err.message) || err}`);
    process.exit(1);
  }
}
let audit;
try {
  audit = JSON.parse(stdout);
} catch (e) {
  console.error(`✗ Could not parse npm audit JSON in ${workspaceName}: ${e.message}`);
  process.exit(1);
}

// Fail-open guard: if npm put a top-level `error` (lockfile mismatch, registry
// lookup failure, etc.) and reported zero advisories, treat that as suspect.
// A clean workspace with no vulnerabilities has no `error` key.
if (audit.error) {
  console.error(`✗ npm audit reported an error in ${workspaceName}:`);
  console.error(`  ${JSON.stringify(audit.error)}`);
  console.error(`Refusing to trust an empty vulnerability map alongside an error; exiting 1.`);
  process.exit(1);
}

// Classify findings ------------------------------------------------------------
const vulnerabilities = audit.vulnerabilities || {};

/**
 * Recursively collect GHSA ids from a finding and its transitive via-chain.
 *
 * `npm audit --json` collapses findings to their top-level package, but the
 * `via` array mixes two shapes:
 *   - objects with a `url` pointing at a GitHub advisory (the GHSA we want)
 *   - strings that reference another vulnerable package in `vulnerabilities`
 *     (a transitive parent whose own via array has the actual GHSA)
 *
 * We walk both shapes so an allowlisted GHSA also covers the parent-less
 * transitive children that npm would otherwise surface as duplicates.
 */
function collectGhsas(pkgName, visited = new Set()) {
  const ids = new Set();
  if (visited.has(pkgName)) return ids;
  visited.add(pkgName);

  const finding = vulnerabilities[pkgName];
  if (!finding || !Array.isArray(finding.via)) return ids;

  for (const v of finding.via) {
    if (v && typeof v === 'object' && v.url) {
      const m = String(v.url).match(/GHSA-[a-z0-9-]+/i);
      if (m) ids.add(m[0].toUpperCase());
    } else if (typeof v === 'string') {
      for (const id of collectGhsas(v, visited)) ids.add(id);
    }
  }
  return ids;
}

const blockers = [];
const triagedFindings = [];
const informationalFindings = [];
const noGhsaFindings = [];

for (const [pkgName, finding] of Object.entries(vulnerabilities)) {
  const ghsas = [...collectGhsas(pkgName)];
  const sev = finding.severity;

  // Findings whose via-chain didn't surface an identifiable GHSA get a hard
  // gate at high/critical severity. We can't soft-skip them: the whole point
  // of the GHSA-based allowlist is that we know what we're accepting, and
  // "we can't trace what this is" is not the same as "we've reviewed it".
  // Moderate/low still goes to a non-blocking list so a triager can take a
  // look without burning the PR pipeline.
  if (ghsas.length === 0) {
    if (sev === 'critical' || sev === 'high') {
      blockers.push({
        ghsa: '(untraceable GHSA)',
        ghsas: [],
        package: pkgName,
        severity: sev,
        reason: 'no-ghsa',
      });
    } else {
      noGhsaFindings.push({ severity: sev, package: pkgName, raw: finding });
    }
    continue;
  }

// A finding is triaged if ANY of its GHSAs (direct or transitive) is in the
// allowlist (workspace-applicable or global) and not expired.
//
// Semantics for the optional `workspace` field:
//   - absent        = the GHSA is accepted in every workspace
//   - present       = the GHSA is accepted ONLY in the listed workspaces
// Most existing entries omit `workspace`; a future entry can opt-in to a
// narrower scope by listing specific workspaces.

const today_match = (entry) => new Date(entry.expires_at) >= today;
const matchesWorkspace = (entry) => {
  if (!entry.workspace) return true;
  const allowed = Array.isArray(entry.workspace) ? entry.workspace : [entry.workspace];
  return allowed.includes(workspaceName);
};
const matchedGhsa = ghsas.find((ghsa) => {
  const entry = allowlist[ghsa];
  return entry && today_match(entry) && matchesWorkspace(entry);
});

  if (sev === 'critical' || sev === 'high') {
    if (matchedGhsa) {
      triagedFindings.push({ severity: sev, package: pkgName, ghsas, matchedGhsa });
    } else {
      blockers.push({
        ghsa: ghsas[0],
        ghsas,
        package: pkgName,
        severity: sev,
      });
    }
  } else {
    informationalFindings.push({ severity: sev, package: pkgName, ghsas });
  }
}

// Add expired allowlist entries to blockers (the doc promises this).
for (const e of expiredForWorkspace) {
  blockers.push({
    ghsa: e.ghsa,
    ghsas: [e.ghsa],
    package: e.package,
    severity: e.severity,
    expired_at: e.expires_at,
  });
}

// Report ------------------------------------------------------------------------
console.log('');
console.log('┌────────────────────────────────────────────────────────────────┐');
console.log(`│ Dependency audit · ${workspaceName.padEnd(46)} │`);
console.log('└────────────────────────────────────────────────────────────────┘');

if (noGhsaFindings.length > 0) {
  console.log('');
  console.log(`? ${noGhsaFindings.length} finding${noGhsaFindings.length === 1 ? '' : 's'} with no identifiable GHSA (need a manual look — not blocking):`);
  for (const w of noGhsaFindings.slice(0, 25)) {
    console.log(`    · ${w.severity.padEnd(8)} ${w.package.padEnd(30)} <no traceable GHSA>`.trimEnd());
  }
  if (noGhsaFindings.length > 25) {
    console.log(`    · …and ${noGhsaFindings.length - 25} more.`);
  }
}

if (informationalFindings.length > 0) {
  console.log('');
  console.log(`ℹ ${informationalFindings.length} non-blocking finding${informationalFindings.length === 1 ? '' : 's'} (moderate/low):`);
  for (const w of informationalFindings.slice(0, 25)) {
    console.log(`    · ${w.severity.padEnd(8)} ${w.package.padEnd(30)} ${w.ghsas.join(', ')}`.trimEnd());
  }
  if (informationalFindings.length > 25) {
    console.log(`    · …and ${informationalFindings.length - 25} more.`);
  }
}

if (triagedFindings.length > 0) {
  console.log('');
  console.log(`✓ ${triagedFindings.length} triaged high/critical finding${triagedFindings.length === 1 ? '' : 's'} (allowed by .github/dependency-audit-allowlist.json):`);
  for (const w of triagedFindings.slice(0, 25)) {
    console.log(`    · ${w.severity.padEnd(8)} ${w.package.padEnd(30)} ${w.ghsas.join(', ')} (matched: ${w.matchedGhsa})`.trimEnd());
  }
  if (triagedFindings.length > 25) {
    console.log(`    · …and ${triagedFindings.length - 25} more.`);
  }
}

if (blockers.length === 0) {
  console.log('');
  console.log(`✅ No unallowed High or Critical findings in ${workspaceName}.`);
  process.exit(0);
}

const freshBlockers = blockers.filter((b) => !b.expired_at);
const expiredBlockers = blockers.filter((b) => b.expired_at);

console.log('');
if (expiredBlockers.length > 0) {
  console.log(`⚠ ${expiredBlockers.length} allowlist entr${expiredBlockers.length === 1 ? 'y is' : 'ies are'} EXPIRED and must be re-triaged or removed:`);
  for (const b of expiredBlockers) {
    console.log(`    · ${b.ghsa} (${b.package}, expired ${b.expired_at})`);
  }
}
if (freshBlockers.length > 0) {
  console.log(`❌ ${freshBlockers.length} unallowed High/Critical finding${freshBlockers.length === 1 ? '' : 's'} in ${workspaceName}:`);
  for (const b of freshBlockers) {
    // For synthetic `(untraceable GHSA)` blockers and the like, b.ghsas may be
    // empty — fall back to b.ghsa so the CI log line isn't blank in the GHSA
    // column. The reason tag, when set, helps a reader tell why it's missing.
    const ghsaLabel = b.ghsas.length ? b.ghsas.join(', ') : b.ghsa;
    const reasonTag = b.reason ? ` (reason: ${b.reason})` : '';
    console.log(`    · ${b.severity.padEnd(8)} ${b.package.padEnd(30)} ${ghsaLabel}${reasonTag}`);
  }
}
console.log('');
console.log('To resolve:');
console.log('  1. Try a fix first:  (cd ' + workspaceDir + ' && npm audit fix)');
console.log('  2. If no fix is published, run manual research and either:');
console.log('     · upgrade to a patched version (preferred), or');
console.log('     · pin to a non-affected semver range with a justification, or');
console.log('     · add a TRIAGED allowlist entry (see docs/security/dependency-triage.md).');
console.log('');
process.exit(1);
