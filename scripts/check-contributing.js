#!/usr/bin/env node

/**
 * Validates CONTRIBUTING.md covers the monorepo onboarding path and links
 * resolve to real package docs. Secret-free — safe to run on every PR.
 *
 * Usage: node scripts/check-contributing.js
 * Exit code: 0 if valid, 1 if invalid
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const CONTRIBUTING_PATH = path.join(REPO_ROOT, 'CONTRIBUTING.md');

/** Section headings that must appear exactly once. */
const REQUIRED_SECTIONS = [
  '## Prerequisites',
  '## Quick start (local development)',
  '## Environment variables',
  '## Local services',
  '## Running tests',
  '## Database and migrations',
  '## Package-specific guides',
  '## Before you open a pull request',
];

/** Commands / patterns the guide must document for the one-path setup. */
const REQUIRED_PATTERNS = [
  /npm install/,
  /supabase start/,
  /supabase db (push|reset)/,
  /backend\/\.env\.example/,
  /client\/\.env\.example/,
  /npm run dev/,
  /npm test/,
  /npm run typecheck/,
];

/** Relative markdown links that must exist on disk. */
const REQUIRED_LINK_TARGETS = [
  'docs/ENVIRONMENT.md',
  'backend/README.md',
  'client/README.md',
  'sdk/README.md',
  'shared/README.md',
  'contracts/README.md',
  'docs/code-review-process.md',
];

function readContributing() {
  if (!fs.existsSync(CONTRIBUTING_PATH)) {
    return { content: null, errors: ['CONTRIBUTING.md is missing from the repository root.'] };
  }
  return { content: fs.readFileSync(CONTRIBUTING_PATH, 'utf8'), errors: [] };
}

function checkSections(content) {
  const errors = [];
  for (const section of REQUIRED_SECTIONS) {
    const count = content.split(section).length - 1;
    if (count === 0) {
      errors.push(`Missing required section: ${section}`);
    } else if (count > 1) {
      errors.push(`Duplicate section heading: ${section}`);
    }
  }
  return errors;
}

function checkPatterns(content) {
  const errors = [];
  for (const pattern of REQUIRED_PATTERNS) {
    if (!pattern.test(content)) {
      errors.push(`Missing required onboarding pattern: ${pattern}`);
    }
  }
  return errors;
}

function checkLinkTargets(content) {
  const errors = [];
  const linkRegex = /\]\((\.\/)?([^)]+)\)/g;
  const linkedPaths = new Set();
  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    const target = match[2].split('#')[0];
    if (!target.endsWith('.md')) continue;
    linkedPaths.add(target.replace(/^\.\//, ''));
  }

  for (const target of REQUIRED_LINK_TARGETS) {
    if (!linkedPaths.has(target)) {
      errors.push(`CONTRIBUTING.md must link to ${target}`);
    }
    const absolute = path.join(REPO_ROOT, target);
    if (!fs.existsSync(absolute)) {
      errors.push(`Linked file does not exist: ${target}`);
    }
  }

  return errors;
}

function checkContributing() {
  const { content, errors: readErrors } = readContributing();
  if (!content) return readErrors;

  return [
    ...readErrors,
    ...checkSections(content),
    ...checkPatterns(content),
    ...checkLinkTargets(content),
  ];
}

if (require.main === module) {
  const errors = checkContributing();
  if (errors.length) {
    console.error('\n❌ CONTRIBUTING.md validation failed:\n');
    errors.forEach((e) => console.error(`   - ${e}`));
    console.error('\nSee CONTRIBUTING.md for the canonical contributor onboarding path.\n');
    process.exit(1);
  }
  console.log('✅ CONTRIBUTING.md covers the monorepo onboarding path.');
}

module.exports = {
  REQUIRED_SECTIONS,
  REQUIRED_PATTERNS,
  REQUIRED_LINK_TARGETS,
  checkContributing,
  checkSections,
  checkPatterns,
  checkLinkTargets,
};
