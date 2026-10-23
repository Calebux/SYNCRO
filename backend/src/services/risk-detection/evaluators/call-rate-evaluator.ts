/**
 * Call Rate vs Baseline Evaluator
 * Evaluates risk when an agent or key's recent call rate spikes relative to baseline
 */

import { RiskWeight, AgentSpendContext, RiskWeightConfig, RiskWeightValue } from '../../../types/risk-detection';
import { RiskFactorEvaluator, weightToNumeric } from './base-evaluator';
import logger from '../../../config/logger';

export class CallRateEvaluator implements RiskFactorEvaluator {
  constructor(private config: RiskWeightConfig) {}

  async evaluate(context: AgentSpendContext): Promise<RiskWeight> {
    try {
      const recentRate = context.recentCallRateCount ?? 0;
      const baselineRate = context.baselineCallRateCount ?? 1;

      const ratio = baselineRate > 0 ? recentRate / baselineRate : recentRate > 0 ? 10 : 0;

      let weight: RiskWeightValue = 'NONE';
      if (ratio > 5) {
        weight = 'HIGH';
      } else if (ratio > 2) {
        weight = 'MEDIUM';
      }

      const numericWeight = weightToNumeric(weight, this.config, 'call_rate_vs_baseline');

      return {
        type: 'call_rate_vs_baseline',
        weight,
        numericWeight,
        details: {
          recent_call_rate: recentRate,
          baseline_call_rate: baselineRate,
          call_rate_ratio: Number(ratio.toFixed(2)),
        },
      };
    } catch (error) {
      logger.error('Error in CallRateEvaluator:', error);
      return {
        type: 'call_rate_vs_baseline',
        weight: 'NONE',
        numericWeight: 0,
        details: { error: 'Failed to evaluate call rate vs baseline' },
      };
    }
  }
}
