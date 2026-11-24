// Mutation testing gate for the v3 receipt verifier (issue #1874).
//
// MUTATION_SCORE_THRESHOLD is UNMEASURED. No Stryker run has been recorded yet,
// so 50 is a conservative starting floor, not a result. After the first CI run
// reports the real score, set this to just under it and ratchet upward.
// Do not lower it to make a red build pass; add or fix tests instead.
const MUTATION_SCORE_THRESHOLD = 50;

// Scope: only code that the SDK's own jest suite (sdk/tests) exercises.
// The gateway receipt signer (backend/src/v3/receipt-service.ts) and the
// state-signing code (backend/src/services/channel-signer-lease-service.ts,
// backend/src/jobs/signed-state-replication-job.ts) are covered by the backend
// jest suite. They need their own backend Stryker config before they can be
// gated; listing them here would score them as fully surviving mutants.
//
// Stryker exits non-zero when the score is below thresholds.break, which is
// what enforces the gate in CI.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: "jest",
  jest: {
    configFile: "jest.config.js",
  },
  mutate: ["src/v3/receipt.ts"],
  coverageAnalysis: "perTest",
  thresholds: {
    high: MUTATION_SCORE_THRESHOLD + 20,
    low: MUTATION_SCORE_THRESHOLD,
    break: MUTATION_SCORE_THRESHOLD,
  },
  reporters: ["clear-text", "html", "json"],
  htmlReporter: { fileName: "coverage/mutation/mutation.html" },
  jsonReporter: { fileName: "coverage/mutation/mutation.json" },
  tempDirName: "coverage/mutation/tmp",
};
