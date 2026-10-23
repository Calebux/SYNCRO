/**
 * Spend Velocity vs Cap Period Evaluator
 * Evaluates risk based on spend speed relative to defined spend cap budget
 */

import { RiskWeight, AgentSpendContext, RiskWeightConfig, RiskWeightValue } from '../../../types/risk-detection';
import { RiskFactorEvaluator, weightToNumeric } from './base-evaluator';
import logger from '../../../config/logger';

export class SpendVelocityEvaluator implements RiskFactorEvaluator {
  constructor(private config: RiskWeightConfig) {}

  async evaluate(context: AgentSpendContext): Promise<RiskWeight> {
    try {
      const recentSpend = context.recentSpendUsd ?? 0;
      const spendCap = context.spendCapUsd ?? 0;

      let velocityRatio = 0;
      if (spendCap > 0) {
        velocityRatio = recentSpend / spendCap;
      } else if (recentSpend > 0) {
        velocityRatio = 1.0;
      }

      let weight: RiskWeightValue = 'NONE';
      if (velocityRatio > 0.8) {
        weight = 'HIGH';
      } else if (velocityRatio > 0.5) {
        weight = 'MEDIUM';
      }

      const numericWeight = weightToNumeric(weight, this.config, 'spend_velocity_vs_cap');

      return {
        type: 'spend_velocity_vs_cap',
        weight,
        numericWeight,
        details: {
          recent_spend_usd: recentSpend,
          spend_cap_usd: spendCap,
          velocity_ratio: Number(velocityRatio.toFixed(2)),
        },
      };
    } catch (error) {
      logger.error('Error in SpendVelocityEvaluator:', error);
      return {
        type: 'spend_velocity_vs_cap',
        weight: 'NONE',
        numericWeight: 0,
        details: { error: 'Failed to evaluate spend velocity' },
      };
    }
  }
}
