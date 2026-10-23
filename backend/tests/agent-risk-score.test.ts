import { RiskDetectionService } from '../src/services/risk-detection/risk-detection-service';
import { auditService } from '../src/services/audit-service';
import { DEFAULT_RISK_WEIGHTS } from '../src/types/risk-detection';

// Mock Supabase database calls
jest.mock('../src/config/database', () => ({
  supabase: {
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      upsert: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
    }),
  },
}));

// Mock webhook service
jest.mock('../src/services/webhook-service', () => ({
  webhookService: {
    dispatchEvent: jest.fn().mockResolvedValue(true),
  },
}));

describe('Agent Spend Risk Detection System', () => {
  let riskService: RiskDetectionService;
  let auditSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    riskService = new RiskDetectionService(DEFAULT_RISK_WEIGHTS);
    auditSpy = jest.spyOn(auditService, 'insertEntry').mockResolvedValue({ success: true });
  });

  afterEach(() => {
    auditSpy.mockRestore();
  });

  describe('Simulated Runaway Agent Scenario', () => {
    it('scores HIGH for runaway call rate and rapid spend velocity against cap', async () => {
      riskService.updateActionPolicy({ highRiskAction: 'throttle' });

      const runawayContext = {
        keyId: 'key-runaway-123',
        agentId: 'agent-runaway-99',
        userId: 'user-001',
        recentCallRateCount: 100, // 100 calls/min
        baselineCallRateCount: 2,   // 2 calls/min baseline (50x spike)
        recentSpendUsd: 95,        // $95 spent
        spendCapUsd: 100,          // $100 daily cap (95% velocity)
        route: '/api/v1/chat',
        historicalRoutes: ['/api/v1/chat'],
        provider: 'openai',
        knownProviders: ['openai'],
        dormantDays: 0,
      };

      const assessment = await riskService.evaluateAgentRisk(runawayContext);

      expect(assessment.risk_level).toBe('HIGH');
      expect(assessment.action_taken).toBe('throttle');

      const callRateFactor = assessment.risk_factors.find((f) => f.factor_type === 'call_rate_vs_baseline');
      const spendVelocityFactor = assessment.risk_factors.find((f) => f.factor_type === 'spend_velocity_vs_cap');

      expect(callRateFactor?.weight).toBe('HIGH');
      expect(spendVelocityFactor?.weight).toBe('HIGH');

      // Verify audit trail logging
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'agent.risk_scored',
          resourceType: 'agent_key',
          resourceId: 'key-runaway-123',
          metadata: expect.objectContaining({
            risk_level: 'HIGH',
            action_taken: 'throttle',
          }),
        })
      );
    });
  });

  describe('Simulated Stolen Key Scenario', () => {
    it('scores HIGH for dormant key, first-time provider, and sudden route mix shift', async () => {
      riskService.updateActionPolicy({ highRiskAction: 'require_reauthorization' });

      const stolenKeyContext = {
        keyId: 'key-stolen-456',
        agentId: 'agent-rogue-88',
        userId: 'user-002',
        recentCallRateCount: 1,
        baselineCallRateCount: 1,
        recentSpendUsd: 5,
        spendCapUsd: 100,
        dormantDays: 45, // Dormant for 45 days -> HIGH
        provider: 'unauthorized-external-llm',
        knownProviders: ['openai', 'anthropic'], // First time provider -> HIGH
        route: '/api/v1/heavy-withdraw',
        historicalRoutes: ['/api/v1/chat'], // Uncharacteristic route -> HIGH
      };

      const assessment = await riskService.evaluateAgentRisk(stolenKeyContext);

      expect(assessment.risk_level).toBe('HIGH');
      expect(assessment.action_taken).toBe('require_reauthorization');

      const dormantFactor = assessment.risk_factors.find((f) => f.factor_type === 'dormant_key_activity');
      const providerFactor = assessment.risk_factors.find((f) => f.factor_type === 'first_time_provider');
      const routeFactor = assessment.risk_factors.find((f) => f.factor_type === 'route_mix_shift');

      expect(dormantFactor?.weight).toBe('HIGH');
      expect(providerFactor?.weight).toBe('HIGH');
      expect(routeFactor?.weight).toBe('HIGH');

      // Verify audit trail logging
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'agent.risk_scored',
          resourceType: 'agent_key',
          resourceId: 'key-stolen-456',
          metadata: expect.objectContaining({
            risk_level: 'HIGH',
            action_taken: 'require_reauthorization',
          }),
        })
      );
    });
  });

  describe('Normal Traffic Scenario', () => {
    it('scores LOW for normal call rate, low spend velocity, and familiar providers/routes', async () => {
      riskService.updateActionPolicy({ highRiskAction: 'warn', mediumRiskAction: 'warn' });

      const normalContext = {
        keyId: 'key-normal-789',
        agentId: 'agent-good-01',
        userId: 'user-003',
        recentCallRateCount: 3,
        baselineCallRateCount: 2.5, // 1.2x -> NONE
        recentSpendUsd: 10,
        spendCapUsd: 100, // 10% velocity -> NONE
        provider: 'openai',
        knownProviders: ['openai', 'anthropic'], // Known provider -> NONE
        route: '/api/v1/chat',
        historicalRoutes: ['/api/v1/chat'], // Familiar route -> NONE
        dormantDays: 1, // Active recently -> NONE
      };

      const assessment = await riskService.evaluateAgentRisk(normalContext);

      expect(assessment.risk_level).toBe('LOW');
      expect(assessment.action_taken).toBe('none');

      const highFactors = assessment.risk_factors.filter((f) => f.weight === 'HIGH' || f.weight === 'MEDIUM');
      expect(highFactors.length).toBe(0);
    });
  });

  describe('Configurable High Score Actions', () => {
    it('allows principal/admin to configure action policy between warn, throttle, and require_reauthorization', async () => {
      const highRiskContext = {
        keyId: 'key-test-config',
        userId: 'user-004',
        dormantDays: 60, // HIGH risk
      };

      // 1. Configure action: warn
      riskService.updateActionPolicy({ highRiskAction: 'warn' });
      let assessment = await riskService.evaluateAgentRisk(highRiskContext);
      expect(assessment.action_taken).toBe('warn');

      // 2. Configure action: throttle
      riskService.updateActionPolicy({ highRiskAction: 'throttle' });
      assessment = await riskService.evaluateAgentRisk(highRiskContext);
      expect(assessment.action_taken).toBe('throttle');

      // 3. Configure action: require_reauthorization
      riskService.updateActionPolicy({ highRiskAction: 'require_reauthorization' });
      assessment = await riskService.evaluateAgentRisk(highRiskContext);
      expect(assessment.action_taken).toBe('require_reauthorization');
    });
  });

  describe('Off Synchronous Admission Path (Non-blocking Async Evaluation)', () => {
    it('evaluates risk asynchronously without adding latency to paid call admission', async () => {
      const context = {
        keyId: 'key-async-admission-1',
        userId: 'user-async-1',
        recentCallRateCount: 15,
        baselineCallRateCount: 2,
      };

      const startTime = Date.now();
      const promise = riskService.evaluateAgentRiskAsync(context);

      // Async queue method resolves immediately (< 10ms)
      await expect(promise).resolves.toBeUndefined();
      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(15);
    });
  });
});
