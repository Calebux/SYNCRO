import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const dirname =
  typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url))

/** Minimal Vitest config for lib/api unit tests (no Storybook/browser). */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(dirname, './'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['lib/api/**/*.{test,spec}.ts'],
    exclude: ['node_modules', '.next'],
  },
})
