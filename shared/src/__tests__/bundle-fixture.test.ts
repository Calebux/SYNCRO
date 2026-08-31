import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Bundle fixture for issue #1307.
 *
 * The whole point of removing the catch-all barrel is that importing a
 * plain domain type must never drag in the Sentry SDK wiring or the RPC
 * client — those are platform adapters with real dependencies and side
 * effects, and a consumer (e.g. a Next.js client bundle) that only wants
 * `Subscription` shouldn't pay for either.
 *
 * This isn't a static import-graph check (that's `.dependency-cruiser.cjs`,
 * run via `npm run check-imports`). It actually bundles a real entry point
 * with esbuild and inspects the compiled output, so it catches anything
 * that would slip past a source-level check too (e.g. a stray dynamic
 * import or a re-export added back to index.ts).
 */
describe('bundle fixture: root barrel excludes platform layer', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'syncro-shared-bundle-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('bundling a value import from the root barrel does not include platform/', async () => {
    const entry = join(dir, 'entry.ts');
    writeFileSync(
      entry,
      `import { PRIVACY_STEALTH_ADDRESSES } from '${join(__dirname, '..', 'index')}';\nconsole.log(PRIVACY_STEALTH_ADDRESSES);\n`
    );

    const result = await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      platform: 'node',
      format: 'cjs',
      metafile: true,
      logLevel: 'silent',
    });

    const bundledFiles = Object.keys(result.metafile!.inputs);

    const platformFiles = bundledFiles.filter((f) => f.includes(`${join('src', 'platform')}${'/'}`));
    expect(platformFiles).toEqual([]);

    const sentryOrRpc = bundledFiles.filter(
      (f) => f.includes('sentry.ts') || f.includes('rpc-client.ts')
    );
    expect(sentryOrRpc).toEqual([]);
  });

  it('bundling from the sentry subpath does pull in platform/sentry.ts (control case)', async () => {
    const entry = join(dir, 'entry.ts');
    writeFileSync(
      entry,
      `import { SENTRY_TAG_KEYS } from '${join(__dirname, '..', 'platform', 'sentry')}';\nconsole.log(SENTRY_TAG_KEYS);\n`
    );

    const result = await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      platform: 'node',
      format: 'cjs',
      metafile: true,
      logLevel: 'silent',
    });

    const bundledFiles = Object.keys(result.metafile!.inputs);
    const sentryFiles = bundledFiles.filter((f) => f.includes('sentry.ts'));
    expect(sentryFiles.length).toBeGreaterThan(0);
  });
});
