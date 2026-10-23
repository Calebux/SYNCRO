import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname),
  css: {
    // This is a pure Node/TypeScript package — no CSS. Setting postcss to false
    // prevents Vite from crawling parent directories for a postcss.config.
    postcss: {},
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
