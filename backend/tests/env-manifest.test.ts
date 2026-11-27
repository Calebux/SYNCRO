import * as fs from 'fs';
import * as path from 'path';
import { envSchema } from '../src/config/env';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const manifest = require('../scripts/env.manifest') as {
  required: string[];
  optional: string[];
  deprecated: Record<string, string>;
};

/**
 * These tests enforce that backend/scripts/env.manifest.js stays the single
 * source of truth for env var names — kept honest against both the zod schema
 * (src/config/env.ts) and backend/.env.example. See issue #601.
 */
describe('backend env manifest', () => {
  const shape = envSchema.shape as Record<string, { isOptional(): boolean }>;
  const schemaKeys = Object.keys(shape);
  const schemaRequired = schemaKeys.filter((k) => !shape[k].isOptional());

  it('zod schema required keys exactly match manifest.required', () => {
    expect(new Set(schemaRequired)).toEqual(new Set(manifest.required));
  });

  it('every zod schema key is declared in the manifest', () => {
    const declared = new Set([...manifest.required, ...manifest.optional]);
    const undeclared = schemaKeys.filter((k) => !declared.has(k));
    expect(undeclared).toEqual([]);
  });

  it('required and optional lists do not overlap', () => {
    const overlap = manifest.required.filter((k) => manifest.optional.includes(k));
    expect(overlap).toEqual([]);
  });

  it('.env.example documents every manifest var and nothing extra', () => {
    const examplePath = path.join(__dirname, '..', '.env.example');
    const contents = fs.readFileSync(examplePath, 'utf8');
    const documented = new Set<string>();
    for (const line of contents.split('\n')) {
      const match = /^([A-Z_][A-Z0-9_]*)=/.exec(line.trim());
      if (match) documented.add(match[1]);
    }

    const declared = new Set([...manifest.required, ...manifest.optional]);
    const missingFromExample = [...declared].filter((k) => !documented.has(k));
    const extrasInExample = [...documented].filter((k) => !declared.has(k));

    expect(missingFromExample).toEqual([]);
    expect(extrasInExample).toEqual([]);
  });
});
