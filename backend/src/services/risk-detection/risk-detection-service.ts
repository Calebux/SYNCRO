/**
 * Risk Detection Service
 * Core service for computing and managing subscription risk scores
 */

import { supabase } from "../../config/database";
import logger from "../../config/logger";
import { Subscription } from "../../types/subscription";
import { webhookService } from "../webhook-service";
import {
  RiskAssessment,
  RiskScore,
  RiskContext,
  RiskWeightConfig,
  DEFAULT_RISK_WEIGHTS,
  RiskRecalculationResult,
  RenewalAttempt,
  RiskFactor,
  RiskLevel,
} from "../../types/risk-detection";
import { ConsecutiveFailuresEvaluator } from "./evaluators/consecutive-failures-evaluator";
import { BalanceProjectionEvaluator } from "./evaluators/balance-projection-evaluator";
import { ApprovalExpirationEvaluator } from "./evaluators/approval-expiration-evaluator";
import { RiskAggregator } from "./risk-aggregator";

export class RiskDetectionService {
  private consecutiveFailuresEvaluator: ConsecutiveFailuresEvaluator;
  private balanceProjectionEvaluator: BalanceProjectionEvaluator;
  private approvalExpirationEvaluator: ApprovalExpirationEvaluator;
  private aggregator: RiskAggregator;
  private config: RiskWeightConfig;

  constructor(config: RiskWeightConfig = DEFAULT_RISK_WEIGHTS) {
    this.config = config;
    this.consecutiveFailuresEvaluator = new ConsecutiveFailuresEvaluator(
      config,
    );
    this.balanceProjectionEvaluator = new BalanceProjectionEvaluator(config);
    this.approvalExpirationEvaluator = new ApprovalExpirationEvaluator(config);
    this.aggregator = new RiskAggregator();
  }

  /**
   * Compute risk level for a single subscription
   */
  async computeRiskLevel(subscriptionId: string): Promise<RiskAssessment> {
    const startTime = Date.now();

    try {
      // Fetch subscription
      const { data: subscription, error } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("id", subscriptionId)
        .single();

      if (error || !subscription) {
        throw new Error(`Subscription not found: ${subscriptionId}`);
      }

      if (subscription.status === "paused") {
        logger.info(
          `Skipping risk calculation — subscription ${subscriptionId} is paused`,
        );
        return {
          subscription_id: subscriptionId,
          risk_level: "none" as RiskLevel,
          risk_factors: [],
          computed_at: new Date().toISOString(),
          skipped: true,
        };
      }

      // Build risk context
      const context: RiskContext = {
        currentTimestamp: new Date(),
        // Note: projectedBalance would be calculated by a separate service
        // For now, we'll skip balance projection if not provided
      };

      // Run all evaluators
      const riskWeights = await Promise.all([
        this.consecutiveFailuresEvaluator.evaluate(subscription, context),
        this.balanceProjectionEvaluator.evaluate(subscription, context),
        this.approvalExpirationEvaluator.evaluate(subscription, context),
      ]);

      // Aggregate risk level
      const riskLevel = this.aggregator.aggregate(riskWeights);

      // Convert risk weights to risk factors for storage
      const riskFactors: RiskFactor[] = riskWeights.map((w) => ({
        factor_type: w.type,
        weight: w.weight,
        details: w.details,
      }));

      const assessment: RiskAssessment = {
        subscription_id: subscriptionId,
        risk_level: riskLevel,
        risk_factors: riskFactors,
        computed_at: new Date().toISOString(),
      };

      const duration = Date.now() - startTime;
      logger.info("Risk computed for subscription", {
        subscription_id: subscriptionId,
        risk_level: riskLevel,
        duration_ms: duration,
      });

      // Log calculation details
      logger.debug("Risk calculation details", {
        subscription_id: subscriptionId,
        risk_factors: riskFactors,
        risk_level: riskLevel,
      });

      return assessment;
    } catch (error) {
      logger.error("Error computing risk level:", error);
      throw error;
    }
  }

