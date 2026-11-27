module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
    jest: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
  ],
  rules: {
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-floating-promises": "error",
    "no-console": "warn",
    "@typescript-eslint/no-unused-vars": "warn",
    // Ban direct process.env access outside the config module
    "no-restricted-syntax": [
      "error",
      {
        selector: "MemberExpression[object.name='process'][property.name='env']",
        message: "Direct process.env access is banned outside the config module. Import `env` from `src/config/env` instead.",
      },
    ],
    // Package boundary: backend must not import from client
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["../client/**", "../../client/**"],
            message: "Backend must not import from client.",
          },
          {
            group: ["../sdk/src/**", "../../sdk/src/**"],
            message: "Import from the published @syncro/sdk package, not its source.",
          },
          {
            group: ["../shared/src/**", "../../shared/src/**"],
            message: "Import from @syncro/shared, not its source path.",
          },
        ],
      },
    ],
  },
  overrides: [
    {
      files: ["src/config/**/*.ts", "src/utils/manifest.ts"],
      rules: {
        "no-restricted-syntax": "off",
      },
    },
    {
      // Backend application code must route logging through the structured
      // winston logger (src/config/logger). Raw console.* risks leaking PII to
      // stdout and bypasses log rotation / redaction. See issue #1028.
      files: ["src/**/*.ts", "services/**/*.ts"],
      excludedFiles: ["src/config/logger.ts"],
      rules: {
        "no-console": "error",
      },
    },
    {
      files: ["*.js", "*.cjs", "*.mjs"],
      parserOptions: {
        project: null,
      },
      rules: {
        "@typescript-eslint/no-floating-promises": "off",
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-unused-vars": "off",
        "@typescript-eslint/no-require-imports": "off",
      },
    },
    {
      // Critical paths: forbid new `any` usage (issue #1027)
      files: [
        "src/config/**/*.ts",
        "src/middleware/**/*.ts",
        "src/schemas/**/*.ts",
        "src/routes/**/*.ts",
        "src/services/webhook*.ts",
      ],
      rules: {
        "@typescript-eslint/no-explicit-any": "error",
      },
    },
  ],
};
