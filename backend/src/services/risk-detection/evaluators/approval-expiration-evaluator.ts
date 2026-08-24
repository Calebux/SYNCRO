/**
 * Approval Expiration Risk Evaluator
 * Evaluates risk based on subscription approval status and expiration
 */

import { supabase, databaseRepository } from '../../../config/database';
import { Subscription } from '../../../types/subscription';
import { RiskWeight, RiskContext, RiskWeightConfig, RiskWeightValue } from '../../../types/risk-detection';
import { RiskFactorEvaluator, weightToNumeric } from './base-evaluator';
import logger from '../../../config/logger';

export class ApprovalExpirationEvaluator implements RiskFactorEvaluator {
  constructor(private config: RiskWeightConfig) {}

  async evaluate(subscription: Subscription, context: RiskContext): Promise<RiskWeight> {
    try {
      // Fetch approval for this subscription
      const { data: approval, error } = await databaseRepository
        .from('subscription_approvals')
        .select('*')
        .eq('subscription_id', subscription.id)
        .eq('status', 'active')
        .order('expires_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        logger.error('Error fetching subscription approval:', error);
        throw error;
      }

      // If no approval exists, check if subscription requires approval
      // For now, we assume if no approval record exists, approval is not required
      if (!approval) {
        logger.debug(`No approval found for subscription ${subscription.id}, assuming not required`);
        return {
          type: 'approval_expiration',
          weight: 'NONE',
          numericWeight: 0,
          details: {
            reason: 'No approval required',
            has_approval: false,
          },
        };
      }

      // Check if approval is expired
      const currentTime = context.currentTimestamp || new Date();
      const expiresAt = new Date(approval.expires_at);
      const isExpired = expiresAt <= currentTime;

      let weight: RiskWeightValue;
      if (isExpired) {
        weight = 'HIGH';
      } else {
        weight = 'NONE';
      }

      const numericWeight = weightToNumeric(weight, this.config, 'approval_expiration');

      return {
        type: 'approval_expiration',
        weight,
        numericWeight,
        details: {
          has_approval: true,
          approval_type: approval.approval_type,
          expires_at: approval.expires_at,
          is_expired: isExpired,
          checked_at: currentTime.toISOString(),
        },
      };
    } catch (error) {
      logger.error('Error in ApprovalExpirationEvaluator:', error);
      // Return NONE weight on error (graceful degradation)
      return {
        type: 'approval_expiration',
        weight: 'NONE',
        numericWeight: 0,
        details: {
          error: 'Failed to evaluate approval expiration',
        },
      };
    }
  }
}
