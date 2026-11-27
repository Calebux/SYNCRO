#!/usr/bin/env node

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  REQUIRED_SECTIONS,
  checkContributing,
  checkSections,
  checkPatterns,
  checkLinkTargets,
} = require('./check-contributing');

const CONTRIBUTING_PATH = path.join(__dirname, '..', 'CONTRIBUTING.md');

describe('check-contributing', () => {
  it('validates the repository CONTRIBUTING.md', () => {
    const errors = checkContributing();
    assert.deepEqual(
      errors,
      [],
      `Expected no CONTRIBUTING.md errors, but got:\n${errors.join('\n')}`,
    );
  });

  it('flags missing required sections', () => {
    const content = '# Contributing\n\n## Prerequisites\n';
    const errors = checkSections(content);
    assert.ok(errors.some((e) => e.includes('Quick start')));
  });

  it('flags duplicate section headings', () => {
    const content = REQUIRED_SECTIONS.join('\n\n') + '\n\n' + REQUIRED_SECTIONS[0];
    const errors = checkSections(content);
    assert.ok(errors.some((e) => e.includes('Duplicate')));
  });

  it('flags missing command patterns', () => {
    const errors = checkPatterns('## Prerequisites\nInstall things.');
    assert.ok(errors.length > 0);
  });

  it('flags broken link targets', () => {
    const content = [
      '## Package-specific guides',
      '[Backend](./backend/README.md)',
      '[Client](./client/README.md)',
      '[SDK](./sdk/README.md)',
      '[Shared](./shared/README.md)',
      '[Contracts](./contracts/README.md)',
      '[Environment](./docs/ENVIRONMENT.md)',
      '[Review](./docs/code-review-process.md)',
    ].join('\n');
    const errors = checkLinkTargets(content);
    assert.deepEqual(errors, []);
  });

  it('CONTRIBUTING.md exists and is non-empty', () => {
    assert.equal(fs.existsSync(CONTRIBUTING_PATH), true);
    assert.ok(fs.readFileSync(CONTRIBUTING_PATH, 'utf8').length > 500);
  });
});
