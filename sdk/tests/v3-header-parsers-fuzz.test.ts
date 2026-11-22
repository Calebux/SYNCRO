import { describe, it, expect, jest } from "@jest/globals";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  createPaidFetch,
  isValidPaymentReceipt,
  isValidPaymentRequired,
  isValidSignedPaymentPayload,
  parsePaymentRequiredHeader,
  parsePaymentResponseHeader,
  parsePaymentSignatureHeader,
  serialisePaymentRequiredHeader,
  serialisePaymentResponseHeader,
  serialisePaymentSignatureHeader,
  type PaymentReceipt,
  type X402PaymentRequired,
  type X402PaymentRequirement,
  type X402SignedPaymentPayload,
} from "../src/v3/paid-fetch.js";
import { fc, resolveFuzzNumRuns } from "../../shared/src/testing/fast-check-harness.js";

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
    path.resolve(process.cwd(), "../shared/fixtures/header-fuzz-regression-seeds.json"),
    "utf8",
  ),
) as RegressionFixture;

const nonEmptyTokenArb = fc
  .string({ minLength: 1, maxLength: 28 })
  .map((s) => s.trim() || "token_default")
  .filter((s) => s.length > 0);

const positiveAmountArb = fc
  .integer({ min: 1, max: 1_000_000 })
  .map((cents) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2)));

const isoTimestampArb = fc
  .integer({ min: 1_700_000_000_000, max: 1_900_000_000_000 })
  .map((ms) => new Date(ms).toISOString());

const validRequirementArb = fc.record<X402PaymentRequirement>(
  {
    scheme: fc.constantFrom("exact", "channel-state"),
    network: fc.constantFrom("stellar:testnet", "stellar:mainnet", "eip155:84532"),
    amount: positiveAmountArb,
    asset: fc.constantFrom(
      "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "XLM:native",
    ),
    payTo: nonEmptyTokenArb.map((s) => `G_${s}`),
    maxTimeoutSeconds: fc.integer({ min: 1, max: 3600 }),
  },
  {
    requiredKeys: ["scheme", "network", "amount", "asset", "payTo"],
  },
);

const validX402ChallengeArb = fc.record<X402PaymentRequired>(
  {
    x402Version: fc.constant(2),
    signature: nonEmptyTokenArb.map((s) => `sig_${s}`),
    error: nonEmptyTokenArb.map((s) => `err_${s}`),
    accepts: fc.array(validRequirementArb, { minLength: 0, maxLength: 3 }),
  },
  {
    requiredKeys: ["x402Version"],
  },
);

const validGatewayChallengeArb = fc.record<X402PaymentRequired>(
  {
    challengeId: nonEmptyTokenArb.map((s) => `chal_${s}`),
    scheme: fc.constantFrom<"channel-state" | "exact">("channel-state", "exact"),
    chain: fc.constantFrom("stellar:testnet", "stellar:mainnet"),
    contract: nonEmptyTokenArb.map((s) => `C_${s}`),
    channelAddress: nonEmptyTokenArb.map((s) => `G_${s}`),
    settlementAsset: fc.constantFrom("USDC:STELLAR", "XLM:native"),
    amount: positiveAmountArb,
    rate: positiveAmountArb,
    nonce: nonEmptyTokenArb.map((s) => `ch_nonce_${s}`),
    expiresAt: isoTimestampArb,
    signature: nonEmptyTokenArb.map((s) => `sig_${s}`),
  },
  {
    requiredKeys: [
      "challengeId",
      "scheme",
      "chain",
      "contract",
      "channelAddress",
      "settlementAsset",
      "amount",
      "rate",
      "nonce",
      "expiresAt",
      "signature",
    ],
  },
);

const validSignedPaymentPayloadArb = fc.record<X402SignedPaymentPayload>({
  x402Version: fc.constant(2),
  accepted: validRequirementArb,
  payload: fc.record({
    signature: nonEmptyTokenArb.map((s) => `sig_proof_${s}`),
  }),
});

const validReceiptArb = fc.record<PaymentReceipt>(
  {
    success: fc.boolean(),
    transaction: nonEmptyTokenArb.map((s) => `tx_${s}`),
    network: fc.constantFrom("stellar:testnet", "stellar:mainnet", "eip155:84532"),
  },
  {
    requiredKeys: ["success"],
  },
);

