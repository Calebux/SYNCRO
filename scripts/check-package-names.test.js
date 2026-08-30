#!/usr/bin/env node

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
  EXPECTED_NAMES,
  PLACEHOLDER_PATTERNS,
  readPackageName,
  isPlaceholder,
} = require('./check-package-names');

describe('check-package-names', () => {
  it('flags known placeholder names', () => {
    assert.equal(isPlaceholder('my-v0-project'), true);
    assert.equal(isPlaceholder('my-v0-project-extra'), true);
    assert.equal(isPlaceholder('@syncro/client'), false);
  });

  it('matches every expected package.json name', () => {
    for (const [relativePath, expected] of Object.entries(EXPECTED_NAMES)) {
      const actual = readPackageName(relativePath);
      assert.equal(
        actual,
        expected,
        `${relativePath} should be named ${expected}`,
      );
      assert.equal(
        PLACEHOLDER_PATTERNS.some((p) => p.test(actual)),
        false,
        `${relativePath} must not use a placeholder name`,
      );
    }
  });
});
