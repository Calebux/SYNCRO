#!/usr/bin/env node

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findAbsoluteFileLinks, validateTypeScriptSample } from './validate-docs.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
    const findings = findAbsoluteFileLinks(REPO_ROOT);
    assert.deepEqual(findings, [], `Unexpected file:// links: ${JSON.stringify(findings)}`);
  });
});

describe('validate-docs TypeScript samples', () => {
  it('accepts valid syntax and rejects malformed syntax', () => {
    assert.equal(validateTypeScriptSample('const score: number = 1;').success, true);
    assert.equal(validateTypeScriptSample('const score: = 1;').success, false);
  });
});