describe("Issue #1873: SDK 402 challenge, payment-signature & payment-response parser fuzzing", () => {
  const numRuns = resolveFuzzNumRuns();
  const gatewayKeys = generateKeyPairSync("ed25519");
  const gatewayPublicKey = gatewayKeys.publicKey
    .export({ type: "spki", format: "pem" })
    .toString();

  it("round-trip property for PAYMENT-REQUIRED challenges (x402 v2 & gateway channel-state)", () => {
    const challengeArb = fc.oneof(validX402ChallengeArb, validGatewayChallengeArb);

    fc.assert(
      fc.property(challengeArb, (challenge) => {
        const encoded = serialisePaymentRequiredHeader(challenge);
        const parsed = parsePaymentRequiredHeader(encoded);
        expect(parsed).toEqual(challenge);
        expect(serialisePaymentRequiredHeader(parsed!)).toBe(encoded);
      }),
      { numRuns },
    );
  });

  it("round-trip property for arbitrary PAYMENT-REQUIRED strings: serialise(parse(x)) === x or parse rejects it", () => {
    const arbitraryHeaderArb = fc.oneof(
      fc.string({ minLength: 0, maxLength: 256 }),
      fc.base64String({ minLength: 0, maxLength: 256 }),
      fc.jsonValue({ maxDepth: 4 }).map((v) =>
        Buffer.from(JSON.stringify(v ?? null), "utf8").toString("base64"),
      ),
      validX402ChallengeArb.map((c) => serialisePaymentRequiredHeader(c)),
      validGatewayChallengeArb.map((c) => serialisePaymentRequiredHeader(c)),
      validX402ChallengeArb.map((c) => `  ${serialisePaymentRequiredHeader(c)}  `),
    );

    fc.assert(
      fc.property(arbitraryHeaderArb, (input) => {
        const parsed = parsePaymentRequiredHeader(input);
        if (parsed !== null) {
          expect(isValidPaymentRequired(parsed)).toBe(true);
          expect(serialisePaymentRequiredHeader(parsed)).toBe(input);
        }
      }),
      { numRuns },
    );
  });

  it("round-trip property for PAYMENT-SIGNATURE payloads: serialise(parse(x)) === x or parse rejects it", () => {
    fc.assert(
      fc.property(validSignedPaymentPayloadArb, (payload) => {
        const encoded = serialisePaymentSignatureHeader(payload);
        const parsed = parsePaymentSignatureHeader(encoded);
        expect(parsed).toEqual(payload);
        expect(serialisePaymentSignatureHeader(parsed!)).toBe(encoded);
      }),
      { numRuns },
    );

    const arbitrarySignatureHeaderArb = fc.oneof(
      fc.string({ minLength: 0, maxLength: 256 }),
      fc.base64String({ minLength: 0, maxLength: 256 }),
      fc.jsonValue({ maxDepth: 4 }).map((v) =>
        Buffer.from(JSON.stringify(v ?? null), "utf8").toString("base64"),
      ),
      validSignedPaymentPayloadArb.map((p) => serialisePaymentSignatureHeader(p)),
    );

    fc.assert(
      fc.property(arbitrarySignatureHeaderArb, (input) => {
        const parsed = parsePaymentSignatureHeader(input);
        if (parsed !== null) {
          expect(isValidSignedPaymentPayload(parsed)).toBe(true);
          expect(serialisePaymentSignatureHeader(parsed)).toBe(input);
        }
      }),
      { numRuns },
    );
  });

  it("round-trip property for PAYMENT-RESPONSE receipts: serialise(parse(x)) === x or parse rejects it", () => {
    fc.assert(
      fc.property(validReceiptArb, (receipt) => {
        const encoded = serialisePaymentResponseHeader(receipt);
        const parsed = parsePaymentResponseHeader(encoded);
        expect(parsed).toEqual(receipt);
        expect(serialisePaymentResponseHeader(parsed!)).toBe(encoded);
      }),
      { numRuns },
    );

    const arbitraryResponseHeaderArb = fc.oneof(
      fc.string({ minLength: 0, maxLength: 256 }),
      fc.base64String({ minLength: 0, maxLength: 256 }),
      fc.jsonValue({ maxDepth: 4 }).map((v) =>
        Buffer.from(JSON.stringify(v ?? null), "utf8").toString("base64"),
      ),
      validReceiptArb.map((r) => serialisePaymentResponseHeader(r)),
    );

    fc.assert(
      fc.property(arbitraryResponseHeaderArb, (input) => {
        const parsed = parsePaymentResponseHeader(input);
        if (parsed !== null) {
          expect(isValidPaymentReceipt(parsed)).toBe(true);
          expect(serialisePaymentResponseHeader(parsed)).toBe(input);
        }
      }),
      { numRuns },
    );
  });

  it("createPaidFetch never signs or crashes on untrusted fuzzed PAYMENT-REQUIRED headers", async () => {
    const sign = jest.fn(() => "should-not-be-called");
    const arbitraryHeaderArb = fc.oneof(
      fc.string({ minLength: 0, maxLength: 128 }),
      fc.base64String({ minLength: 0, maxLength: 128 }),
      fc.jsonValue({ maxDepth: 3 }).map((v) =>
        Buffer.from(JSON.stringify(v ?? null), "utf8").toString("base64"),
      ),
    );

    await fc.assert(
      fc.asyncProperty(arbitraryHeaderArb, async (fuzzedHeader) => {
        const safeHeader = fuzzedHeader.replace(/[\r\n]/g, "");
        const fetchImpl = jest.fn(async () => {
          const headers = new Headers();
          try {
            headers.set("PAYMENT-REQUIRED", safeHeader);
          } catch {
            // Invalid HTTP header byte sequence in Fetch standard
          }
          return new Response("payment required", { status: 402, headers });
        });

        const paidFetch = createPaidFetch({
          gatewayPublicKey,
          fetchImpl: fetchImpl as unknown as typeof fetch,
          sign,
        });

        const response = await paidFetch("https://example.com/metered");
        expect(response.status).toBe(402);
        expect(sign).not.toHaveBeenCalled();
      }),
      { numRuns: Math.min(numRuns, 100) },
    );
  });

  it("rejects all committed regression seeds without crashing", () => {
    expect(regressionFixture.seeds.length).toBeGreaterThan(0);

    for (const seed of regressionFixture.seeds) {
      expect(() => {
        const reqParsed = parsePaymentRequiredHeader(seed.headerBase64);
        if (reqParsed !== null) {
          expect(serialisePaymentRequiredHeader(reqParsed)).toBe(seed.headerBase64);
        }

        const sigParsed = parsePaymentSignatureHeader(seed.headerBase64);
        expect(sigParsed).toBeNull();

        const resParsed = parsePaymentResponseHeader(seed.headerBase64);
        expect(resParsed).toBeNull();
      }).not.toThrow();
    }
  });
});
