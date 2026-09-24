import request from 'supertest';
import express from 'express';
import { createV3GatewayRouter } from '../src/routes/v3/gateway';
import {
  generatePaymentChallenge,
  parsePaymentProof,
  verifyPaymentProof,
  challengeNonceStore,
  defaultChannelStateStore,
} from '../src/services/v3/payment-challenge-service';
import { spendCapService } from '../src/services/v3/spend-cap-service';
import { unitEconomicsService } from '../src/services/v3/unit-economics-service';
import { meterReservationTracker } from '../src/services/v3/gateway-lifecycle';
import crypto from 'crypto';

describe('V3 Gateway & Ops Tests', () => {
  let app: express.Express;

  beforeEach(() => {
    challengeNonceStore.clear();
    defaultChannelStateStore.clear();
    spendCapService.clear();
    unitEconomicsService.clear();
    meterReservationTracker.clear();

    app = express();
    app.use(express.json());
    app.use('/api/v3/gateway', createV3GatewayRouter());
  });

  describe('Issue #1466: HTTP 402 challenge and payment-proof verification', () => {
    it('returns 402 Payment Required with machine-readable challenge on unfunded/unauthenticated request', async () => {
      const res = await request(app).post('/api/v3/gateway/proxy').send({ input: 'test prompt' });
      expect(res.status).toBe(402);
      expect(res.headers['payment-required']).toBeDefined();
      expect(res.body.challenge).toBeDefined();
      expect(res.body.challenge.settlementAsset).toBeDefined();
      expect(res.body.challenge.channelAddress).toBeDefined();
      expect(res.body.challenge.contract).toBeDefined();
      expect(res.body.challenge.chain).toBeDefined();
      expect(res.body.challenge.nonce).toBeDefined();
    });

    it('rejects a replayed proof with distinct REPLAYED_PROOF code', async () => {
      const agentId = 'agent_test_key_123';
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

      defaultChannelStateStore.setChannelMembers('chan_1', { payer: 'G_PAYER', provider: 'G_PROVIDER' });
      defaultChannelStateStore.setLatestSequence('chan_1', 1);

      const proof = {
        channelId: 'chan_1',
        sequenceNumber: 2,
        userBalance: 100,
        executorBalance: 50,
        totalDeposited: 150,
        nonce: 'replayed_nonce_123',
        signature: 'mock_valid_signature',
        payerAddress: 'G_PAYER',
      };

      const proofHeader = Buffer.from(JSON.stringify(proof)).toString('base64');

      // First call succeeds
      const res1 = await request(app)
        .post('/api/v3/gateway/proxy')
        .set('Authorization', `Bearer ${agentId}`)
        .set('PAYMENT-SIGNATURE', proofHeader)
        .send({ prompt: 'test' });

      expect(res1.status).toBe(200);

      // Second call with same nonce fails with replay rejection
      const res2 = await request(app)
        .post('/api/v3/gateway/proxy')
        .set('Authorization', `Bearer ${agentId}`)
        .set('PAYMENT-SIGNATURE', proofHeader)
        .send({ prompt: 'test' });

      expect(res2.status).toBe(402);
      expect(res2.body.code).toBe('REPLAYED_PROOF');
    });

    it('distinguishes insufficient balance from replayed proof', async () => {
      const agentId = 'agent_test_key_123';
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

      defaultChannelStateStore.setChannelMembers('chan_2', { payer: 'G_PAYER', provider: 'G_PROVIDER' });
      defaultChannelStateStore.setLatestSequence('chan_2', 1);

      const proofInsufficient = {
        channelId: 'chan_2',
        sequenceNumber: 2,
        userBalance: 2, // upper bound is 10
        executorBalance: 50,
        totalDeposited: 150,
        nonce: 'fresh_nonce_456',
        signature: 'mock_valid_signature',
        payerAddress: 'G_PAYER',
      };

      const proofHeader = Buffer.from(JSON.stringify(proofInsufficient)).toString('base64');

      const res = await request(app)
        .post('/api/v3/gateway/proxy')
        .set('Authorization', `Bearer ${agentId}`)
        .set('PAYMENT-SIGNATURE', proofHeader)
        .send({ prompt: 'test' });

      expect(res.status).toBe(402);
      expect(res.body.code).toBe('INSUFFICIENT_BALANCE');
    });
  });

  describe('Issue #1465: Paid-request gateway skeleton and request lifecycle', () => {
    it('executes full ordered lifecycle end-to-end and attaches receipt', async () => {
      const agentId = 'agent_lifecycle_ok';
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

      defaultChannelStateStore.setChannelMembers('chan_lc', { payer: 'G_PAYER', provider: 'G_PROVIDER' });
      defaultChannelStateStore.setLatestSequence('chan_lc', 0);

      const proof = {
        channelId: 'chan_lc',
        sequenceNumber: 1,
        userBalance: 200,
        executorBalance: 0,
        totalDeposited: 200,
        nonce: 'nonce_lifecycle_1',
        signature: 'mock_valid_signature',
        payerAddress: 'G_PAYER',
      };

      const proofHeader = Buffer.from(JSON.stringify(proof)).toString('base64');

      const res = await request(app)
        .post('/api/v3/gateway/proxy')
        .set('Authorization', `Bearer ${agentId}`)
        .set('PAYMENT-SIGNATURE', proofHeader)
        .send({ prompt: 'hello agent' });

      expect(res.status).toBe(200);
      expect(res.body.receipt).toBeDefined();
      expect(res.body.receipt.cost).toBe(8); // committed actual price
      expect(res.headers['payment-response']).toBeDefined();
      expect(meterReservationTracker.getStrandedCount()).toBe(0);
    });

    it('guarantees reservation release when upstream throws an error (no stranded reservations)', async () => {
      const agentId = 'agent_lifecycle_err';
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

      defaultChannelStateStore.setChannelMembers('chan_err', { payer: 'G_PAYER', provider: 'G_PROVIDER' });
      defaultChannelStateStore.setLatestSequence('chan_err', 0);

      const proof = {
        channelId: 'chan_err',
        sequenceNumber: 1,
        userBalance: 200,
        executorBalance: 0,
        totalDeposited: 200,
        nonce: 'nonce_err_1',
        signature: 'mock_valid_signature',
        payerAddress: 'G_PAYER',
      };

      const proofHeader = Buffer.from(JSON.stringify(proof)).toString('base64');

      const res = await request(app)
        .post('/api/v3/gateway/proxy')
        .set('Authorization', `Bearer ${agentId}`)
        .set('PAYMENT-SIGNATURE', proofHeader)
        .send({ prompt: 'hello agent', simulateUpstreamError: true });

      expect(res.status).toBe(502);
      expect(meterReservationTracker.getStrandedCount()).toBe(0);
    });
  });

  describe('Issue #1469: Cap admission via the on-chain spend-cap contract', () => {
    it('rejects call exceeding cap before proxying with remaining allowance and needed amount', async () => {
      const agentId = 'agent_capped_low';
      spendCapService.setCap({
        cardId: 2,
        agentId,
        onChainCap: 5, // priced upper bound is 10
        consumedLocal: 0,
        lastSettledOnChainCap: 5,
        dailyLimit: 0,
        monthlyLimit: 0,
        status: 'active',
        expiresAt: 0,
      });

      const res = await request(app)
        .post('/api/v3/gateway/proxy')
        .set('Authorization', `Bearer ${agentId}`)
        .send({ prompt: 'hello' });

      expect(res.status).toBe(402);
      expect(res.body.error).toBe('Spend cap admission failed');
      expect(res.body.remainingAllowance).toBe(5);
      expect(res.body.requiredAmount).toBe(10);
      expect(res.body.reason).toContain('remaining allowance is only 5');
    });

    it('tracks consumption locally and reconciles local vs chain view after settlement', () => {
      const agentId = 'agent_reconcile';
      spendCapService.setCap({
        cardId: 3,
        agentId,
        onChainCap: 100,
        consumedLocal: 0,
        lastSettledOnChainCap: 100,
        dailyLimit: 0,
        monthlyLimit: 0,
        status: 'active',
        expiresAt: 0,
      });

      // 3 calls consume 8 each locally
      spendCapService.consumeLocal(agentId, 8);
      spendCapService.consumeLocal(agentId, 8);
      spendCapService.consumeLocal(agentId, 8);

      let cap = spendCapService.getCap(agentId)!;
      expect(cap.consumedLocal).toBe(24);

      // Now on-chain settlement happens: 24 settled, onChainCap decrements to 76
      spendCapService.reconcileSettlement(agentId, 76, 24);

      cap = spendCapService.getCap(agentId)!;
      expect(cap.onChainCap).toBe(76);
      expect(cap.consumedLocal).toBe(0);
      expect(spendCapService.canTransact(agentId, 10).remainingAllowance).toBe(76);
    });
  });

  describe('Issue #1522: Cost model and unit economics instrumentation', () => {
    it('instruments cost per call, detects negative unit economics, and derives batching policy defaults', () => {
      const providerId = 'provider_llm_alpha';

      unitEconomicsService.recordChannel({
        channelId: 'chan_eco_1',
        providerId,
        channelSize: 1000,
        chainFeePerSettlement: 50,
        infrastructureCostPerCall: 0.5,
        providerPayoutRate: 2.0,
        settledCallsCount: 0,
        totalRevenue: 0,
      });

      // Batch 1: 5 calls, chain fee 50, revenue 5 * 2.5 = 12.5
      // Cost per call = (50 / 5) + 0.5 + 2.0 = 12.5. Net margin = 0.
      unitEconomicsService.recordSettledBatch('chan_eco_1', 5, 50, 12.5);

      // Batch 2: bad pricing leads to negative economics alert
      unitEconomicsService.recordSettledBatch('chan_eco_1', 2, 50, 2.0);
      const alerts = unitEconomicsService.getAlerts();
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0].reason).toContain('Negative unit economics detected');

      // Derive policy for target price = 10 per call
      const policy = unitEconomicsService.deriveBatchingPolicy(providerId, 10);
      expect(policy.optimalBatchThreshold).toBeGreaterThanOrEqual(1);
      expect(policy.minimumViableChannelSize).toBeGreaterThan(0);
    });

    it('exposes economics endpoint via router', async () => {
      unitEconomicsService.recordChannel({
        channelId: 'chan_eco_2',
        providerId: 'provider_test',
        channelSize: 500,
        chainFeePerSettlement: 30,
        infrastructureCostPerCall: 0.2,
        providerPayoutRate: 1.0,
        settledCallsCount: 10,
        totalRevenue: 30,
      });

      const res = await request(app).get('/api/v3/gateway/economics/provider_test?targetPrice=5');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.recommendation).toBeDefined();
      expect(res.body.data.recommendation.optimalBatchThreshold).toBeDefined();
    });
  });
});
