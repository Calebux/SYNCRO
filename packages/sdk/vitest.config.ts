import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environmentMatchGlobs: [
      ['test/edge/**', 'edge-runtime'],
      ['test/browser/**', 'jsdom'],
    ],
  },
});
