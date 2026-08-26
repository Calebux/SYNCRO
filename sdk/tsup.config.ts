import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    types: 'src/types.ts',
    errors: 'src/errors.ts',
    webhooks: 'src/webhooks.ts',
    'stellar/index': 'src/stellar/index.ts',
    'zk/index': 'src/zk/index.ts',
    'generated/index': 'src/generated/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  outDir: 'dist',
  target: 'es2022',
  platform: 'neutral',
  tsconfig: 'tsconfig.build.json',
  cjsInterop: true,
  external: [/^@syncro\/shared/, 'axios', 'events'],
});
