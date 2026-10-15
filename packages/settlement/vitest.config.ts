import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname),
  css: {
    postcss: {},
  },
  test: {
    include: ['src/**/*.test.ts', '../../tests/**/*.test.ts'],
    environment: 'node',
  },
});
