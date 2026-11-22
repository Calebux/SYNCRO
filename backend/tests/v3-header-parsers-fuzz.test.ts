import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ChallengeDetails,
  PaymentProof,
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
} from '../src/services/v3/payment-challenge-service';
import { fc, resolveFuzzNumRuns } from '../../shared/src/testing/fast-check-harness';

interface RegressionSeed {
  id: string;
  target: string;
  category: string;
  description: string;
  rawJson: string;
  headerBase64: string;
}

interface RegressionFixture {
  version: string;
  issue: string;
  seeds: RegressionSeed[];
}

const regressionFixture = JSON.parse(
  readFileSync(
    path.resolve(__dirname, '../../shared/fixtures/header-fuzz-regression-seeds.json'),
    'utf8',
  ),
) as RegressionFixture;

const nonEmptyTokenArb = fc
  .string({ minLength: 1, maxLength: 32 })
  .map((s) => s.trim() || 'token_default')
  .filter((s) => s.length > 0);

const positiveAmountArb = fc
  .integer({ min: 1, max: 1_000_000 })
  .map((cents) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2)));

const isoTimestampArb = fc
  .integer({ min: 1_700_000_000_000, max: 1_900_000_000_000 })
  .map((ms) => new Date(ms).toISOString());

const validChallengeArb = fc.record<ChallengeDetails>({
  challengeId: nonEmptyTokenArb.map((s) => `chal_${s}`),
  scheme: fc.constantFrom<'channel-state' | 'exact'>('channel-state', 'exact'),
  chain: fc.constantFrom('stellar:testnet', 'stellar:mainnet', 'stellar:futurenet'),
  contract: nonEmptyTokenArb.map((s) => `C_${s}`),
  channelAddress: nonEmptyTokenArb.map((s) => `G_${s}`),
  settlementAsset: fc.constantFrom(
    'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    'XLM:native',
  ),
  amount: positiveAmountArb,
  rate: positiveAmountArb,
  nonce: nonEmptyTokenArb.map((s) => `ch_nonce_${s}`),
  expiresAt: isoTimestampArb,
  signature: nonEmptyTokenArb.map((s) => `sig_${s}`),
});

