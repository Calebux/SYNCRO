/** @type {import('ts-jest').JestConfigWithTsJest} **/
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      diagnostics: false,
      tsconfig: {
        target: 'ES2022',
        module: 'commonjs',
        esModuleInterop: true,
        skipLibCheck: true,
      },
    }],
  },
  moduleNameMapper: {
    '^(\\.\\.?\\/.+)\\.js$': '$1',
    '^@syncro/shared/stellar/memo$': '<rootDir>/../shared/src/stellar/memo.ts',
  },
  // Coverage collection for the per-package gate (issue #1090).
  // Minimums live in ../coverage-thresholds.json; they are 0 until the first
  // CI run reports a real number, then ratcheted up.
  coverageReporters: ["text-summary", "json-summary", "lcov"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts", "!src/**/index.ts"],
};
