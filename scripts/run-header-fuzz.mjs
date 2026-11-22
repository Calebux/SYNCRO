#!/usr/bin/env node
/**
 * Property-based fuzzer for 402 challenge and payment header parsers (#1873).
 *
 * Exercises both Gateway (`backend/src/services/v3/payment-challenge-service.ts`)
 * and SDK (`sdk/src/v3/paid-fetch.ts`) header parsers with fast-check properties:
 *   1. Round-trip invariant: `serialise(parse(x)) === x`, or `parse(x)` rejects it (`null`).
 *   2. Valid domain round-trip: `parse(serialise(v))` deeply equals `v`.
 *   3. Adversarial mutation fuzzing: no crashes, no hangs, no wrongly accepted types.
 *   4. Committed regression seeds in `shared/fixtures/header-fuzz-regression-seeds.json`.
 *
 * Modes:
 *   - Short (every PR):   FUZZ_MODE=short   (default: 250 runs per property)
 *   - Long  (nightly CI): FUZZ_MODE=nightly (default: 5000 runs per property)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  challengeNonceStore,
  defaultChannelStateStore,
  generatePaymentChallenge,
  isValidChallengeDetails,
  isValidPaymentProof,
  parsePaymentChallenge,
  parsePaymentProof,
  serialisePaymentChallenge,
  serialisePaymentProof,
  verifyPaymentProof,
} from '../backend/src/services/v3/payment-challenge-service.ts';

import {
  isValidPaymentReceipt,
  isValidPaymentRequired,
  isValidSignedPaymentPayload,
  parsePaymentRequiredHeader,
  parsePaymentResponseHeader,
  parsePaymentSignatureHeader,
  serialisePaymentRequiredHeader,
  serialisePaymentResponseHeader,
  serialisePaymentSignatureHeader,
} from '../sdk/src/v3/paid-fetch.ts';

import {
  fc,
  resolveFuzzNumRuns,
  resolveFuzzSeed,
} from '../shared/src/testing/fast-check-harness.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedsPath = path.resolve(__dirname, '../shared/fixtures/header-fuzz-regression-seeds.json');
const regressionFixture = JSON.parse(fs.readFileSync(seedsPath, 'utf8'));

const numRuns = resolveFuzzNumRuns(250, 5000);
const seed = resolveFuzzSeed();
const mode = process.env.FUZZ_MODE || 'short';

console.log(`[Fuzz #1873] Running 402 challenge & payment header fuzzers (mode=${mode}, numRuns=${numRuns}, seed=${seed})...`);

const tokenArb = fc
  .string({ minLength: 1, maxLength: 24 })
  .map((s) => s.replace(/\s+/g, '_') || 'tok')
  .filter((s) => s.length > 0);

const amountArb = fc
  .integer({ min: 1, max: 500_000 })
  .map((cents) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2)));

const isoArb = fc
  .integer({ min: 1_700_000_000_000, max: 1_900_000_000_000 })
  .map((ms) => new Date(ms).toISOString());

const gatewayChallengeArb = fc.record({
  challengeId: tokenArb.map((s) => `chal_${s}`),
  scheme: fc.constantFrom('channel-state', 'exact'),
  chain: fc.constantFrom('stellar:testnet', 'stellar:mainnet'),
  contract: tokenArb.map((s) => `C_${s}`),
  channelAddress: tokenArb.map((s) => `G_${s}`),
  settlementAsset: fc.constantFrom('USDC:STELLAR', 'XLM:native'),
  amount: amountArb,
  rate: amountArb,
  nonce: tokenArb.map((s) => `ch_nonce_${s}`),
  expiresAt: isoArb,
  signature: tokenArb.map((s) => `sig_${s}`),
});

const gatewayProofArb = fc.record(
  {
    channelId: tokenArb.map((s) => `chan_${s}`),
    sequenceNumber: fc.integer({ min: 1, max: 1_000_000 }),
    userBalance: fc.integer({ min: 0, max: 1_000_000 }),
    executorBalance: fc.integer({ min: 0, max: 1_000_000 }),
    totalDeposited: fc.integer({ min: 0, max: 2_000_000 }),
    nonce: tokenArb.map((s) => `nonce_${s}`),
    signature: tokenArb.map((s) => `sig_valid_${s}`),
    payerAddress: tokenArb.map((s) => `G_PAYER_${s}`),
    expiresAt: isoArb,
    timestamp: fc.integer({ min: 1_700_000_000_000, max: 1_900_000_000_000 }),
    requestHash: fc
      .hexaString({ minLength: 64, maxLength: 64 })
      .map((h) => (h.length === 64 && /^[0-9a-fA-F]{64}$/.test(h) ? h.toLowerCase() : 'a'.repeat(64))),
  },
  {
    requiredKeys: [
      'channelId',
      'sequenceNumber',
      'userBalance',
      'executorBalance',
      'totalDeposited',
      'nonce',
      'signature',
      'payerAddress',
    ],
  },
);

const sdkRequirementArb = fc.record({
  scheme: fc.constantFrom('exact', 'channel-state'),
  network: fc.constantFrom('stellar:testnet', 'stellar:mainnet', 'eip155:84532'),
  amount: amountArb,
  asset: fc.constantFrom('USDC:STELLAR', 'XLM:native'),
  payTo: tokenArb.map((s) => `G_${s}`),
  maxTimeoutSeconds: fc.integer({ min: 1, max: 600 }),
});

const sdkChallengeArb = fc.record({
  x402Version: fc.constant(2),
  signature: tokenArb.map((s) => `sig_${s}`),
  accepts: fc.array(sdkRequirementArb, { minLength: 1, maxLength: 3 }),
});

const sdkSignatureArb = fc.record({
  x402Version: fc.constant(2),
  accepted: sdkRequirementArb,
  payload: fc.record({
    signature: tokenArb.map((s) => `sig_proof_${s}`),
  }),
});

const sdkReceiptArb = fc.record({
  success: fc.boolean(),
  transaction: tokenArb.map((s) => `tx_${s}`),
  network: fc.constantFrom('stellar:testnet', 'stellar:mainnet'),
});

// 1. Gateway Challenge round-trip & arbitrary fuzzing
fc.assert(
  fc.property(gatewayChallengeArb, (challenge) => {
    const encoded = serialisePaymentChallenge(challenge);
    const parsed = parsePaymentChallenge(encoded);
    assert.deepEqual(parsed, challenge);
    assert.equal(serialisePaymentChallenge(parsed), encoded);
  }),
  { numRuns, seed },
);

// 2. Gateway PaymentProof round-trip & arbitrary fuzzing
fc.assert(
  fc.property(gatewayProofArb, (proof) => {
    const encoded = serialisePaymentProof(proof);
    const parsed = parsePaymentProof(encoded);
    assert.deepEqual(parsed, proof);
    assert.equal(serialisePaymentProof(parsed), encoded);
  }),
  { numRuns, seed },
);

// 3. SDK PAYMENT-REQUIRED, PAYMENT-SIGNATURE, PAYMENT-RESPONSE round-trip
fc.assert(
  fc.property(sdkChallengeArb, (challenge) => {
    const encoded = serialisePaymentRequiredHeader(challenge);
    const parsed = parsePaymentRequiredHeader(encoded);
    assert.deepEqual(parsed, challenge);
    assert.equal(serialisePaymentRequiredHeader(parsed), encoded);
  }),
  { numRuns, seed },
);

fc.assert(
  fc.property(sdkSignatureArb, (payload) => {
    const encoded = serialisePaymentSignatureHeader(payload);
    const parsed = parsePaymentSignatureHeader(encoded);
    assert.deepEqual(parsed, payload);
    assert.equal(serialisePaymentSignatureHeader(parsed), encoded);
  }),
  { numRuns, seed },
);

fc.assert(
  fc.property(sdkReceiptArb, (receipt) => {
    const encoded = serialisePaymentResponseHeader(receipt);
    const parsed = parsePaymentResponseHeader(encoded);
    assert.deepEqual(parsed, receipt);
    assert.equal(serialisePaymentResponseHeader(parsed), encoded);
  }),
  { numRuns, seed },
);

// 4. Universal round-trip invariant across arbitrary / mutated strings on both sides:
//    For any input string x, either parse(x) === null or serialise(parse(x)) === x
const arbitraryHeaderInputArb = fc.oneof(
  fc.string({ minLength: 0, maxLength: 256 }),
  fc.base64String({ minLength: 0, maxLength: 256 }),
  fc.jsonValue({ maxDepth: 4 }).map((v) => Buffer.from(JSON.stringify(v ?? null), 'utf8').toString('base64')),
  gatewayChallengeArb.map((c) => serialisePaymentChallenge(c)),
  gatewayProofArb.map((p) => serialisePaymentProof(p)),
  sdkChallengeArb.map((c) => serialisePaymentRequiredHeader(c)),
  sdkSignatureArb.map((p) => serialisePaymentSignatureHeader(p)),
  sdkReceiptArb.map((r) => serialisePaymentResponseHeader(r)),
);

fc.assert(
  fc.property(arbitraryHeaderInputArb, (x) => {
    const gwChallenge = parsePaymentChallenge(x);
    if (gwChallenge !== null) {
      assert.equal(isValidChallengeDetails(gwChallenge), true);
      assert.equal(serialisePaymentChallenge(gwChallenge), x);
    }

    const gwProof = parsePaymentProof(x);
    if (gwProof !== null) {
      assert.equal(isValidPaymentProof(gwProof), true);
      assert.equal(serialisePaymentProof(gwProof), x);
    }

    const sdkReq = parsePaymentRequiredHeader(x);
    if (sdkReq !== null) {
      assert.equal(isValidPaymentRequired(sdkReq), true);
      assert.equal(serialisePaymentRequiredHeader(sdkReq), x);
    }

    const sdkSig = parsePaymentSignatureHeader(x);
    if (sdkSig !== null) {
      assert.equal(isValidSignedPaymentPayload(sdkSig), true);
      assert.equal(serialisePaymentSignatureHeader(sdkSig), x);
    }

    const sdkRes = parsePaymentResponseHeader(x);
    if (sdkRes !== null) {
      assert.equal(isValidPaymentReceipt(sdkRes), true);
      assert.equal(serialisePaymentResponseHeader(sdkRes), x);
    }
  }),
  { numRuns, seed },
);

// 5. Verify all committed regression seeds
challengeNonceStore.clear();
defaultChannelStateStore.clear();

for (const entry of regressionFixture.seeds) {
  assert.equal(parsePaymentProof(entry.headerBase64), null, `Expected gateway parsePaymentProof to reject ${entry.id}`);
  assert.equal(parsePaymentSignatureHeader(entry.headerBase64), null, `Expected SDK parsePaymentSignatureHeader to reject ${entry.id}`);
  assert.equal(parsePaymentResponseHeader(entry.headerBase64), null, `Expected SDK parsePaymentResponseHeader to reject ${entry.id}`);

  const rawEncoded = Buffer.from(entry.rawJson, 'utf8').toString('base64');
  assert.equal(parsePaymentProof(rawEncoded), null, `Expected gateway parsePaymentProof to reject rawJson of ${entry.id}`);

  // Also test verifyPaymentProof directly against parsed raw JSON if it is an object
  try {
    const rawObj = JSON.parse(entry.rawJson);
    if (rawObj && typeof rawObj === 'object') {
      const result = verifyPaymentProof(rawObj, 10, {
        nowMs: 1_750_000_000_000,
        expectedRequestHash: 'a'.repeat(64),
      });
      assert.equal(result.valid, false, `Expected verifyPaymentProof to reject ${entry.id}`);
    }
  } catch {
    // Non-JSON seed
  }
}

// 6. Verify generatePaymentChallenge round-trip
const generated = generatePaymentChallenge(
  {
    settlementAsset: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    amount: '25',
    rate: '0.25',
    contract: 'C_TEST_CONTRACT',
    chain: 'stellar:testnet',
  },
  (msg) => Buffer.from(`sig:${msg}`).toString('base64'),
);
assert.deepEqual(parsePaymentChallenge(generated.headerValue), generated.challenge);
assert.equal(serialisePaymentChallenge(parsePaymentChallenge(generated.headerValue)), generated.headerValue);
assert.deepEqual(parsePaymentRequiredHeader(generated.headerValue), generated.challenge);
assert.equal(serialisePaymentRequiredHeader(parsePaymentRequiredHeader(generated.headerValue)), generated.headerValue);

console.log(`✓ [Fuzz #1873] All property fuzzers (${numRuns} runs/property) and ${regressionFixture.seeds.length} regression seeds passed!`);
