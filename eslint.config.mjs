import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Soft in-editor signal; authoritative enforcement is scripts/check-todos.mjs
      "no-warning-comments": [
        "warn",
        { terms: ["todo", "fixme"], location: "anywhere" },
      ],
    },
  },
  {
    files: ["backend/src/**/*.ts"],
    ignores: ["backend/src/config/**/*.ts", "backend/src/utils/manifest.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: "Direct process.env access is banned outside the config module. Import `env` from `src/config/env` instead.",
        },
      ],
    },
  },
]);

export default eslintConfig;
