#!/usr/bin/env node

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findAbsoluteFileLinks } = require('./validate-docs');

describe('validate-docs file:// guard', () => {
  it('finds absolute file:// markdown links', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syncro-docs-'));
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.writeFileSync(
      path.join(dir, 'README.md'),
      'See [doc](file:///C:/Users/x/SYNCRO/docs/a.md).\n',
    );
    fs.writeFileSync(path.join(dir, 'docs', 'issue-triage-policy.md'), '# ok\n');

    const findings = findAbsoluteFileLinks(dir);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].file, 'README.md');
    assert.ok(findings[0].matches.some((m) => m.includes('file://')));
  });

  it('passes the real repository (no file:// links)', () => {
    const findings = findAbsoluteFileLinks(path.join(__dirname, '..'));
    assert.deepEqual(findings, [], `Unexpected file:// links: ${JSON.stringify(findings)}`);
  });
});
