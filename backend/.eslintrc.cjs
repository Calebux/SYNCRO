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
    "no-restricted-syntax": [
      "error",
      {
        selector: "CallExpression[callee.object.name='supabase'][callee.property.name='from']",
        message: "Database queries must go through a repository, not supabase.from().",
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
      files: ["src/domains/**/*.controller.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["**/repositories/**", "**/*.repository", "**/*.repository.*"],
                message: "Controllers must call services; they may not access repositories directly.",
              },
            ],
          },
        ],
      },
    },
    {
      files: ["src/domains/**/*.service.ts", "src/services/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["**/routes/**", "**/*.controller", "**/*.controller.*"],
                message: "Services must not depend on routes or controllers.",
              },
            ],
          },
        ],
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
        "src/domains/**/*.controller.ts",
        "src/services/webhook*.ts",
      ],
      rules: {
        "@typescript-eslint/no-explicit-any": "error",
      },
    },
  ],
};
