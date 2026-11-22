import { describe, expect, it } from 'vitest';
import gatewayTaxonomy from '../src/errors/gateway-taxonomy.json';
import {
  sendGatewayError,
  taxonomyEntry,
  toPublicGatewayError,
} from '../src/errors/gateway-error-response';
import {
  generatePaymentChallenge,
  parsePaymentChallenge,
  parsePaymentProof,
  serialisePaymentProof,
} from '../src/services/v3/payment-challenge-service';
import {
  MeterDegradedError,
  MeterInsufficientFundsError,
  MeterRateLimitedError,
  PaidCallRequestError,
  ScopeRejectionError,
  UpstreamUnavailableError,
} from '../src/v3/types';
import {
  GatewayClient,
  createGatewayErrorFromCode,
  createPaidFetch,
  getGatewayRetrySemantics,
  isGatewayErrorCode,
  parsePaymentRequiredHeader,
  serialisePaymentRequiredHeader,
  serialisePaymentResponseHeader,
} from '../../sdk/src/v3/index';
import {
  SdkGatewayContractMismatchError,
  assertErrorResponseMatchesContract,
  assertGatewayChallengeResponseMatchesContract,
  assertGatewayTaxonomyAlignedWithContract,
  assertX402ChallengeHeaderMatchesContract,
  loadSdkGatewayContract,
} from '../../shared/src/testing/sdk-gateway-contract-verifier';
import { generateKeyPairSync, sign as signEd25519 } from 'node:crypto';

function createMockExpressResponse() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let jsonBody: Record<string, unknown> = {};

  const res = {
    setHeader(name: string, value: string) {
      headers[name] = value;
      return res;
    },
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(body: Record<string, unknown>) {
      jsonBody = body;
      return res;
    },
  };

  return {
    res: res as any,
    snapshot: () => ({ status: statusCode, headers, body: jsonBody }),
  };
}

