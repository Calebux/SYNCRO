module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/tests/**/*.test.ts'],
    verbose: true,
    forceExit: true,
    clearMocks: false,
    resetMocks: false,
    restoreMocks: false,
    setupFiles: ['<rootDir>/tests/setup.ts'],
    moduleNameMapper: {
        '^@syncro/shared$': '<rootDir>/../shared/src',
        '^@syncro/shared/(.*)$': '<rootDir>/../shared/src/$1',
    },
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
        '^.+\\.js$': ['ts-jest', { diagnostics: false }],
    },
    transformIgnorePatterns: [
        '/node_modules/(?!(@stellar/stellar-sdk|uuid))',
    ],
    coverageReporters: ['text-summary', 'json-summary', 'lcov'],
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/*.d.ts',
        '!src/types/**',
        '!src/**/*.example.ts',
    ],
    // Ratchet, not a target — see DEBT.md
    coverageThreshold: {
        global: {
            statements: 62,
            branches: 55,
            functions: 55,
            lines: 62,
        },
    },
};