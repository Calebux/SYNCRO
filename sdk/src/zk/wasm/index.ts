/**
 * WASM prover artifacts placeholder.
 *
 * Compile the ZK prover to WASM and place artifacts here:
 *   - prover.wasm  (< 2MB target)
 *   - prover.js    (JS glue)
 *
 * The proof-generator falls back to native JS (@syncro/shared Pedersen)
 * when WASM is not present.
 */

export const WASM_BUNDLE_SIZE_TARGET_BYTES = 2 * 1024 * 1024;