describe('Issue #1872: Consumer-driven contract tests between the SDK and the Gateway', () => {
  const contract = loadSdkGatewayContract();

  it('verifies the gateway error taxonomy (#1493) matches the SDK consumer contract 1:1', () => {
    assertGatewayTaxonomyAlignedWithContract(contract, gatewayTaxonomy.errors);

    for (const entry of contract.errorTaxonomy) {
      expect(isGatewayErrorCode(entry.code)).toBe(true);
      const gwEntry = taxonomyEntry(entry.code);
      expect(gwEntry.httpStatus).toBe(entry.httpStatus);
      expect(gwEntry.action).toBe(entry.action);
      expect(gwEntry.retryable).toBe(entry.retryable);
      expect(gwEntry.supportsRetryAfterHeader).toBe(entry.supportsRetryAfterHeader);
      expect(gwEntry.defaultMessage).toBe(entry.defaultMessage);

      const sdkErr = createGatewayErrorFromCode(entry.code);
      expect(sdkErr.code).toBe(entry.code);
      expect(sdkErr.status).toBe(entry.httpStatus);
      expect(sdkErr.action).toBe(entry.action);
      expect(sdkErr.retryable).toBe(entry.retryable);

      const retrySemantics = getGatewayRetrySemantics(entry.code);
      expect(retrySemantics.retryable).toBe(entry.retryable);
      expect(retrySemantics.supportsRetryAfter).toBe(entry.supportsRetryAfterHeader);
    }
  });

  it('verifies gateway 402 PAYMENT-REQUIRED challenge response satisfies the SDK contract', () => {
    const gatewayKeys = generateKeyPairSync('ed25519');
    const { challenge, headerValue } = generatePaymentChallenge(
      {
        settlementAsset: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        amount: '10',
        rate: '0.1',
        contract: 'C_CONTRACT_V3',
        chain: 'stellar:testnet',
      },
      (canonical) => signEd25519(null, Buffer.from(canonical), gatewayKeys.privateKey).toString('base64'),
    );

    const response = {
      status: 402,
      headers: {
        [contract.headers.paymentRequired]: headerValue,
      },
      body: {
        error: 'Payment required: machine-readable payment instruction challenge',
        challenge,
      },
    };

    assertGatewayChallengeResponseMatchesContract(contract, response);

    // Verify SDK parser directly accepts the gateway's PAYMENT-REQUIRED header
    const parsedByGateway = parsePaymentChallenge(headerValue);
    const parsedBySdk = parsePaymentRequiredHeader(headerValue);
    expect(parsedByGateway).toEqual(challenge);
    expect(parsedBySdk).toEqual(challenge);
  });

  it('verifies x402 v2 PAYMENT-REQUIRED -> PAYMENT-SIGNATURE -> PAYMENT-RESPONSE full SDK-Gateway interaction contract', async () => {
    const gatewayKeys = generateKeyPairSync('ed25519');
    const gatewayPublicKey = gatewayKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString();

    const unsignedX402 = {
      x402Version: 2,
      accepts: [
        {
          scheme: 'exact',
          network: 'stellar:testnet',
          amount: '100',
          asset: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          payTo: 'G_PROVIDER_PAYOUT',
          maxTimeoutSeconds: 60,
        },
      ],
    };
    const canonicalUnsigned = JSON.stringify({
      accepts: [
        {
          amount: '100',
          asset: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          maxTimeoutSeconds: 60,
          network: 'stellar:testnet',
          payTo: 'G_PROVIDER_PAYOUT',
          scheme: 'exact',
        },
      ],
      x402Version: 2,
    });
    const signedX402 = {
      ...unsignedX402,
      signature: signEd25519(null, Buffer.from(canonicalUnsigned), gatewayKeys.privateKey).toString('base64'),
    };
    const paymentRequiredHeader = serialisePaymentRequiredHeader(signedX402);

    assertX402ChallengeHeaderMatchesContract(
      contract,
      contract.headers.paymentRequired,
      paymentRequiredHeader,
    );

    let callIndex = 0;
    const paidFetch = createPaidFetch({
      gatewayPublicKey,
      sign: (payload) => `sig_${Buffer.from(payload).toString('hex').slice(0, 32)}`,
      fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        callIndex++;
        if (callIndex === 1) {
          return new Response(
            JSON.stringify({ code: 'GATEWAY_PAYMENT_REQUIRED', message: 'Valid payment authorization is required.' }),
            {
              status: 402,
              headers: {
                'content-type': 'application/json',
                [contract.headers.paymentRequired]: paymentRequiredHeader,
              },
            },
          );
        }
        const retryHeaders = new Headers(init?.headers);
        const sigHeader = retryHeaders.get(contract.headers.paymentSignature);
        expect(sigHeader).toBeTruthy();

        const settlementHeader = serialisePaymentResponseHeader({
          success: true,
          transaction: 'tx_stellar_settled_001',
          network: 'stellar:testnet',
        });

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            [contract.headers.paymentResponse]: settlementHeader,
          },
        });
      }) as typeof fetch,
    });

    const res = await paidFetch('https://gateway.syncro.test/api/v3/gateway/proxy', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(res.receipt).toEqual({
      success: true,
      transaction: 'tx_stellar_settled_001',
      network: 'stellar:testnet',
    });
  });

  it('verifies all reachable gateway error responses conform to errorBodyContract and are parsed by SDK GatewayClient', async () => {
    const domainErrorCases: Array<{ code: string; error: unknown }> = [
      { code: 'GATEWAY_SCOPE_DENIED', error: new ScopeRejectionError('missing_scope', 'missing scope llm:call') },
      { code: 'GATEWAY_GRANT_EXPIRED', error: new ScopeRejectionError('grant_expired', 'grant expired') },
      { code: 'GATEWAY_KEY_REVOKED', error: new ScopeRejectionError('grant_revoked', 'grant revoked') },
      { code: 'GATEWAY_METER_DEGRADED', error: new MeterDegradedError('provider_1', 'counter_store_down') },
      { code: 'GATEWAY_RATE_LIMITED', error: new MeterRateLimitedError('agent_1', 'POST:/v1/chat', 2500) },
      {
        code: 'GATEWAY_METER_INSUFFICIENT',
        error: new MeterInsufficientFundsError('agent_1', 'POST:/v1/chat', 5, 20, 100),
      },
      { code: 'GATEWAY_UPSTREAM_UNAVAILABLE', error: new UpstreamUnavailableError('upstream timeout') },
      { code: 'GATEWAY_BAD_REQUEST', error: new PaidCallRequestError('route not found') },
      { code: 'GATEWAY_INTERNAL', error: new Error('unexpected internal db error') },
    ];

    for (const testCase of domainErrorCases) {
      const mock = createMockExpressResponse();
      sendGatewayError(mock.res, testCase.error);
      const snap = mock.snapshot();

      assertErrorResponseMatchesContract(contract, testCase.code, snap);

      // Feed the gateway's exact response into the SDK GatewayClient and confirm
      // it deserializes into the exact typed GatewaySdkError class!
      const client = new GatewayClient({
        retryPolicy: {
          maxAttempts: 1,
          baseDelayMs: 1,
          maxDelayMs: 1,
          jitterRatio: 0,
          maxTotalDurationMs: 10,
        },
        fetchImpl: (async () =>
          new Response(JSON.stringify(snap.body), {
            status: snap.status,
            headers: {
              'content-type': 'application/json',
              ...snap.headers,
            },
          })) as typeof fetch,
      });

      await expect(
        client.logicalCallJson('https://gateway.syncro.test/api/v3/gateway/paid', { method: 'POST' }),
      ).rejects.toMatchObject({
        code: testCase.code,
        status: snap.status,
      });
    }

    // Also verify all 15 taxonomy entries synthesized as gateway responses
    for (const entry of contract.errorTaxonomy) {
      const syntheticResponse = {
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
          ...(entry.retryAfterSeconds !== undefined ? { retryAfterSeconds: entry.retryAfterSeconds } : {}),
        },
      };
      assertErrorResponseMatchesContract(contract, entry.code, syntheticResponse);
    }
  });

  it('fails contract verification when the gateway renames a header or changes a field the SDK depends on', () => {
    const validProofHeader = serialisePaymentProof({
      channelId: 'chan_1',
      sequenceNumber: 1,
      userBalance: 100,
      executorBalance: 0,
      totalDeposited: 100,
      nonce: 'n_1',
      signature: 'sig_valid_1',
      payerAddress: 'G_PAYER',
    });
    expect(parsePaymentProof(validProofHeader)).not.toBeNull();

    const { challenge, headerValue } = generatePaymentChallenge(
      {
        settlementAsset: 'USDC:STELLAR',
        amount: '10',
        rate: '1',
        contract: 'C_1',
        chain: 'stellar:testnet',
      },
      () => 'sig_test',
    );

    // 1. Header rename drift: PAYMENT-REQUIRED -> X-PAYMENT-REQUIRED
    expect(() =>
      assertGatewayChallengeResponseMatchesContract(contract, {
        status: 402,
        headers: { 'X-PAYMENT-REQUIRED': headerValue },
        body: { error: 'Payment required', challenge },
      }),
    ).toThrow(SdkGatewayContractMismatchError);

    // 2. Challenge field rename drift: settlementAsset -> asset
    const driftedChallenge = { ...challenge } as Record<string, unknown>;
    delete driftedChallenge.settlementAsset;
    driftedChallenge.asset = 'USDC:STELLAR';
    expect(() =>
      assertGatewayChallengeResponseMatchesContract(contract, {
        status: 402,
        headers: {
          [contract.headers.paymentRequired]: Buffer.from(JSON.stringify(driftedChallenge)).toString('base64'),
        },
        body: { error: 'Payment required', challenge: driftedChallenge },
      }),
    ).toThrow(SdkGatewayContractMismatchError);

    // 3. Error body field rename drift: code -> errorCode
    const publicError = toPublicGatewayError(new PaidCallRequestError('bad'));
    const driftedErrorBody: Record<string, unknown> = {
      errorCode: publicError.code,
      message: publicError.message,
      action: publicError.action,
      retryable: publicError.retryable,
    };
    expect(() =>
      assertErrorResponseMatchesContract(contract, 'GATEWAY_BAD_REQUEST', {
        status: 400,
        headers: {},
        body: driftedErrorBody,
      }),
    ).toThrow(SdkGatewayContractMismatchError);

    // 4. Missing Retry-After header when retryAfterSeconds is present
    expect(() =>
      assertErrorResponseMatchesContract(contract, 'GATEWAY_RATE_LIMITED', {
        status: 429,
        headers: {},
        body: {
          code: 'GATEWAY_RATE_LIMITED',
          message: 'Gateway rate limit exceeded.',
          action: 'wait',
          retryable: true,
          retryAfterSeconds: 2,
        },
      }),
    ).toThrow(SdkGatewayContractMismatchError);
  });
});
