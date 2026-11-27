/**
 * First-Time Provider Evaluator
 * Evaluates risk when an agent makes calls to a provider it has never used before
 */

import { RiskWeight, AgentSpendContext, RiskWeightConfig, RiskWeightValue } from '../../../types/risk-detection';
import { RiskFactorEvaluator, weightToNumeric } from './base-evaluator';
import logger from '../../../config/logger';

export class FirstTimeProviderEvaluator implements RiskFactorEvaluator {
  constructor(private config: RiskWeightConfig) {}

  async evaluate(context: AgentSpendContext): Promise<RiskWeight> {
    try {
      const provider = context.provider;
      const knownProviders = context.knownProviders ?? [];
      const isFirstTime = context.isFirstTimeProvider ?? (
        Boolean(provider) && knownProviders.length > 0 && !knownProviders.includes(provider)
      );

      let weight: RiskWeightValue = 'NONE';
      if (isFirstTime) {
        weight = 'HIGH';
      }

      const numericWeight = weightToNumeric(weight, this.config, 'first_time_provider');

      return {
        type: 'first_time_provider',
        weight,
        numericWeight,
        details: {
          provider: provider || null,
          known_providers: knownProviders,
          is_first_time: isFirstTime,
        },
      };
    } catch (error) {
      logger.error('Error in FirstTimeProviderEvaluator:', error);
      return {
        type: 'first_time_provider',
        weight: 'NONE',
        numericWeight: 0,
        details: { error: 'Failed to evaluate first time provider' },
      };
    }
  }
}
