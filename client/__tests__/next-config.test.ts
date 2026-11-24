/**
 * #598 — Unified Next.js config verification
 *
 * Asserts:
 *  1. Only one Next.js config file exists (client/next.config.mjs).
 *  2. No stale root-level next.config.* files remain.
 *  3. The active config contains the required feature declarations.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

// __dirname = client/__tests__
const repoRoot = path.resolve(__dirname, '../..');
const clientDir = path.resolve(__dirname, '..');
const activeConfig = path.join(clientDir, 'next.config.mjs');

describe('Next.js config unification (#598)', () => {
  it('client/next.config.mjs exists', () => {
    expect(fs.existsSync(activeConfig)).toBe(true);
  });

  it('no stale root-level next.config.* files exist', () => {
    const stale = fs.readdirSync(repoRoot).filter((f) => /^next\.config\..+/.test(f));
    expect(stale).toHaveLength(0);
  });

  it('exactly one next.config.* file exists under client/', () => {
    const configs = fs.readdirSync(clientDir).filter((f) => /^next\.config\..+/.test(f));
    expect(configs).toEqual(['next.config.mjs']);
  });

  describe('active config content', () => {
    let src: string;

    beforeAll(() => {
      src = fs.readFileSync(activeConfig, 'utf8');
    });

    it('wraps config with withSentryConfig', () => {
      expect(src).toContain('withSentryConfig');
    });

    it('declares images.remotePatterns', () => {
      expect(src).toContain('remotePatterns');
    });

    it('declares custom headers for sw.js and manifest.json', () => {
      expect(src).toContain('/sw.js');
      expect(src).toContain('/manifest.json');
    });

    it('enables reactCompiler experimental flag', () => {
      expect(src).toContain('reactCompiler');
    });

    it('conditionally integrates bundle analyzer via ANALYZE env var', () => {
      expect(src).toContain('ANALYZE');
      expect(src).toContain('bundle-analyzer');
    });

    it('uses ESM export (export default)', () => {
      expect(src).toContain('export default');
      expect(src).not.toContain('module.exports');
    });

    it('disables Next.js telemetry in the client scripts', () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(clientDir, 'package.json'), 'utf8'));
      expect(pkg.scripts.dev).toContain('NEXT_TELEMETRY_DISABLED=1');
      expect(pkg.scripts.build).toContain('NEXT_TELEMETRY_DISABLED=1');
      expect(pkg.scripts.start).toContain('NEXT_TELEMETRY_DISABLED=1');
    });
  });
});
