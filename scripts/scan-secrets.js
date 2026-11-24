#!/usr/bin/env node
/**
 * Secret scanner (issue #1082).
 *
 * Zero-dependency scanner used by the pre-commit hook and as the CI fallback
 * when the gitleaks binary is unavailable. It reads its allowlist from
 * `.gitleaks.toml` so there is one place to add exceptions, and its accepted
 * findings from `.secrets-baseline.json`.
 *
 * Usage:
 *   node scripts/scan-secrets.js --staged           Scan staged changes (pre-commit)
 *   node scripts/scan-secrets.js --all              Scan every tracked file
 *   node scripts/scan-secrets.js --range base..head Scan a commit range
 *   node scripts/scan-secrets.js --all --update-baseline   Rewrite the baseline
 *
 * Exit code 1 means a secret was found that is neither allowlisted nor in the
 * baseline. See docs/security/secret-scanning.md for remediation.
 */

'use strict';

const { execFileSync } = require('child_process');
const { createHash } = require('crypto');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const GITLEAKS_CONFIG = path.join(REPO_ROOT, '.gitleaks.toml');
const BASELINE_FILE = path.join(REPO_ROOT, '.secrets-baseline.json');

// ── Detection rules ─────────────────────────────────────────────────────────
// Kept deliberately high-signal: a scanner that cries wolf gets disabled.

const RULES = [
  {
    id: 'private-key',
    description: 'Private key block',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/,
  },
  {
    id: 'aws-access-key-id',
    description: 'AWS access key ID',
    regex: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/,
  },
  {
    id: 'aws-secret-access-key',
    description: 'AWS secret access key',
    regex: /\baws_secret_access_key\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})["']?/i,
  },
  {
    id: 'github-token',
    description: 'GitHub token',
    regex: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{22,}\b/,
  },
  {
    id: 'slack-token',
    description: 'Slack token',
    regex: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/,
  },
  {
    id: 'slack-webhook',
    description: 'Slack webhook URL',
    regex: /https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9_]+\/B[A-Za-z0-9_]+\/[A-Za-z0-9_]+/,
  },
  {
    id: 'stripe-secret-key',
    description: 'Stripe secret key',
    regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/,
  },
  {
    id: 'google-api-key',
    description: 'Google API key',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
  {
    id: 'telegram-bot-token',
    description: 'Telegram bot token',
    regex: /\b\d{8,10}:AA[A-Za-z0-9_-]{32,}\b/,
  },
  {
    id: 'npm-token',
    description: 'npm access token',
    regex: /\bnpm_[A-Za-z0-9]{36}\b/,
  },
  {
    id: 'jwt-token',
    description: 'JWT (may be a Supabase service_role key)',
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    id: 'generic-assigned-secret',
    description: 'Hardcoded secret assignment',
    // KEY = "value" where the key name looks secret-ish and the value is long
    // enough and not obviously a placeholder or an env/config reference.
    regex:
      /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|service[_-]?role[_-]?key|password|passwd|db[_-]?pass)\b\s*[:=]\s*["'`]([^"'`\s${}]{12,})["'`]/i,
    /** Values that are obviously not real credentials. */
    ignoreValue:
      /^(?:process\.|import\.meta|env\.|\$\{|<|your[-_]|xxx|placeholder|changeme|example|dummy|test[-_]?|fake|sample|redacted|\*+$|\.{3})/i,
  },
];

/** Values that never count as a secret, whatever rule matched. */
const GLOBAL_STOPWORDS = [
  /^(?:true|false|null|undefined)$/i,
  /^[a-z_]+$/, // a bare identifier
];

// ── Allowlist (parsed from .gitleaks.toml) ──────────────────────────────────

/**
 * Extract string arrays from the `[allowlist]` table of a gitleaks config.
 * A full TOML parser is overkill — we own this file's shape, and the CI
 * gitleaks run is the authority on the config anyway.
 */
function parseAllowlist(tomlText) {
  const allowlist = { paths: [], regexes: [], stopwords: [] };
  if (!tomlText) return allowlist;

  // Grab the top-level [allowlist] table, up to the next table header.
  const section = tomlText.match(/^\[allowlist\]\s*$([\s\S]*?)(?=^\[|\Z)/m);
  if (!section) return allowlist;

  for (const key of ['paths', 'regexes', 'stopwords']) {
    const match = section[1].match(new RegExp(`^\\s*${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm'));
    if (!match) continue;

    for (const raw of match[1].split('\n')) {
      const value = raw.match(/'''(.*?)'''|"""(.*?)"""|'(.*?)'|"(.*?)"/);
      if (!value) continue;
      const literal = value[1] ?? value[2] ?? value[3] ?? value[4];
      if (literal) allowlist[key].push(literal);
    }
  }

  return allowlist;
}

function compile(patterns, label) {
  return patterns
    .map((pattern) => {
      try {
        return new RegExp(pattern);
      } catch {
        process.stderr.write(`⚠️  Ignoring invalid ${label} pattern in .gitleaks.toml: ${pattern}\n`);
        return null;
      }
    })
    .filter(Boolean);
}

function loadAllowlist() {
  const toml = fs.existsSync(GITLEAKS_CONFIG) ? fs.readFileSync(GITLEAKS_CONFIG, 'utf8') : '';
  const raw = parseAllowlist(toml);
  return {
    paths: compile(raw.paths, 'path'),
    regexes: compile(raw.regexes, 'regex'),
    stopwords: raw.stopwords.map((word) => word.toLowerCase()),
  };
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return new Set();
  try {
    const parsed = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
    return new Set((parsed.findings ?? []).map((finding) => finding.fingerprint));
  } catch (err) {
    process.stderr.write(`⚠️  Could not read ${BASELINE_FILE}: ${err.message}\n`);
    return new Set();
  }
}

// ── Git helpers ─────────────────────────────────────────────────────────────

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function stagedFiles() {
  return git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']).split('\n').filter(Boolean);
}

function rangeFiles(range) {
  return git(['diff', '--name-only', '--diff-filter=ACMR', range]).split('\n').filter(Boolean);
}

function trackedFiles() {
  return git(['ls-files']).split('\n').filter(Boolean);
}

/** Staged content of a file (what is about to be committed, not the worktree). */
function stagedContent(file) {
  try {
    return git(['show', `:${file}`]);
  } catch {
    return null;
  }
}

function worktreeContent(file) {
  const full = path.join(REPO_ROOT, file);
  try {
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return null;
    return fs.readFileSync(full, 'utf8');
  } catch {
    return null;
  }
}

// ── Scanning ────────────────────────────────────────────────────────────────

const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg', '.pdf',
  '.woff', '.woff2', '.ttf', '.eot', '.zip', '.gz', '.tgz', '.mp4', '.webm',
  '.wasm', '.node', '.lock',
]);

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_LINE_LENGTH = 4000;

