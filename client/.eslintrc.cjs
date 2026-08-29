module.exports = {
  root: true,
  extends: ["next/core-web-vitals", "next/typescript"],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
  rules: {
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-floating-promises": "off",
    "no-console": "warn",
    "@typescript-eslint/no-unused-vars": "warn",
    "react/no-unescaped-entities": "off",
    "react-hooks/rules-of-hooks": "warn",
    // Package boundary: client must not import directly from backend or sdk source
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["../backend/**", "../../backend/**"],
            message: "Client must not import from backend. Use the public API or @syncro/shared instead.",
          },
          {
            group: ["../sdk/src/**", "../../sdk/src/**"],
            message: "Import from the published @syncro/sdk package, not its source.",
          },
          {
            group: ["../shared/src/**", "../../shared/src/**"],
            message: "Import from @syncro/shared, not its source path.",
          },
          {
            group: ["@/components/ui/**", "../components/ui/**", "../src/components/**", "@/src/components/**"],
            message: "UI primitives live in the @syncro/ui design-system package. Import from \"@syncro/ui\" (e.g. the root path only).",
          },
          {
            group: ["@syncro/ui/*", "@syncro/ui/**", "packages/ui/**", "../../packages/ui/**"],
            message: "Do not deep-import into the design-system package. Import from \"@syncro/ui\" (the entry point) only.",
          },
        ],
      },
    ],
  },
  overrides: [
    {
      // Server-side API route handlers must use the structured logger
      // (@/lib/logger) rather than raw console.*, which risks leaking PII to
      // stdout and bypasses Sentry forwarding. See issue #1028.
      files: ["app/api/**/*.ts", "app/api/**/*.tsx"],
      rules: {
        "no-console": "error",
      },
    },
    {
      // The logger itself is the single sanctioned place that wraps console.*.
      files: ["lib/logger.ts"],
      rules: {
        "no-console": "off",
      },
    },
    {
      // Critical payment / webhook paths: forbid new `any` usage (issue #1027)
      files: [
        "lib/payment-service.ts",
        "lib/paypal-service.ts",
        "lib/paystack-service.ts",
        "lib/stripe-config.ts",
        "app/api/payments/**/*.ts",
        "app/api/webhooks/**/*.ts",
      ],
      rules: {
        "@typescript-eslint/no-explicit-any": "error",
      },
    },
    {
      files: ["lib/**/*.ts", "components/ui/**/*.tsx"],
      excludedFiles: [
        "lib/payment-service.ts",
        "lib/paypal-service.ts",
        "lib/paystack-service.ts",
        "lib/stripe-config.ts",
      ],
      rules: {
        "@typescript-eslint/no-explicit-any": "warn",
      },
    },
    {
      files: ["scripts/**/*", "stories/**/*", "__tests__/**/*", "**/*.test.ts", "**/*.test.tsx"],
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-floating-promises": "off",
        "@typescript-eslint/no-unused-vars": "off"
      }
    }
  ],
};
