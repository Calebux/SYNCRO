/**
 * Risk Detection Service
 * Core service for computing and managing agent spend risk scores
 */

import { supabase } from "../../config/database";
import logger from "../../config/logger";
import { auditService } from "../audit-service";
import { webhookService } from "../webhook-service";
import {
  RiskAssessment,
  AgentRiskAssessment,
  AgentSpendContext,
  RiskScore,
  RiskContext,
  RiskWeightConfig,
  DEFAULT_RISK_WEIGHTS,
  RiskRecalculationResult,
  RiskFactor,
  RiskLevel,
  RiskActionType,
  RiskActionPolicy,
} from "../../types/risk-detection";
import { CallRateEvaluator } from "./evaluators/call-rate-evaluator";
import { SpendVelocityEvaluator } from "./evaluators/spend-velocity-evaluator";
import { RouteMixEvaluator } from "./evaluators/route-mix-evaluator";
import { FirstTimeProviderEvaluator } from "./evaluators/first-time-provider-evaluator";
import { DormantKeyEvaluator } from "./evaluators/dormant-key-evaluator";
import { ConsecutiveFailuresEvaluator } from "./evaluators/consecutive-failures-evaluator";
import { BalanceProjectionEvaluator } from "./evaluators/balance-projection-evaluator";
import { ApprovalExpirationEvaluator } from "./evaluators/approval-expiration-evaluator";
import { RiskAggregator } from "./risk-aggregator";
import { Subscription } from "../../types/subscription";

export class RiskDetectionService {
  private callRateEvaluator: CallRateEvaluator;
  private spendVelocityEvaluator: SpendVelocityEvaluator;
  private routeMixEvaluator: RouteMixEvaluator;
  private firstTimeProviderEvaluator: FirstTimeProviderEvaluator;
  private dormantKeyEvaluator: DormantKeyEvaluator;

  private consecutiveFailuresEvaluator: ConsecutiveFailuresEvaluator;
  private balanceProjectionEvaluator: BalanceProjectionEvaluator;
  private approvalExpirationEvaluator: ApprovalExpirationEvaluator;

  private aggregator: RiskAggregator;
  private config: RiskWeightConfig;

  constructor(config: RiskWeightConfig = DEFAULT_RISK_WEIGHTS) {
    this.config = config;
    this.callRateEvaluator = new CallRateEvaluator(config);
    this.spendVelocityEvaluator = new SpendVelocityEvaluator(config);
    this.routeMixEvaluator = new RouteMixEvaluator(config);
    this.firstTimeProviderEvaluator = new FirstTimeProviderEvaluator(config);
    this.dormantKeyEvaluator = new DormantKeyEvaluator(config);

    this.consecutiveFailuresEvaluator = new ConsecutiveFailuresEvaluator(config);
    this.balanceProjectionEvaluator = new BalanceProjectionEvaluator(config);
    this.approvalExpirationEvaluator = new ApprovalExpirationEvaluator(config);
    this.aggregator = new RiskAggregator();
  }

  /**
   * Update configurable risk action policy
   */
  updateActionPolicy(policy: Partial<RiskActionPolicy>): RiskActionPolicy {
    this.config.actionPolicy = {
      ...this.config.actionPolicy,
      ...policy,
    };
    logger.info("Updated risk action policy", this.config.actionPolicy);
    return this.config.actionPolicy;
  }

  /**
   * Get current risk action policy
   */
  getActionPolicy(): RiskActionPolicy {
    return { ...this.config.actionPolicy };
  }