const validProofArb = fc.record<PaymentProof>(
  {
    channelId: nonEmptyTokenArb.map((s) => `chan_${s}`),
    sequenceNumber: fc.integer({ min: 1, max: 1_000_000 }),
    userBalance: fc.integer({ min: 0, max: 1_000_000 }),
    executorBalance: fc.integer({ min: 0, max: 1_000_000 }),
    totalDeposited: fc.integer({ min: 0, max: 2_000_000 }),
    nonce: nonEmptyTokenArb.map((s) => `nonce_${s}`),
    signature: nonEmptyTokenArb.map((s) => `sig_valid_${s}`),
    payerAddress: nonEmptyTokenArb.map((s) => `G_PAYER_${s}`),
    expiresAt: isoTimestampArb,
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

describe('Issue #1873: Gateway 402 challenge & payment-proof header parser fuzzing', () => {
  const numRuns = resolveFuzzNumRuns();

  beforeEach(() => {
    challengeNonceStore.clear();
    defaultChannelStateStore.clear();
  });

  it('round-trip property for valid challenges: parse(serialise(c)) === c and serialise(parse(x)) === x', () => {
    fc.assert(
      fc.property(validChallengeArb, (challenge) => {
        const encoded = serialisePaymentChallenge(challenge);
        const parsed = parsePaymentChallenge(encoded);
        expect(parsed).toEqual(challenge);
        expect(serialisePaymentChallenge(parsed!)).toBe(encoded);
      }),
      { numRuns },
    );
  });

  it('round-trip property for arbitrary challenge header strings: serialise(parse(x)) === x or parse rejects it', () => {
    const arbitraryChallengeHeaderArb = fc.oneof(
      fc.string({ minLength: 0, maxLength: 256 }),
      fc.base64String({ minLength: 0, maxLength: 256 }),
      fc.jsonValue({ maxDepth: 4 }).map((val) => Buffer.from(JSON.stringify(val ?? null)).toString('base64')),
      validChallengeArb.map((c) => serialisePaymentChallenge(c)),
      validChallengeArb.map((c) => ` ${serialisePaymentChallenge(c)} `),
    );

    fc.assert(
      fc.property(arbitraryChallengeHeaderArb, (input) => {
        const parsed = parsePaymentChallenge(input);
        if (parsed !== null) {
          expect(isValidChallengeDetails(parsed)).toBe(true);
          expect(serialisePaymentChallenge(parsed)).toBe(input);
        }
      }),
      { numRuns },
    );
  });

  it('round-trip property for valid payment proofs: parse(serialise(p)) === p and serialise(parse(x)) === x', () => {
    fc.assert(
      fc.property(validProofArb, (proof) => {
        const encoded = serialisePaymentProof(proof);
        const parsed = parsePaymentProof(encoded);
        expect(parsed).toEqual(proof);
        expect(serialisePaymentProof(parsed!)).toBe(encoded);
      }),
      { numRuns },
    );
  });

  it('round-trip property for arbitrary payment-proof header strings: serialise(parse(x)) === x or parse rejects it', () => {
    const arbitraryProofHeaderArb = fc.oneof(
      fc.string({ minLength: 0, maxLength: 256 }),
      fc.base64String({ minLength: 0, maxLength: 256 }),
      fc.jsonValue({ maxDepth: 4 }).map((val) => Buffer.from(JSON.stringify(val ?? null)).toString('base64')),
      validProofArb.map((p) => serialisePaymentProof(p)),
      validProofArb.map((p) => `${serialisePaymentProof(p)}!`),
    );

    fc.assert(
      fc.property(arbitraryProofHeaderArb, (input) => {
        const parsed = parsePaymentProof(input);
        if (parsed !== null) {
          expect(isValidPaymentProof(parsed)).toBe(true);
          expect(serialisePaymentProof(parsed)).toBe(input);
        }
      }),
      { numRuns },
    );
  });

  it('never crashes or hangs when fuzzing parsePaymentProof + verifyPaymentProof with adversarial JSON shapes', () => {
    const adversarialProofArb = fc.record<Record<string, unknown>>(
      {
        channelId: fc.anything(),
        sequenceNumber: fc.anything(),
        userBalance: fc.anything(),
        executorBalance: fc.anything(),
        totalDeposited: fc.anything(),
        nonce: fc.anything(),
        signature: fc.anything(),
        payerAddress: fc.anything(),
        expiresAt: fc.anything(),
        timestamp: fc.anything(),
        requestHash: fc.anything(),
        extraField: fc.anything(),
      },
      { requiredKeys: [] },
    );

    fc.assert(
      fc.property(adversarialProofArb, (candidate) => {
        const json = JSON.stringify(candidate) ?? '{}';
        const header = Buffer.from(json, 'utf8').toString('base64');
        const parsed = parsePaymentProof(header);
        if (parsed !== null) {
          expect(serialisePaymentProof(parsed)).toBe(header);
          const verification = verifyPaymentProof(parsed, 10, {
            nowMs: 1_750_000_000_000,
            expectedRequestHash: 'a'.repeat(64),
          });
          expect(typeof verification.valid).toBe('boolean');
        } else {
          const directVerification = verifyPaymentProof(candidate as unknown as PaymentProof, 10, {
            nowMs: 1_750_000_000_000,
            expectedRequestHash: 'a'.repeat(64),
          });
          expect(directVerification.valid).toBe(false);
        }
      }),
      { numRuns },
    );
  });

  it('generatePaymentChallenge output always satisfies the challenge round-trip property', () => {
    const { challenge, headerValue } = generatePaymentChallenge(
      {
        settlementAsset: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        amount: '10',
        rate: '0.1',
        contract: 'C_CONTRACT_123',
        chain: 'stellar:testnet',
      },
      (msg) => Buffer.from(`sig:${msg}`).toString('base64'),
    );

    const parsed = parsePaymentChallenge(headerValue);
    expect(parsed).toEqual(challenge);
    expect(serialisePaymentChallenge(parsed!)).toBe(headerValue);
  });

  it('rejects all committed regression seeds without crashing', () => {
    expect(regressionFixture.seeds.length).toBeGreaterThan(0);

    for (const seed of regressionFixture.seeds) {
      expect(() => {
        const challengeByB64 = parsePaymentChallenge(seed.headerBase64);
        if (challengeByB64 !== null) {
          expect(serialisePaymentChallenge(challengeByB64)).toBe(seed.headerBase64);
        }

        const proofByB64 = parsePaymentProof(seed.headerBase64);
        expect(proofByB64).toBeNull();

        const rawB64 = Buffer.from(seed.rawJson, 'utf8').toString('base64');
        const proofByRaw = parsePaymentProof(rawB64);
        expect(proofByRaw).toBeNull();
      }).not.toThrow();
    }
  });
});
