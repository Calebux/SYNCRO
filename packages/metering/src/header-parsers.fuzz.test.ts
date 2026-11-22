import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  type ChallengeDetails,
  type PaymentProof,
  isValidChallengeDetails,
  isValidPaymentProof,
  parsePaymentChallenge,
  parsePaymentProof,
  serialisePaymentChallenge,
  serialisePaymentProof,
} from '../../../backend/src/services/v3/payment-challenge-service';
import {
  type PaymentReceipt,
  type X402PaymentRequired,
  type X402PaymentRequirement,
  type X402SignedPaymentPayload,
  isValidPaymentReceipt,
  isValidPaymentRequired,
  isValidSignedPaymentPayload,
  parsePaymentRequiredHeader,
  parsePaymentResponseHeader,
  parsePaymentSignatureHeader,
  serialisePaymentRequiredHeader,
  serialisePaymentResponseHeader,
  serialisePaymentSignatureHeader,
} from '../../../sdk/src/v3/paid-fetch';
import { resolveFuzzNumRuns } from '../../../shared/src/testing/fast-check-harness';

interface RegressionSeed {
  id: string;
  target: string;
  category: string;
  description: string;
  rawJson: string;
  headerBase64: string;
}

const regressionFixture = JSON.parse(
  readFileSync(
    path.resolve(__dirname, '../../../shared/fixtures/header-fuzz-regression-seeds.json'),
    'utf8',
  ),
) as { seeds: RegressionSeed[] };

const nonEmptyToken = fc
  .stringMatching(/^[A-Za-z0-9_-]{1,24}$/)
  .filter((s) => s.trim().length > 0);

const positiveDecimal = fc
  .integer({ min: 1, max: 500_000 })
  .map((cents) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2)));

const isoTimestamp = fc
  .integer({ min: 1_700_000_000_000, max: 1_900_000_000_000 })
  .map((ms) => new Date(ms).toISOString());

const gatewayChallengeArb: fc.Arbitrary<ChallengeDetails> = fc.record({
  challengeId: nonEmptyToken.map((s) => `chal_${s}`),
  scheme: fc.constantFrom<'channel-state' | 'exact'>('channel-state', 'exact'),
  chain: fc.constantFrom('stellar:testnet', 'stellar:mainnet'),
  contract: nonEmptyToken.map((s) => `C_${s}`),
  channelAddress: nonEmptyToken.map((s) => `G_${s}`),
  settlementAsset: fc.constantFrom('USDC:STELLAR', 'XLM:native'),
  amount: positiveDecimal,
  rate: positiveDecimal,
  nonce: nonEmptyToken.map((s) => `ch_nonce_${s}`),
  expiresAt: isoTimestamp,
  signature: nonEmptyToken.map((s) => `sig_${s}`),
});

const gatewayProofArb: fc.Arbitrary<PaymentProof> = fc.record({
  channelId: nonEmptyToken.map((s) => `chan_${s}`),
  sequenceNumber: fc.integer({ min: 1, max: 1_000_000 }),
  userBalance: fc.integer({ min: 0, max: 1_000_000 }),
  executorBalance: fc.integer({ min: 0, max: 1_000_000 }),
  totalDeposited: fc.integer({ min: 0, max: 2_000_000 }),
  nonce: nonEmptyToken.map((s) => `n_${s}`),
  signature: nonEmptyToken.map((s) => `sig_valid_${s}`),
  payerAddress: nonEmptyToken.map((s) => `G_PAYER_${s}`),
});

const sdkRequirementArb: fc.Arbitrary<X402PaymentRequirement> = fc.record({
  scheme: fc.constantFrom('exact', 'channel-state'),
  network: fc.constantFrom('stellar:testnet', 'stellar:mainnet', 'eip155:84532'),
  amount: positiveDecimal,
  asset: fc.constantFrom('USDC:STELLAR', 'XLM:native'),
  payTo: nonEmptyToken.map((s) => `G_${s}`),
  maxTimeoutSeconds: fc.integer({ min: 1, max: 600 }),
});

const sdkChallengeArb: fc.Arbitrary<X402PaymentRequired> = fc.record({
  x402Version: fc.constant(2),
  signature: nonEmptyToken.map((s) => `sig_${s}`),
  accepts: fc.array(sdkRequirementArb, { minLength: 1, maxLength: 3 }),
});

const sdkSignatureArb: fc.Arbitrary<X402SignedPaymentPayload> = fc.record({
  x402Version: fc.constant(2),
  accepted: sdkRequirementArb,
  payload: fc.record({
    signature: nonEmptyToken.map((s) => `sig_proof_${s}`),
  }),
});

