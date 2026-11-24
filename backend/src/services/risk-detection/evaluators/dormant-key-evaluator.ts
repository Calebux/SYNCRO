/**
 * Dormant Key Activity Evaluator
 * Evaluates risk when calls originate from an API key that has been dormant
 */

import { RiskWeight, AgentSpendContext, RiskWeightConfig, RiskWeightValue } from '../../../types/risk-detection';
import { RiskFactorEvaluator, weightToNumeric } from './base-evaluator';
import logger from '../../../config/logger';

export class DormantKeyEvaluator implements RiskFactorEvaluator {
  constructor(private config: RiskWeightConfig) {}

  async evaluate(context: AgentSpendContext): Promise<RiskWeight> {
    try {
      const now = context.currentTimestamp ? new Date(context.currentTimestamp) : new Date();
      let dormantDays = 0;
      let isDormant = false;

      if (context.dormantDays !== undefined) {
        dormantDays = context.dormantDays;
        isDormant = dormantDays >= 7;
      } else if (context.lastKeyActivityAt) {
        const lastActive = new Date(context.lastKeyActivityAt);
        const diffMs = now.getTime() - lastActive.getTime();
        dormantDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        isDormant = dormantDays >= 7;
      }

      let weight: RiskWeightValue = 'NONE';
      if (dormantDays > 30) {
        weight = 'HIGH';
      } else if (dormantDays >= 7) {
        weight = 'MEDIUM';
      }

      const numericWeight = weightToNumeric(weight, this.config, 'dormant_key_activity');

      return {
        type: 'dormant_key_activity',
        weight,
        numericWeight,
        details: {
          last_key_activity_at: context.lastKeyActivityAt || null,
          dormant_days: dormantDays,
          is_dormant: isDormant,
        },
      };
    } catch (error) {
      logger.error('Error in DormantKeyEvaluator:', error);
      return {
        type: 'dormant_key_activity',
        weight: 'NONE',
        numericWeight: 0,
        details: { error: 'Failed to evaluate dormant key activity' },
      };
    }
  }
}
