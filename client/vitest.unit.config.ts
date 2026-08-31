import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const dirname =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(dirname, "."),
    },
  },
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./lib/test-utils/setup.ts"],
    include: [
      "app/**/*.test.ts",
      "**/__tests__/**/*.test.ts",
      "**/__tests__/**/*.test.tsx",
    ],
    exclude: ["node_modules", ".next"],
    watch: false,
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: ["lib/supabase/**", "node_modules"],
    },
  },
})
