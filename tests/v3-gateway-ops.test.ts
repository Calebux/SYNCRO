import { describe, it, expect, beforeEach } from 'vitest';
import {
  generatePaymentChallenge,
  parsePaymentProof,
  verifyPaymentProof,
  challengeNonceStore,
  defaultChannelStateStore,
} from '../backend/src/services/v3/payment-challenge-service';
import { spendCapService } from '../backend/src/services/v3/spend-cap-service';
import { unitEconomicsService } from '../backend/src/services/v3/unit-economics-service';
import { meterReservationTracker } from '../backend/src/services/v3/gateway-lifecycle';

describe('V3 Gateway, 402 Challenges, Cap Admission & Unit Economics', () => {
  beforeEach(() => {
    challengeNonceStore.clear();
    defaultChannelStateStore.clear();
    spendCapService.clear();
    unitEconomicsService.clear();
    meterReservationTracker.clear();
  });

  describe('Issue #1466: HTTP 402 challenge and payment-proof verification', () => {
    it('generates machine-readable 402 challenge with settlement asset, rate, contract, chain, and nonce', () => {
      const { challenge, headerValue } = generatePaymentChallenge({
        settlementAsset: 'USDC:STELLAR',
        amount: '10',
        rate: '10',
        channelAddress: 'G_PROVIDER_CHANNEL',
        contract: 'CA_V3_CHANNEL',
        chain: 'stellar:testnet',
        ttlSeconds: 120,
      });

      expect(challenge.scheme).toBe('channel-state');
      expect(challenge.chain).toBe('stellar:testnet');
      expect(challenge.contract).toBe('CA_V3_CHANNEL');
      expect(challenge.channelAddress).toBe('G_PROVIDER_CHANNEL');
      expect(challenge.settlementAsset).toBe('USDC:STELLAR');
      expect(challenge.amount).toBe('10');
      expect(challenge.nonce).toMatch(/^ch_nonce_/);
      expect(challenge.expiresAt).toBeDefined();

      const decoded = JSON.parse(Buffer.from(headerValue, 'base64').toString('utf8'));
      expect(decoded.nonce).toBe(challenge.nonce);
    });

    it('accepts and verifies valid client payment proof', () => {
      defaultChannelStateStore.setChannelMembers('chan_100', { payer: 'G_PAYER_1', provider: 'G_PROVIDER' });
      defaultChannelStateStore.setLatestSequence('chan_100', 0);

      const proof = {
        channelId: 'chan_100',
        sequenceNumber: 1,
        userBalance: 50,
        executorBalance: 0,
        totalDeposited: 50,
        nonce: 'nonce_unique_1',
        signature: 'mock_valid_signature',
        payerAddress: 'G_PAYER_1',
      };

      const result = verifyPaymentProof(proof, 10);
      expect(result.valid).toBe(true);
      expect(defaultChannelStateStore.getLatestSequence('chan_100')).toBe(1);
    });

    it('rejects a replayed proof with distinct error code', () => {
      defaultChannelStateStore.setChannelMembers('chan_101', { payer: 'G_PAYER_1', provider: 'G_PROVIDER' });
      defaultChannelStateStore.setLatestSequence('chan_101', 0);

      const proof = {
        channelId: 'chan_101',
        sequenceNumber: 1,
        userBalance: 50,
        executorBalance: 0,
        totalDeposited: 50,
        nonce: 'nonce_replay_attack',
        signature: 'mock_valid_signature',
        payerAddress: 'G_PAYER_1',
      };

      const res1 = verifyPaymentProof(proof, 10);
      expect(res1.valid).toBe(true);

      const res2 = verifyPaymentProof(proof, 10);
      expect(res2.valid).toBe(false);
      expect(res2.code).toBe('REPLAYED_PROOF');
      expect(res2.error).toContain('replayed nonce');
    });

    it('rejects insufficient balance distinguishing it from replay', () => {
      defaultChannelStateStore.setChannelMembers('chan_102', { payer: 'G_PAYER_1', provider: 'G_PROVIDER' });
      defaultChannelStateStore.setLatestSequence('chan_102', 0);

      const proof = {
        channelId: 'chan_102',
        sequenceNumber: 1,
        userBalance: 5, // needs 10
        executorBalance: 0,
        totalDeposited: 50,
        nonce: 'nonce_fresh_2',
        signature: 'mock_valid_signature',
        payerAddress: 'G_PAYER_1',
      };

      const res = verifyPaymentProof(proof, 10);
      expect(res.valid).toBe(false);
      expect(res.code).toBe('INSUFFICIENT_BALANCE');
      expect(res.details?.userBalance).toBe(5);
    });

    it('rejects non-monotonic sequence numbers', () => {
      defaultChannelStateStore.setChannelMembers('chan_103', { payer: 'G_PAYER_1', provider: 'G_PROVIDER' });
      defaultChannelStateStore.setLatestSequence('chan_103', 5);

      const proof = {
        channelId: 'chan_103',
        sequenceNumber: 4, // stale
        userBalance: 50,
        executorBalance: 0,
        totalDeposited: 50,
        nonce: 'nonce_stale_seq',
        signature: 'mock_valid_signature',
        payerAddress: 'G_PAYER_1',
      };

      const res = verifyPaymentProof(proof, 10);
      expect(res.valid).toBe(false);
      expect(res.code).toBe('NONCE_NOT_MONOTONIC');
    });

    it('rejects unauthorized non-member payers', () => {
      defaultChannelStateStore.setChannelMembers('chan_104', { payer: 'G_PAYER_LEGIT', provider: 'G_PROVIDER' });
      defaultChannelStateStore.setLatestSequence('chan_104', 0);

      const proof = {
        channelId: 'chan_104',
        sequenceNumber: 1,
        userBalance: 50,
        executorBalance: 0,
        totalDeposited: 50,
        nonce: 'nonce_attacker',
        signature: 'mock_valid_signature',
        payerAddress: 'G_ATTACKER',
      };

      const res = verifyPaymentProof(proof, 10);
      expect(res.valid).toBe(false);
      expect(res.code).toBe('NOT_A_MEMBER');
    });

    it('rejects a captured proof replayed against a different request (request binding)', () => {
      defaultChannelStateStore.setChannelMembers('chan_105', { payer: 'G_PAYER_1', provider: 'G_PROVIDER' });
      defaultChannelStateStore.setLatestSequence('chan_105', 0);

      const requestHash1 = '1111111111111111111111111111111111111111111111111111111111111111';
      const requestHash2 = '2222222222222222222222222222222222222222222222222222222222222222';

      const proof = {
        channelId: 'chan_105',
        sequenceNumber: 1,
        userBalance: 50,
        executorBalance: 0,
        totalDeposited: 50,
        nonce: 'nonce_request_bind_1',
        signature: 'mock_valid_signature',
        payerAddress: 'G_PAYER_1',
        requestHash: requestHash1,
      };

      // Valid when requestHash matches
      const res1 = verifyPaymentProof(proof, 10, { expectedRequestHash: requestHash1 });
      expect(res1.valid).toBe(true);

      // Replaying the proof against a different request must be rejected
      const res2 = verifyPaymentProof(proof, 10, { expectedRequestHash: requestHash2 });
      expect(res2.valid).toBe(false);
      expect(res2.code).toBe('REPLAYED_PROOF');
      expect(res2.error).toContain('cross-request replay rejected');
    });

    it('rejects proofs outside the freshness window', () => {
      defaultChannelStateStore.setChannelMembers('chan_106', { payer: 'G_PAYER_1', provider: 'G_PROVIDER' });
      defaultChannelStateStore.setLatestSequence('chan_106', 0);

      const now = Date.now();
      const staleTimestamp = now - (10 * 60 * 1000); // 10 minutes ago (beyond 5 min window)

      const proof = {
        channelId: 'chan_106',
        sequenceNumber: 1,
        userBalance: 50,
        executorBalance: 0,
        totalDeposited: 50,
        nonce: 'nonce_freshness_test',
        signature: 'mock_valid_signature',
        payerAddress: 'G_PAYER_1',
        timestamp: staleTimestamp,
      };

      const res = verifyPaymentProof(proof, 10, { nowMs: now });
      expect(res.valid).toBe(false);
      expect(res.code).toBe('EXPIRED_PROOF');
      expect(res.error).toContain('freshness window');
    });
  });

  describe('Issue #1465: Paid-request gateway skeleton and request lifecycle', () => {
    it('manages meter reservation lifecycle without leaving stranded reservations on commit or failure', () => {
      const resId1 = meterReservationTracker.reserve('agent_alpha', '/v3/inference', 10);
      expect(meterReservationTracker.get(resId1)?.status).toBe('reserved');
      expect(meterReservationTracker.getStrandedCount()).toBe(1);

      // Commit actual usage
      meterReservationTracker.commit(resId1, 8);
      expect(meterReservationTracker.get(resId1)?.status).toBe('committed');
      expect(meterReservationTracker.getStrandedCount()).toBe(0);

      // On failure or exception path: reservation is released
      const resId2 = meterReservationTracker.reserve('agent_beta', '/v3/inference', 10);
      expect(meterReservationTracker.getStrandedCount()).toBe(1);
      meterReservationTracker.release(resId2, 'Upstream exception / network abort');
      expect(meterReservationTracker.get(resId2)?.status).toBe('released');
      expect(meterReservationTracker.getStrandedCount()).toBe(0);
    });
  });

  describe('Issue #1469: Cap admission via the on-chain spend-cap contract', () => {
    it('enforces spend cap check at admission and provides remaining allowance in rejection', () => {
      spendCapService.setCap({
        cardId: 10,
        agentId: 'agent_cap_test',
        onChainCap: 25,
        consumedLocal: 0,
        lastSettledOnChainCap: 25,
        dailyLimit: 0,
        monthlyLimit: 0,
        status: 'active',
        expiresAt: 0,
      });

      // Allowed under cap
      const check1 = spendCapService.canTransact('agent_cap_test', 20);
      expect(check1.canTransact).toBe(true);
      expect(check1.remainingAllowance).toBe(25);

      // Consume locally
      spendCapService.consumeLocal('agent_cap_test', 20);

      // Rejected when exceeding remaining cap
      const check2 = spendCapService.canTransact('agent_cap_test', 10);
      expect(check2.canTransact).toBe(false);
      expect(check2.remainingAllowance).toBe(5);
      expect(check2.requiredAmount).toBe(10);
      expect(check2.reason).toContain('remaining allowance is only 5');
    });

    it('reconciles local view against the chain each settlement to correct drift', () => {
      spendCapService.setCap({
        cardId: 11,
        agentId: 'agent_drift_test',
        onChainCap: 100,
        consumedLocal: 40,
        lastSettledOnChainCap: 100,
        dailyLimit: 0,
        monthlyLimit: 0,
        status: 'active',
        expiresAt: 0,
      });

      // After on-chain settlement, chain updates remaining cap to 60, settledAmount is 40
      const reconciled = spendCapService.reconcileSettlement('agent_drift_test', 60, 40);
      expect(reconciled?.onChainCap).toBe(60);
      expect(reconciled?.consumedLocal).toBe(0);
      expect(spendCapService.canTransact('agent_drift_test', 10).remainingAllowance).toBe(60);
    });
  });

  describe('Issue #1522: Cost model and unit economics instrumentation', () => {
    it('instruments cost per call and detects negative unit economics', () => {
      unitEconomicsService.recordChannel({
        channelId: 'chan_unit_1',
        providerId: 'provider_deepseek',
        channelSize: 2000,
        chainFeePerSettlement: 40,
        infrastructureCostPerCall: 0.1,
        providerPayoutRate: 1.0,
        settledCallsCount: 0,
        totalRevenue: 0,
      });

      // 4 calls settled in a batch, revenue earned 2.0 (0.50/call)
      // Cost per call = (40 / 4) + 0.1 + 1.0 = 11.10
      // Net margin = 0.50 - 11.10 = -10.60 (negative economics!)
      const summary = unitEconomicsService.recordSettledBatch('chan_unit_1', 4, 40, 2.0);
      expect(summary?.isNegativeEconomics).toBe(true);
      expect(summary?.amortizedChainFeePerCall).toBe(10);
      expect(summary?.totalCostPerCall).toBe(11.1);
      expect(summary?.netMarginPerCall).toBeLessThan(0);

      const alerts = unitEconomicsService.getAlerts();
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0].channelId).toBe('chan_unit_1');
    });

    it('derives minimum viable channel size and optimal batch threshold from measured data', () => {
      unitEconomicsService.recordChannel({
        channelId: 'chan_unit_2',
        providerId: 'provider_openai',
        channelSize: 5000,
        chainFeePerSettlement: 50,
        infrastructureCostPerCall: 0.05,
        providerPayoutRate: 0.5,
        settledCallsCount: 50,
        totalRevenue: 100,
      });

      // Target price 5 per call
      const policy = unitEconomicsService.deriveBatchingPolicy('provider_openai', 5);
      expect(policy.providerId).toBe('provider_openai');
      expect(policy.optimalBatchThreshold).toBeGreaterThanOrEqual(10);
      expect(policy.minimumViableChannelSize).toBeGreaterThanOrEqual(100);
      expect(policy.currentMarginPercent).toBeGreaterThan(0);
    });
  });
});
