/**
 * Sudden Shift in Route Mix Evaluator
 * Detects abnormal route / endpoint target mix shifts
 */

import { RiskWeight, AgentSpendContext, RiskWeightConfig, RiskWeightValue } from '../../../types/risk-detection';
import { RiskFactorEvaluator, weightToNumeric } from './base-evaluator';
import logger from '../../../config/logger';

export class RouteMixEvaluator implements RiskFactorEvaluator {
  constructor(private config: RiskWeightConfig) {}

  async evaluate(context: AgentSpendContext): Promise<RiskWeight> {
    try {
      const currentRoute = context.route;
      const historicalRoutes = context.historicalRoutes ?? [];
      const shiftRatio = context.routeShiftRatio ?? (
        currentRoute && historicalRoutes.length > 0 && !historicalRoutes.includes(currentRoute) ? 1.0 : 0
      );

      let weight: RiskWeightValue = 'NONE';
      if (shiftRatio > 0.5) {
        weight = 'HIGH';
      } else if (shiftRatio > 0.2) {
        weight = 'MEDIUM';
      }

      const numericWeight = weightToNumeric(weight, this.config, 'route_mix_shift');

      return {
        type: 'route_mix_shift',
        weight,
        numericWeight,
        details: {
          current_route: currentRoute || null,
          historical_routes: historicalRoutes,
          shift_ratio: Number(shiftRatio.toFixed(2)),
          is_uncharacteristic: shiftRatio > 0.2,
        },
      };
    } catch (error) {
      logger.error('Error in RouteMixEvaluator:', error);
      return {
        type: 'route_mix_shift',
        weight: 'NONE',
        numericWeight: 0,
        details: { error: 'Failed to evaluate route mix shift' },
      };
    }
  }
}
