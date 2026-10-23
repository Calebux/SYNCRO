/**
 * Base Risk Factor Evaluator Interface & Utilities
 */

import { Subscription } from '../../../types/subscription';
import { RiskWeight, RiskContext, AgentSpendContext, RiskWeightConfig } from '../../../types/risk-detection';

/**
 * Interface for risk factor evaluators
 */
export interface RiskFactorEvaluator {
  /**
   * Evaluate risk for an agent spend context or subscription
   */
  evaluate(context: AgentSpendContext | Subscription | any): Promise<RiskWeight>;
}

/**
 * Helper function to convert weight value to numeric score based on feature type
 */
export function weightToNumeric(
  weight: 'NONE' | 'MEDIUM' | 'HIGH',
  config: RiskWeightConfig,
  factorType: string
): number {
  switch (factorType) {
    case 'call_rate_vs_baseline':
      if (weight === 'NONE') return config.callRateVsBaseline.none;
      if (weight === 'MEDIUM') return config.callRateVsBaseline.medium;
      return config.callRateVsBaseline.high;

    case 'spend_velocity_vs_cap':
      if (weight === 'NONE') return config.spendVelocityVsCap.none;
      if (weight === 'MEDIUM') return config.spendVelocityVsCap.medium;
      return config.spendVelocityVsCap.high;

    case 'route_mix_shift':
      if (weight === 'NONE') return config.routeMixShift.none;
      if (weight === 'MEDIUM') return config.routeMixShift.medium;
      return config.routeMixShift.high;

    case 'first_time_provider':
      if (weight === 'NONE') return config.firstTimeProvider.none;
      return config.firstTimeProvider.high;

    case 'dormant_key_activity':
      if (weight === 'NONE') return config.dormantKeyActivity.none;
      if (weight === 'MEDIUM') return config.dormantKeyActivity.medium;
      return config.dormantKeyActivity.high;

    case 'consecutive_failures':
      if (weight === 'NONE') return config.consecutiveFailures?.none ?? 0;
      if (weight === 'MEDIUM') return config.consecutiveFailures?.medium ?? 5;
      return config.consecutiveFailures?.high ?? 10;

    case 'balance_projection':
      if (weight === 'NONE') return config.balanceProjection?.sufficient ?? 0;
      if (weight === 'MEDIUM') return config.balanceProjection?.low ?? 5;
      return config.balanceProjection?.insufficient ?? 10;

    case 'approval_expiration':
      if (weight === 'NONE') return config.approvalExpiration?.valid ?? 0;
      return config.approvalExpiration?.expired ?? 10;

    default:
      if (weight === 'NONE') return 0;
      if (weight === 'MEDIUM') return 5;
      return 10;
  }
}