function fingerprint(file, ruleId, secret) {
  return createHash('sha256').update(`${file}:${ruleId}:${secret}`).digest('hex').slice(0, 32);
}

/** Redact a matched secret so the scanner's own output is not a leak. */
function redact(secret) {
  if (secret.length <= 8) return '*'.repeat(secret.length);
  return `${secret.slice(0, 4)}${'*'.repeat(Math.min(secret.length - 8, 24))}${secret.slice(-4)}`;
}

function scanContent(file, content, allowlist, findings) {
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    if (line.length > MAX_LINE_LENGTH) return;
    if (/gitleaks:allow|secret-scan:allow/.test(line)) return;

    for (const rule of RULES) {
      const match = line.match(rule.regex);
      if (!match) continue;

      const secret = match[1] ?? match[0];
      if (rule.ignoreValue && rule.ignoreValue.test(secret)) continue;
      if (GLOBAL_STOPWORDS.some((stopword) => stopword.test(secret))) continue;
      if (allowlist.stopwords.some((word) => secret.toLowerCase().includes(word))) continue;
      if (allowlist.regexes.some((regex) => regex.test(line))) continue;

      findings.push({
        file,
        line: index + 1,
        ruleId: rule.id,
        description: rule.description,
        match: redact(secret),
        fingerprint: fingerprint(file, rule.id, secret),
      });
    }
  });
}

function isSkippedPath(file, allowlist) {
  if (SKIP_EXTENSIONS.has(path.extname(file).toLowerCase())) return true;
  if (file.includes('node_modules/')) return true;
  return allowlist.paths.some((regex) => regex.test(file));
}

