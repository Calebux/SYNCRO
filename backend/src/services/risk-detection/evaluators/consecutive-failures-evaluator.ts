/**
 * Consecutive Failures Risk Evaluator
 * Evaluates risk based on consecutive failed renewal attempts
 */

import { supabase, databaseRepository } from '../../../config/database';
import { Subscription } from '../../../types/subscription';
import { RiskWeight, RiskContext, RiskWeightConfig, RiskWeightValue } from '../../../types/risk-detection';
import { RiskFactorEvaluator, weightToNumeric } from './base-evaluator';
import logger from '../../../config/logger';

export class ConsecutiveFailuresEvaluator implements RiskFactorEvaluator {
  constructor(private config: RiskWeightConfig) {}

  async evaluate(subscription: Subscription, context: RiskContext): Promise<RiskWeight> {
    try {
      // Fetch renewal attempts for this subscription, ordered by date descending
      const { data: attempts, error } = await databaseRepository
        .from('subscription_renewal_attempts')
        .select('*')
        .eq('subscription_id', subscription.id)
        .order('attempt_date', { ascending: false });

      if (error) {
        logger.error('Error fetching renewal attempts:', error);
        throw error;
      }

      // Calculate consecutive failures
      let consecutiveFailures = 0;
      if (attempts && attempts.length > 0) {
        for (const attempt of attempts) {
          if (!attempt.success) {
            consecutiveFailures++;
          } else {
            // Stop counting when we hit a successful attempt
            break;
          }
        }
      }

      // Determine weight based on consecutive failures
      let weight: RiskWeightValue;
      if (consecutiveFailures === 0) {
        weight = 'NONE';
      } else if (consecutiveFailures <= 2) {
        weight = 'MEDIUM';
      } else {
        weight = 'HIGH';
      }

      const numericWeight = weightToNumeric(weight, this.config, 'consecutive_failures');

      return {
        type: 'consecutive_failures',
        weight,
        numericWeight,
        details: {
          consecutive_failures: consecutiveFailures,
          total_attempts: attempts?.length || 0,
        },
      };
    } catch (error) {
      logger.error('Error in ConsecutiveFailuresEvaluator:', error);
      // Return NONE weight on error (graceful degradation)
      return {
        type: 'consecutive_failures',
        weight: 'NONE',
        numericWeight: 0,
        details: {
          error: 'Failed to evaluate consecutive failures',
          consecutive_failures: 0,
        },
      };
    }
  }
}
