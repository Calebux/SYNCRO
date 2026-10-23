/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/crypto-vectors.test.ts'],
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
    '^@syncro/shared/crypto/runtime/node$': '<rootDir>/../shared/src/crypto/runtime/browser.ts',
    '^@syncro/shared/crypto/runtime/browser$': '<rootDir>/../shared/src/crypto/runtime/browser.ts',
    '^@syncro/shared/crypto$': '<rootDir>/../shared/src/crypto/index.ts',
  },
};