  /**
   * Save risk score to database
   */
  async saveRiskScore(
    assessment: RiskAssessment,
    userId: string,
  ): Promise<RiskScore> {
    try {
      // Get old score to check for change
      const { data: oldScore } = await supabase
        .from("subscription_risk_scores")
        .select("risk_level")
        .eq("subscription_id", assessment.subscription_id)
        .single();

      const { data, error } = await supabase
        .from("subscription_risk_scores")
        .upsert(
          {
            subscription_id: assessment.subscription_id,
            user_id: userId,
            risk_level: assessment.risk_level,
            risk_factors: assessment.risk_factors,
            last_calculated_at: assessment.computed_at,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: "subscription_id",
          },
        )
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to save risk score: ${error.message}`);
      }

      if (data && oldScore && oldScore.risk_level !== assessment.risk_level) {
        webhookService.dispatchEvent(userId, "subscription.risk_score_changed", {
          subscription_id: assessment.subscription_id,
          old_risk_level: oldScore.risk_level,
          new_risk_level: assessment.risk_level,
          risk_factors: assessment.risk_factors
        }).catch(err => {
          logger.error("Failed to dispatch subscription.risk_score_changed webhook:", err);
        });
      }

      return data as RiskScore;
    } catch (error) {
      logger.error("Error saving risk score:", error);
      throw error;
    }
  }

  /**
   * Get risk score for a subscription
   */
  async getRiskScore(
    subscriptionId: string,
    userId: string,
  ): Promise<RiskScore> {
    try {
      const { data, error } = await supabase
        .from("subscription_risk_scores")
        .select("*")
        .eq("subscription_id", subscriptionId)
        .eq("user_id", userId)
        .single();

      if (error || !data) {
        throw new Error(
          `Risk score not found for subscription: ${subscriptionId}`,
        );
      }

      return data as RiskScore;
    } catch (error) {
      logger.error("Error fetching risk score:", error);
      throw error;
    }
  }

  /**
   * Get all risk scores for a user
   */
  async getUserRiskScores(userId: string): Promise<RiskScore[]> {
    try {
      const { data, error } = await supabase
        .from("subscription_risk_scores")
        .select("*")
        .eq("user_id", userId)
        .order("last_calculated_at", { ascending: false });

      if (error) {
        throw new Error(`Failed to fetch user risk scores: ${error.message}`);
      }

      return (data || []) as RiskScore[];
    } catch (error) {
      logger.error("Error fetching user risk scores:", error);
      throw error;
    }
  }

  /**
   * Recalculate risk for all active subscriptions
   */
  async recalculateAllRisks(): Promise<RiskRecalculationResult> {
    const startTime = Date.now();
    const result: RiskRecalculationResult = {
      total: 0,
      successful: 0,
      failed: 0,
      errors: [],
      duration_ms: 0,
    };

    try {
      logger.info("Starting risk recalculation for all active subscriptions");

      // Fetch all active subscriptions in batches
      const batchSize = 100;
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const { data: subscriptions, error } = await supabase
          .from("subscriptions")
          .select("*")
          .eq("status", "active")
          .range(offset, offset + batchSize - 1);

        if (error) {
          logger.error("Error fetching subscriptions:", error);
          throw error;
        }

        if (!subscriptions || subscriptions.length === 0) {
          hasMore = false;
          break;
        }

        result.total += subscriptions.length;

        // Process each subscription
        for (const subscription of subscriptions) {
          try {
            const assessment = await this.computeRiskLevel(subscription.id);
            await this.saveRiskScore(assessment, subscription.user_id);
            result.successful++;
          } catch (error) {
            result.failed++;
            result.errors.push({
              subscription_id: subscription.id,
              error: error instanceof Error ? error.message : String(error),
            });
            logger.error(
              `Failed to recalculate risk for subscription ${subscription.id}:`,
              error,
            );
          }
        }

        offset += batchSize;
        hasMore = subscriptions.length === batchSize;
      }

      result.duration_ms = Date.now() - startTime;

      logger.info("Risk recalculation completed", {
        total: result.total,
        successful: result.successful,
        failed: result.failed,
        duration_ms: result.duration_ms,
      });

      return result;
    } catch (error) {
      result.duration_ms = Date.now() - startTime;
      logger.error("Error in risk recalculation:", error);
      throw error;
    }
  }

  /**
   * Record a renewal attempt
   */
  async recordRenewalAttempt(
    subscriptionId: string,
    success: boolean,
    errorMessage?: string,
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from("subscription_renewal_attempts")
        .insert({
          subscription_id: subscriptionId,
          success,
          error_message: errorMessage || null,
          attempt_date: new Date().toISOString(),
        });

      if (error) {
        throw new Error(`Failed to record renewal attempt: ${error.message}`);
      }

      logger.info("Renewal attempt recorded", {
        subscription_id: subscriptionId,
        success,
      });
    } catch (error) {
      logger.error("Error recording renewal attempt:", error);
      throw error;
    }
  }
}

export const riskDetectionService = new RiskDetectionService();
