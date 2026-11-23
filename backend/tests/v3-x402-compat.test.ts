import express from 'express';
import request from 'supertest';
import { createPublicKey, verify } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createV3GatewayRouter } from '../src/routes/v3/gateway';
import { receiptService } from '../src/v3/receipt-runtime';
import { spendCapService } from '../src/services/v3/spend-cap-service';
import {
  challengeNonceStore,
  defaultChannelStateStore,
} from '../src/services/v3/payment-challenge-service';
import { meterReservationTracker } from '../src/services/v3/gateway-lifecycle';

const originalContract = process.env.SOROBAN_CONTRACT_ADDRESS;
const originalNetwork = process.env.STELLAR_NETWORK;
const originalX402 = process.env.X402_COMPATIBILITY_ENABLED;

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
    .join(',')}}`;
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v3/gateway', createV3GatewayRouter());
  return app;
}

function decodePaymentRequired(header: string): any {
  return JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
}

beforeEach(() => {
  challengeNonceStore.clear();
  defaultChannelStateStore.clear();
  spendCapService.clear();
  meterReservationTracker.clear();
  process.env.SOROBAN_CONTRACT_ADDRESS = 'C_CONFIGURED_CONTRACT';
  process.env.STELLAR_NETWORK = 'testnet';
  process.env.X402_COMPATIBILITY_ENABLED = 'true';
});

afterEach(() => {
  if (originalContract === undefined) delete process.env.SOROBAN_CONTRACT_ADDRESS;
  else process.env.SOROBAN_CONTRACT_ADDRESS = originalContract;
  if (originalNetwork === undefined) delete process.env.STELLAR_NETWORK;
  else process.env.STELLAR_NETWORK = originalNetwork;
  if (originalX402 === undefined) delete process.env.X402_COMPATIBILITY_ENABLED;
  else process.env.X402_COMPATIBILITY_ENABLED = originalX402;
});

describe('x402 compatibility mode (#1822)', () => {
  it('advertises a signed x402 PaymentRequired with the SYNCRO challenge embedded', async () => {
    const response = await request(createApp()).get('/api/v3/gateway/challenge?routeId=inference');

    expect(response.status).toBe(402);
    const paymentRequired = decodePaymentRequired(response.headers['payment-required']);

    expect(paymentRequired.x402Version).toBe(2);
    expect(paymentRequired.accepts).toHaveLength(1);

    const requirement = paymentRequired.accepts[0];
    expect(requirement.scheme).toBe('exact');
    expect(requirement.network).toBe('stellar:testnet');
    expect(requirement.asset).toBe(
      'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    );
    expect(requirement.payTo).toBe(paymentRequired.syncro.channelAddress);
    expect(requirement.amount).toBe('10');
    expect(requirement.maxTimeoutSeconds).toBeGreaterThan(0);
    expect(requirement.extra.syncroScheme).toBe('channel-state');

    // The native challenge is embedded so SYNCRO-aware clients can settle it.
    expect(paymentRequired.syncro.scheme).toBe('channel-state');
    expect(paymentRequired.syncro.nonce).toBeTruthy();
    expect(response.body.challenge).toEqual(paymentRequired.syncro);

    // The x402 object is signed by the gateway over its canonical form.
    const { signature, ...unsigned } = paymentRequired;
    const publicKey = receiptService.getReceiptPublicKeys()[0]!.publicKeyPem;
    expect(
      verify(
        null,
        Buffer.from(canonicalize(unsigned)),
        createPublicKey(publicKey),
        Buffer.from(signature, 'base64'),
      ),
    ).toBe(true);
  });

  it('lets a reference x402 client pay a SYNCRO route in compatibility mode on testnet', async () => {
    const agentId = 'agent_x402_client';
    spendCapService.setCap({
      cardId: 1,
      agentId,
      onChainCap: 500,
      consumedLocal: 0,
      lastSettledOnChainCap: 500,
      dailyLimit: 0,
      monthlyLimit: 0,
      status: 'active',
      expiresAt: 0,
    });

    const app = createApp();

    // 1. Client calls the route, receives 402 with an x402 challenge.
    const challengeResponse = await request(app)
      .post('/api/v3/gateway/inference')
      .set('Authorization', `Bearer ${agentId}`)
      .send({ prompt: 'hello' });
    expect(challengeResponse.status).toBe(402);

    const paymentRequired = decodePaymentRequired(challengeResponse.headers['payment-required']);
    const accepted = paymentRequired.accepts[0];

    // 2. Client builds an x402 PaymentPayload whose payload carries the SYNCRO
    //    channel-state proof for the advertised challenge.
    const proof = {
      channelId: 'chan_x402',
      sequenceNumber: 1,
      userBalance: 100,
      executorBalance: 0,
      totalDeposited: 100,
      nonce: paymentRequired.syncro.nonce,
      payerAddress: 'G_PAYER_X402',
      signature: 'mock_valid_signature',
    };
    const paymentPayload = {
      x402Version: 2,
      accepted,
      payload: proof,
    };
    const paymentSignature = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

    // 3. Client retries with PAYMENT-SIGNATURE.
    const paidResponse = await request(app)
      .post('/api/v3/gateway/inference')
      .set('Authorization', `Bearer ${agentId}`)
      .set('PAYMENT-SIGNATURE', paymentSignature)
      .send({ prompt: 'hello' });

    expect(paidResponse.status).toBe(200);
    expect(paidResponse.body.receipt).toBeDefined();

    // 4. Settlement is reported in the x402 shape.
    const settlement = JSON.parse(
      Buffer.from(paidResponse.headers['payment-response'], 'base64').toString('utf8'),
    );
    expect(settlement.success).toBe(true);
    expect(settlement.network).toBe('stellar:testnet');
    expect(settlement.transaction).toBe(paidResponse.body.receipt.receiptId);
  });

  it('keeps the SYNCRO-native challenge when compatibility mode is disabled', async () => {
    process.env.X402_COMPATIBILITY_ENABLED = 'false';
    const response = await request(createApp()).get('/api/v3/gateway/challenge?routeId=inference');

    expect(response.status).toBe(402);
    const headerChallenge = decodePaymentRequired(response.headers['payment-required']);
    // Native shape: the challenge itself, not an x402 PaymentRequired wrapper.
    expect(headerChallenge.scheme).toBe('channel-state');
    expect(headerChallenge.accepts).toBeUndefined();
    expect(headerChallenge).toEqual(response.body.challenge);
  });
});