function scan(files, readContent, allowlist) {
  const findings = [];

  for (const file of files) {
    if (isSkippedPath(file, allowlist)) continue;

    const content = readContent(file);
    if (content === null) continue;
    if (content.length > MAX_FILE_BYTES) continue;
    if (content.includes(' ')) continue; // binary

    scanContent(file, content, allowlist, findings);
  }

  return findings;
}

// ── Reporting ───────────────────────────────────────────────────────────────

function report(findings, { baselined }) {
  process.stderr.write(`\n🔴 ${findings.length} potential secret${findings.length === 1 ? '' : 's'} detected\n\n`);

  for (const finding of findings) {
    process.stderr.write(`  ${finding.file}:${finding.line}\n`);
    process.stderr.write(`    rule:  ${finding.ruleId} — ${finding.description}\n`);
    process.stderr.write(`    match: ${finding.match}\n`);
    process.stderr.write(`    id:    ${finding.fingerprint}\n\n`);
  }

  process.stderr.write('What to do:\n');
  process.stderr.write('  1. If this is a real credential — do NOT commit it. Move it to an\n');
  process.stderr.write('     environment variable and ROTATE it: assume it is already burned.\n');
  process.stderr.write('  2. If it is a false positive, add an allowlist entry to .gitleaks.toml,\n');
  process.stderr.write('     or append `# gitleaks:allow` to the line.\n');
  process.stderr.write('  3. Full remediation guide: docs/security/secret-scanning.md\n');

  if (baselined > 0) {
    process.stderr.write(`\n(${baselined} known finding${baselined === 1 ? '' : 's'} suppressed by .secrets-baseline.json)\n`);
  }
  process.stderr.write('\n');
}

function writeBaseline(findings) {
  // Preserve the reason already recorded for a fingerprint — the generated
  // description is a placeholder that a human is expected to replace.
  const existing = new Map();
  if (fs.existsSync(BASELINE_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
      for (const finding of parsed.findings ?? []) existing.set(finding.fingerprint, finding.reason);
    } catch {
      /* regenerating from scratch */
    }
  }

  const deduped = new Map();
  for (const { fingerprint: fp, file, ruleId, description } of findings) {
    if (deduped.has(fp)) continue;
    deduped.set(fp, {
      fingerprint: fp,
      file,
      rule: ruleId,
      reason: existing.get(fp) ?? description,
    });
  }

  const baseline = {
    $comment:
      'Accepted secret-scan findings (issue #1082). Each entry is a reviewed ' +
      'false positive or test fixture. Regenerate with: node scripts/scan-secrets.js --all --update-baseline',
    generatedAt: new Date().toISOString().slice(0, 10),
    findings: [...deduped.values()].sort(
      (a, b) => a.file.localeCompare(b.file) || a.fingerprint.localeCompare(b.fingerprint),
    ),
  };

  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(baseline, null, 2)}\n`);
  process.stdout.write(`✅ Wrote ${baseline.findings.length} findings to ${path.relative(REPO_ROOT, BASELINE_FILE)}\n`);
}

// ── Entry point ─────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const updateBaseline = args.includes('--update-baseline');
  const rangeIndex = args.indexOf('--range');
  const range = rangeIndex !== -1 ? args[rangeIndex + 1] : null;

  const allowlist = loadAllowlist();

  let files;
  let readContent;
  let scope;

  if (args.includes('--staged')) {
    files = stagedFiles();
    readContent = stagedContent;
    scope = 'staged changes';
  } else if (range) {
    files = rangeFiles(range);
    readContent = worktreeContent;
    scope = `range ${range}`;
  } else {
    files = trackedFiles();
    readContent = worktreeContent;
    scope = 'all tracked files';
  }

  if (files.length === 0) {
    process.stdout.write(`✅ No files to scan (${scope}).\n`);
    return 0;
  }

  const findings = scan(files, readContent, allowlist);

  if (updateBaseline) {
    writeBaseline(findings);
    return 0;
  }

  const baseline = loadBaseline();
  const unresolved = findings.filter((finding) => !baseline.has(finding.fingerprint));
  const suppressed = findings.length - unresolved.length;

  if (unresolved.length === 0) {
    process.stdout.write(
      `✅ No new secrets detected in ${files.length} file(s) (${scope})` +
        `${suppressed > 0 ? `, ${suppressed} baselined` : ''}.\n`,
    );
    return 0;
  }

  report(unresolved, { baselined: suppressed });
  return 1;
}

process.exit(main());