  /**
   * Evaluate agent spend risk synchronously
   */
  async evaluateAgentRisk(context: AgentSpendContext): Promise<AgentRiskAssessment> {
    const startTime = Date.now();

    try {
      // Evaluate all 5 agent-spend features
      const riskWeights = await Promise.all([
        this.callRateEvaluator.evaluate(context),
        this.spendVelocityEvaluator.evaluate(context),
        this.routeMixEvaluator.evaluate(context),
        this.firstTimeProviderEvaluator.evaluate(context),
        this.dormantKeyEvaluator.evaluate(context),
      ]);

      // Aggregate overall risk level
      const riskLevel = this.aggregator.aggregate(riskWeights);

      // Determine configured action based on risk level
      let actionTaken: RiskActionType = 'none';
      if (riskLevel === 'HIGH') {
        actionTaken = this.config.actionPolicy.highRiskAction || 'warn';
      } else if (riskLevel === 'MEDIUM') {
        actionTaken = this.config.actionPolicy.mediumRiskAction || 'warn';
      }

      const riskFactors: RiskFactor[] = riskWeights.map((w) => ({
        factor_type: w.type,
        weight: w.weight,
        details: w.details,
      }));

      const assessment: AgentRiskAssessment = {
        key_id: context.keyId,
        agent_id: context.agentId,
        user_id: context.userId,
        risk_level: riskLevel,
        risk_factors: riskFactors,
        action_taken: actionTaken,
        computed_at: new Date().toISOString(),
      };

      const duration = Date.now() - startTime;
      logger.info("Agent spend risk computed", {
        key_id: context.keyId,
        agent_id: context.agentId,
        risk_level: riskLevel,
        action_taken: actionTaken,
        duration_ms: duration,
      });

      // Save risk score to storage
      await this.saveAgentRiskScore(assessment);

      // Log the score and contributing features on the audit trail for later review
      await auditService.insertEntry({
        userId: context.userId,
        action: 'agent.risk_scored',
        resourceType: 'agent_key',
        resourceId: context.keyId,
        metadata: {
          key_id: context.keyId,
          agent_id: context.agentId,
          risk_level: riskLevel,
          action_taken: actionTaken,
          risk_factors: riskFactors,
          contributing_features: riskFactors.filter((f) => f.weight !== 'NONE'),
          computed_at: assessment.computed_at,
          duration_ms: duration,
        },
      });

      // Dispatch webhook notification if applicable
      if (riskLevel === 'HIGH' && this.config.actionPolicy.notifyPrincipal) {
        webhookService.dispatchEvent(context.userId, "agent.high_risk_detected" as any, {
          key_id: context.keyId,
          agent_id: context.agentId,
          risk_level: riskLevel,
          action_taken: actionTaken,
          risk_factors: riskFactors,
        }).catch((err) => {
          logger.error("Failed to dispatch agent.high_risk_detected webhook:", err);
        });
      }

      return assessment;
    } catch (error) {
      logger.error("Error evaluating agent spend risk:", error);
      throw error;
    }
  }

  /**
   * Evaluate agent risk asynchronously OFF the synchronous admission path.
   * Never adds latency to every paid call.
   */
  evaluateAgentRiskAsync(context: AgentSpendContext): Promise<void> {
    setImmediate(() => {
      this.evaluateAgentRisk(context).catch((err) => {
        logger.error("Asynchronous agent risk evaluation failed:", err);
      });
    });
    return Promise.resolve();
  }

