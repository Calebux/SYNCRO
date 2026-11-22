import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  GatewayClient,
  createGatewayErrorFromCode,
  getGatewayRetrySemantics,
  isGatewayErrorCode,
  parsePaymentRequiredHeader,
  parsePaymentResponseHeader,
  parsePaymentSignatureHeader,
  serialisePaymentRequiredHeader,
  serialisePaymentResponseHeader,
  serialisePaymentSignatureHeader,
} from "../src/v3/index.js";
import {
  SdkGatewayContractMismatchError,
  assertErrorResponseMatchesContract,
  assertGatewayChallengeResponseMatchesContract,
  assertGatewayTaxonomyAlignedWithContract,
  assertX402ChallengeHeaderMatchesContract,
  type SdkGatewayContractSpec,
} from "../../shared/src/testing/sdk-gateway-contract-verifier.js";

const contract = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), "../shared/contracts/sdk-gateway-contract.json"),
    "utf8",
  ),
) as SdkGatewayContractSpec;

const gatewayTaxonomy = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), "../backend/src/errors/gateway-taxonomy.json"),
    "utf8",
  ),
) as { errors: SdkGatewayContractSpec["errorTaxonomy"] };

describe("Issue #1872: SDK consumer-driven contract suite against Gateway", () => {
  it("records and verifies all 15 error taxonomy codes (#1493) between SDK and Gateway", () => {
    assertGatewayTaxonomyAlignedWithContract(contract, gatewayTaxonomy.errors);

    for (const entry of contract.errorTaxonomy) {
      expect(isGatewayErrorCode(entry.code)).toBe(true);
      const err = createGatewayErrorFromCode(entry.code, {
        ...(entry.retryAfterSeconds !== undefined ? { retryAfterSeconds: entry.retryAfterSeconds } : {}),
      });
      expect(err.code).toBe(entry.code);
      expect(err.status).toBe(entry.httpStatus);
      expect(err.action).toBe(entry.action);
      expect(err.retryable).toBe(entry.retryable);

      const semantics = getGatewayRetrySemantics(entry.code);
      expect(semantics.retryable).toBe(entry.retryable);
      expect(semantics.supportsRetryAfter).toBe(entry.supportsRetryAfterHeader);
    }
  });

  it("verifies GatewayClient consumes every contracted error taxonomy response body and Retry-After header", async () => {
    for (const entry of contract.errorTaxonomy) {
      const responseSnapshot = {
        status: entry.httpStatus,
        headers:
          entry.retryAfterSeconds !== undefined
            ? { [contract.headers.retryAfter]: String(entry.retryAfterSeconds) }
            : {},
        body: {
          code: entry.code,
          message: entry.defaultMessage,
          action: entry.action,
          retryable: entry.retryable,
          ...(entry.retryAfterSeconds !== undefined
            ? { retryAfterSeconds: entry.retryAfterSeconds }
            : {}),
        },
      };

      assertErrorResponseMatchesContract(contract, entry.code, responseSnapshot);

      let capturedIdempotencyKey: string | null = null;
      const client = new GatewayClient({
        retryPolicy: {
          maxAttempts: 1,
          baseDelayMs: 1,
          maxDelayMs: 1,
          jitterRatio: 0,
          maxTotalDurationMs: 10,
        },
        fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
          capturedIdempotencyKey = new Headers(init?.headers).get(contract.headers.idempotencyKey);
          return new Response(JSON.stringify(responseSnapshot.body), {
            status: responseSnapshot.status,
            headers: {
              "content-type": "application/json",
              ...responseSnapshot.headers,
            },
          });
        }) as typeof fetch,
      });

      await expect(
        client.logicalCallJson("https://gateway.syncro.test/api/v3/gateway/paid", {
          method: "POST",
        }),
      ).rejects.toMatchObject({
        code: entry.code,
        status: entry.httpStatus,
        action: entry.action,
        retryable: entry.retryable,
      });
      expect(capturedIdempotencyKey).toBeTruthy();
    }
  });

  it("verifies challenge, payment-signature, and payment-response header contracts", () => {
    const gatewayChallenge = {
      challengeId: "chal_contract_01",
      scheme: "channel-state" as const,
      chain: "stellar:testnet",
      contract: "C_CONTRACT_ADDR",
      channelAddress: "G_CHANNEL_ADDR",
      settlementAsset: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      amount: "10",
      rate: "0.1",
      nonce: "ch_nonce_01",
      expiresAt: "2026-12-01T00:00:00.000Z",
      signature: "sig_gateway_01",
    };

    const challengeHeader = serialisePaymentRequiredHeader(gatewayChallenge);
    assertGatewayChallengeResponseMatchesContract(contract, {
      status: 402,
      headers: { [contract.headers.paymentRequired]: challengeHeader },
      body: {
        error: "Payment required",
        challenge: gatewayChallenge,
      },
    });
    expect(parsePaymentRequiredHeader(challengeHeader)).toEqual(gatewayChallenge);

    const x402Challenge = {
      x402Version: 2,
      signature: "sig_x402_01",
      accepts: [
        {
          scheme: "exact",
          network: "stellar:testnet",
          amount: "50",
          asset: "USDC:STELLAR",
          payTo: "G_PROVIDER_1",
          maxTimeoutSeconds: 120,
        },
      ],
    };
    const x402Header = serialisePaymentRequiredHeader(x402Challenge);
    assertX402ChallengeHeaderMatchesContract(
      contract,
      contract.headers.paymentRequired,
      x402Header,
    );
    expect(parsePaymentRequiredHeader(x402Header)).toEqual(x402Challenge);

    const signedPayment = {
      x402Version: 2,
      accepted: x402Challenge.accepts[0]!,
      payload: { signature: "sig_payment_01" },
    };
    const sigHeader = serialisePaymentSignatureHeader(signedPayment);
    expect(parsePaymentSignatureHeader(sigHeader)).toEqual(signedPayment);

    const settlementReceipt = {
      success: true,
      transaction: "tx_stellar_01",
      network: "stellar:testnet",
    };
    const resHeader = serialisePaymentResponseHeader(settlementReceipt);
    expect(parsePaymentResponseHeader(resHeader)).toEqual(settlementReceipt);
  });

  it("fails immediately when the gateway renames a header or removes a field the SDK depends on", () => {
    expect(() =>
      assertX402ChallengeHeaderMatchesContract(
        contract,
        "X-RENAMED-PAYMENT-REQUIRED",
        btoa(JSON.stringify({ x402Version: 2, accepts: [] })),
      ),
    ).toThrow(SdkGatewayContractMismatchError);
  });
});
