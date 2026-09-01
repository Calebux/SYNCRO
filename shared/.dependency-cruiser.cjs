/**
 * Enforces the import layering for @syncro/shared (issue #1307).
 *
 * Layers, and the only direction imports may flow:
 *
 *   types/  ->  logic/  ->  platform/
 *
 * A module may import from its own layer or any layer to its left. It
 * must never import from a layer to its right, and no cycle is allowed
 * anywhere in the graph. Run with `npm run check-imports` (see
 * package.json); wired into CI in .github/workflows/lint.yml.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Circular imports through the barrel are exactly what issue #1307 removes. ' +
        'If this fires, break the cycle by moving the shared piece down a layer ' +
        '(or into its own module) instead of importing back up.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'types-layer-is-pure',
      severity: 'error',
      comment:
        'types/ is the pure-data layer: it must not depend on logic/ or platform/. ' +
        'If a type needs a helper function, the function belongs in logic/, and the ' +
        'type stays a type.',
      from: { path: '^src/types' },
      to: { path: '^src/(logic|platform)' },
    },
    {
      name: 'logic-does-not-import-platform',
      severity: 'error',
      comment:
        'logic/ must stay pure (deterministic, no I/O, no third-party SDK wiring). ' +
        'platform/ (the RPC client, Sentry config) depends on logic/ and types/, never ' +
        'the reverse — otherwise importing a pure helper drags in Sentry/RPC again, ' +
        'which is the exact bug this issue exists to fix.',
      from: { path: '^src/logic' },
      to: { path: '^src/platform' },
    },
    {
      name: 'root-barrel-is-types-only',
      severity: 'error',
      comment:
        'index.ts (the "@syncro/shared" barrel) may re-export only from types/. ' +
        'Anything from logic/ or platform/ must be imported via its own subpath ' +
        '(e.g. "@syncro/shared/crypto", "@syncro/shared/sentry") so that importing a ' +
        'type never pulls in Sentry or the RPC client.',
      from: { path: '^src/index\\.ts$' },
      to: { path: '^src/(logic|platform)' },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '__tests__' },
  },
};
