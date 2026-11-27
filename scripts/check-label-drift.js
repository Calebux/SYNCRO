#!/usr/bin/env node

/**
 * Compares .github/labels.yml with labels on the GitHub remote.
 *
 * Usage:
 *   node scripts/check-label-drift.js
 *   GITHUB_TOKEN=... node scripts/check-label-drift.js --strict
 *
 * Without a token, only validates that labels.yml uses colon-style names.
 * With a token (or gh auth), compares local names against the remote set.
 * --strict exits 1 when local labels are missing on GitHub (or vice versa for
 * taxonomy prefixes).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { parseLabelsYaml } = require('./check-issue-governance');

const REPO_ROOT = path.join(__dirname, '..');
const TAXONOMY_PREFIXES = ['area:', 'priority:', 'type:', 'risk:', 'status:'];

function loadLocalLabels() {
  const content = fs.readFileSync(path.join(REPO_ROOT, '.github', 'labels.yml'), 'utf8');
  return parseLabelsYaml(content).map((l) => l.name).filter(Boolean);
}

function fetchRemoteLabels() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY || 'Calebux/SYNCRO';

  if (token) {
    const labels = [];
    let page = 1;
    while (true) {
      const url = `https://api.github.com/repos/${repo}/labels?per_page=100&page=${page}`;
      const res = execSync(
        `curl -sS -H "Authorization: Bearer ${token}" -H "Accept: application/vnd.github+json" "${url}"`,
        { encoding: 'utf8' },
      );
      const batch = JSON.parse(res);
      if (!Array.isArray(batch) || batch.length === 0) break;
      if (batch.message) {
        throw new Error(`GitHub API error: ${batch.message}`);
      }
      labels.push(...batch.map((l) => l.name));
      if (batch.length < 100) break;
      page += 1;
    }
    return labels;
  }

  try {
    const out = execSync('gh label list --limit 200 --json name', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(out).map((l) => l.name);
  } catch {
    return null;
  }
}

function main() {
  const strict = process.argv.includes('--strict');
  const local = loadLocalLabels();
  const errors = [];
  const warnings = [];

  console.log('🔍 Checking label drift (local ↔ GitHub)...\n');

  for (const name of local) {
    if (name.includes('/')) {
      errors.push(`Local label "${name}" uses slash-style; rename to colon-style`);
    }
  }

  const remote = fetchRemoteLabels();
  if (!remote) {
    warnings.push(
      'Could not fetch remote labels (set GITHUB_TOKEN or authenticate gh). Skipped remote comparison.',
    );
  } else {
    const remoteSet = new Set(remote);
    const localSet = new Set(local);

    const missingOnRemote = local.filter((n) => !remoteSet.has(n));
    const remoteTaxonomy = remote.filter((n) =>
      TAXONOMY_PREFIXES.some((p) => n.startsWith(p)),
    );
    const extraOnRemote = remoteTaxonomy.filter((n) => !localSet.has(n));

    if (missingOnRemote.length > 0) {
      const msg = `Local labels missing on GitHub (${missingOnRemote.length}): ${missingOnRemote.join(', ')}`;
      if (strict) errors.push(msg);
      else warnings.push(msg);
    }

    if (extraOnRemote.length > 0) {
      warnings.push(
        `Remote taxonomy labels not in labels.yml (${extraOnRemote.length}): ${extraOnRemote.join(', ')}`,
      );
    }

    console.log(`Local taxonomy labels: ${local.length}`);
    console.log(`Remote labels: ${remote.length} (taxonomy-prefixed: ${remoteTaxonomy.length})`);
  }

  for (const w of warnings) {
    console.warn(`⚠️  ${w}`);
  }

  if (errors.length > 0) {
    console.error('\n❌ Label drift check failed:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log('\n✅ Label drift check passed' + (warnings.length ? ' (with warnings)' : '') + '!');
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { loadLocalLabels, fetchRemoteLabels, TAXONOMY_PREFIXES };