const sdkReceiptArb: fc.Arbitrary<PaymentReceipt> = fc.record({
  success: fc.boolean(),
  transaction: nonEmptyToken.map((s) => `tx_${s}`),
  network: fc.constantFrom('stellar:testnet', 'stellar:mainnet'),
});

describe('Issue #1873: fast-check property fuzzing for Gateway & SDK header parsers', () => {
  const numRuns = resolveFuzzNumRuns();

  it('gateway challenge parser satisfies serialise(parse(x)) === x or rejects x', () => {
    fc.assert(
      fc.property(gatewayChallengeArb, (challenge) => {
        const encoded = serialisePaymentChallenge(challenge);
        const parsed = parsePaymentChallenge(encoded);
        expect(parsed).toEqual(challenge);
        expect(serialisePaymentChallenge(parsed!)).toBe(encoded);
      }),
      { numRuns },
    );

    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.base64String()), (raw) => {
        const parsed = parsePaymentChallenge(raw);
        if (parsed !== null) {
          expect(isValidChallengeDetails(parsed)).toBe(true);
          expect(serialisePaymentChallenge(parsed)).toBe(raw);
        }
      }),
      { numRuns },
    );
  });

  it('gateway payment-proof parser satisfies serialise(parse(x)) === x or rejects x', () => {
    fc.assert(
      fc.property(gatewayProofArb, (proof) => {
        const encoded = serialisePaymentProof(proof);
        const parsed = parsePaymentProof(encoded);
        expect(parsed).toEqual(proof);
        expect(serialisePaymentProof(parsed!)).toBe(encoded);
      }),
      { numRuns },
    );

    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.base64String()), (raw) => {
        const parsed = parsePaymentProof(raw);
        if (parsed !== null) {
          expect(isValidPaymentProof(parsed)).toBe(true);
          expect(serialisePaymentProof(parsed)).toBe(raw);
        }
      }),
      { numRuns },
    );
  });

  it('SDK PAYMENT-REQUIRED, PAYMENT-SIGNATURE, and PAYMENT-RESPONSE parsers satisfy serialise(parse(x)) === x or reject x', () => {
    fc.assert(
      fc.property(sdkChallengeArb, (challenge) => {
        const encoded = serialisePaymentRequiredHeader(challenge);
        const parsed = parsePaymentRequiredHeader(encoded);
        expect(parsed).toEqual(challenge);
        expect(serialisePaymentRequiredHeader(parsed!)).toBe(encoded);
      }),
      { numRuns },
    );

    fc.assert(
      fc.property(sdkSignatureArb, (payload) => {
        const encoded = serialisePaymentSignatureHeader(payload);
        const parsed = parsePaymentSignatureHeader(encoded);
        expect(parsed).toEqual(payload);
        expect(serialisePaymentSignatureHeader(parsed!)).toBe(encoded);
      }),
      { numRuns },
    );

    fc.assert(
      fc.property(sdkReceiptArb, (receipt) => {
        const encoded = serialisePaymentResponseHeader(receipt);
        const parsed = parsePaymentResponseHeader(encoded);
        expect(parsed).toEqual(receipt);
        expect(serialisePaymentResponseHeader(parsed!)).toBe(encoded);
      }),
      { numRuns },
    );

    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.base64String()), (raw) => {
        const req = parsePaymentRequiredHeader(raw);
        if (req !== null) {
          expect(isValidPaymentRequired(req)).toBe(true);
          expect(serialisePaymentRequiredHeader(req)).toBe(raw);
        }
        const sig = parsePaymentSignatureHeader(raw);
        if (sig !== null) {
          expect(isValidSignedPaymentPayload(sig)).toBe(true);
          expect(serialisePaymentSignatureHeader(sig)).toBe(raw);
        }
        const res = parsePaymentResponseHeader(raw);
        if (res !== null) {
          expect(isValidPaymentReceipt(res)).toBe(true);
          expect(serialisePaymentResponseHeader(res)).toBe(raw);
        }
      }),
      { numRuns },
    );
  });

  it('replays all committed regression seeds without crashes or false acceptances', () => {
    for (const seed of regressionFixture.seeds) {
      expect(parsePaymentProof(seed.headerBase64)).toBeNull();
      expect(parsePaymentSignatureHeader(seed.headerBase64)).toBeNull();
      expect(parsePaymentResponseHeader(seed.headerBase64)).toBeNull();
      const challenge = parsePaymentRequiredHeader(seed.headerBase64);
      if (challenge !== null) {
        expect(serialisePaymentRequiredHeader(challenge)).toBe(seed.headerBase64);
      }
    }
  });
});