  /**
   * Save agent risk score
   */
  async saveAgentRiskScore(assessment: AgentRiskAssessment): Promise<RiskScore> {
    try {
      const { data, error } = await supabase
        .from("subscription_risk_scores")
        .upsert(
          {
            subscription_id: assessment.key_id, // map key_id into storage primary identifier column
            user_id: assessment.user_id,
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
        logger.warn(`Could not save risk score to DB: ${error.message}`);
      }

      return (data || {
        id: assessment.key_id,
        key_id: assessment.key_id,
        user_id: assessment.user_id,
        risk_level: assessment.risk_level,
        risk_factors: assessment.risk_factors,
        action_taken: assessment.action_taken,
        last_calculated_at: assessment.computed_at,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }) as RiskScore;
    } catch (error) {
      logger.error("Error saving agent risk score:", error);
      return {
        id: assessment.key_id,
        key_id: assessment.key_id,
        user_id: assessment.user_id,
        risk_level: assessment.risk_level,
        risk_factors: assessment.risk_factors,
        action_taken: assessment.action_taken,
        last_calculated_at: assessment.computed_at,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as RiskScore;
    }
  }

  /**
   * Compute risk level for a single subscription (legacy fallback)
   */
  async computeRiskLevel(subscriptionId: string): Promise<RiskAssessment> {
    const startTime = Date.now();

    try {
      const { data: subscription, error } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("id", subscriptionId)
        .single();

      if (error || !subscription) {
        // Fallback to agent spend evaluation if subscription not found
        const agentAssessment = await this.evaluateAgentRisk({
          keyId: subscriptionId,
          userId: "system",
        });
        return {
          subscription_id: subscriptionId,
          risk_level: agentAssessment.risk_level,
          risk_factors: agentAssessment.risk_factors,
          action_taken: agentAssessment.action_taken,
          computed_at: agentAssessment.computed_at,
        };
      }

      if (subscription.status === "paused") {
        return {
          subscription_id: subscriptionId,
          risk_level: "LOW" as RiskLevel,
          risk_factors: [],
          computed_at: new Date().toISOString(),
          skipped: true,
        };
      }

      const context: RiskContext = { currentTimestamp: new Date() };
      const riskWeights = await Promise.all([
        this.consecutiveFailuresEvaluator.evaluate(subscription, context),
        this.balanceProjectionEvaluator.evaluate(subscription, context),
        this.approvalExpirationEvaluator.evaluate(subscription, context),
      ]);

      const riskLevel = this.aggregator.aggregate(riskWeights);
      const riskFactors: RiskFactor[] = riskWeights.map((w) => ({
        factor_type: w.type,
        weight: w.weight,
        details: w.details,
      }));

      return {
        subscription_id: subscriptionId,
        risk_level: riskLevel,
        risk_factors: riskFactors,
        computed_at: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Error computing risk level:", error);
      throw error;
    }
  }

  /**
   * Save risk score to database (legacy)
   */
  async saveRiskScore(assessment: RiskAssessment, userId: string): Promise<RiskScore> {
    return this.saveAgentRiskScore({
      key_id: assessment.subscription_id,
      user_id: userId,
      risk_level: assessment.risk_level,
      risk_factors: assessment.risk_factors,
      action_taken: assessment.action_taken || 'none',
      computed_at: assessment.computed_at,
    });
  }

  /**
   * Get risk score for a key or subscription
   */
  async getRiskScore(keyOrSubscriptionId: string, userId: string): Promise<RiskScore> {
    try {
      const { data, error } = await supabase
        .from("subscription_risk_scores")
        .select("*")
        .eq("subscription_id", keyOrSubscriptionId)
        .eq("user_id", userId)
        .single();

      if (error || !data) {
        // Return default LOW score if not found
        return {
          id: keyOrSubscriptionId,
          key_id: keyOrSubscriptionId,
          subscription_id: keyOrSubscriptionId,
          user_id: userId,
          risk_level: 'LOW',
          risk_factors: [],
          action_taken: 'none',
          last_calculated_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
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
        return [];
      }

      return (data || []) as RiskScore[];
    } catch (error) {
      logger.error("Error fetching user risk scores:", error);
      return [];
    }
  }

  /**
   * Recalculate risk for active agents/keys or subscriptions
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
      logger.info("Starting risk recalculation for all active agents and keys");

      const { data: scores } = await supabase
        .from("subscription_risk_scores")
        .select("*");

      if (scores && scores.length > 0) {
        result.total = scores.length;
        for (const score of scores) {
          try {
            const assessment = await this.evaluateAgentRisk({
              keyId: score.subscription_id || score.id,
              userId: score.user_id,
            });
            result.successful++;
          } catch (err) {
            result.failed++;
            result.errors.push({
              key_id: score.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      result.duration_ms = Date.now() - startTime;
      return result;
    } catch (error) {
      result.duration_ms = Date.now() - startTime;
      logger.error("Error in risk recalculation:", error);
      return result;
    }
  }

  /**
   * Record a payment attempt (legacy)
   */
  async recordRenewalAttempt(
    subscriptionId: string,
    success: boolean,
    errorMessage?: string,
  ): Promise<void> {
    logger.info("Renewal attempt recorded", { subscriptionId, success, errorMessage });
  }
}

export const riskDetectionService = new RiskDetectionService();
