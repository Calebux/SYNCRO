/**
 * Risk Detection System Type Definitions
 */

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type RiskWeightValue = 'NONE' | 'MEDIUM' | 'HIGH';

export type RiskFactorType =
  | 'call_rate_vs_baseline'
  | 'spend_velocity_vs_cap'
  | 'route_mix_shift'
  | 'first_time_provider'
  | 'dormant_key_activity'
  | 'consecutive_failures'
  | 'balance_projection'
  | 'approval_expiration';

export type RiskActionType = 'warn' | 'throttle' | 'require_reauthorization' | 'none';

export interface RiskActionPolicy {
  highRiskAction: RiskActionType;
  mediumRiskAction: RiskActionType;
  notifyPrincipal: boolean;
}

/**
 * Risk weight with numeric value for aggregation
 */
export interface RiskWeight {
  type: RiskFactorType;
  weight: RiskWeightValue;
  numericWeight: number;
  details: Record<string, any>;
}

/**
 * Individual risk factor in assessment
 */
export interface RiskFactor {
  factor_type: RiskFactorType;
  weight: RiskWeightValue;
  details: Record<string, any>;
}

/**
 * Context for agent spend risk evaluation
 */
export interface AgentSpendContext {
  keyId: string;
  agentId?: string;
  userId: string;
  provider?: string;
  route?: string;
  callCostUsd?: number;
  timestamp?: Date;
  recentCallRateCount?: number;
  baselineCallRateCount?: number;
  recentSpendUsd?: number;
  spendCapUsd?: number;
  historicalRoutes?: string[];
  knownProviders?: string[];
  lastKeyActivityAt?: Date | string;
  currentTimestamp?: Date;
  [key: string]: any;
}

/**
 * Agent risk assessment result
 */
export interface AgentRiskAssessment {
  key_id: string;
  agent_id?: string;
  user_id: string;
  risk_level: RiskLevel;
  risk_factors: RiskFactor[];
  action_taken: RiskActionType;
  computed_at: string;
  skipped?: boolean;
}

/**
 * Risk assessment result for a subscription (legacy/backward compatibility)
 */
export interface RiskAssessment {
  subscription_id: string;
  risk_level: RiskLevel;
  risk_factors: RiskFactor[];
  action_taken?: RiskActionType;
  computed_at: string;
  skipped?: boolean;
}

/**
 * Stored risk score in database
 */
export interface RiskScore {
  id: string;
  subscription_id?: string;
  key_id?: string;
  agent_id?: string;
  user_id: string;
  risk_level: RiskLevel;
  risk_factors: RiskFactor[];
  action_taken?: RiskActionType;
  last_calculated_at: string;
  last_notified_risk_level?: RiskLevel;
  created_at: string;
  updated_at: string;
}

/**
 * Renewal attempt record
 */
export interface RenewalAttempt {
  id: string;
  subscription_id: string;
  attempt_date: string;
  success: boolean;
  error_message?: string;
  created_at: string;
}

/**
 * Subscription approval record
 */
export interface SubscriptionApproval {
  id: string;
  subscription_id: string;
  user_id: string;
  approval_type: 'renewal' | 'payment';
  expires_at: string;
  status: 'active' | 'expired' | 'revoked';
  created_at: string;
  updated_at: string;
}

/**
 * Risk weight configuration
 */
export interface RiskWeightConfig {
  callRateVsBaseline: {
    none: number;
    medium: number;
    high: number;
  };
  spendVelocityVsCap: {
    none: number;
    medium: number;
    high: number;
  };
  routeMixShift: {
    none: number;
    medium: number;
    high: number;
  };
  firstTimeProvider: {
    none: number;
    high: number;
  };
  dormantKeyActivity: {
    none: number;
    medium: number;
    high: number;
  };
  actionPolicy: RiskActionPolicy;
  consecutiveFailures?: {
    none: number;
    medium: number;
    high: number;
  };
  balanceProjection?: {
    sufficient: number;
    low: number;
    insufficient: number;
  };
  approvalExpiration?: {
    valid: number;
    expired: number;
  };
}

/**
 * Default risk weight configuration
 */
export const DEFAULT_RISK_WEIGHTS: RiskWeightConfig = {
  callRateVsBaseline: {
    none: 0,
    medium: 5,
    high: 10,
  },
  spendVelocityVsCap: {
    none: 0,
    medium: 5,
    high: 10,
  },
  routeMixShift: {
    none: 0,
    medium: 5,
    high: 10,
  },
  firstTimeProvider: {
    none: 0,
    high: 10,
  },
  dormantKeyActivity: {
    none: 0,
    medium: 5,
    high: 10,
  },
  actionPolicy: {
    highRiskAction: 'warn',
    mediumRiskAction: 'warn',
    notifyPrincipal: true,
  },
  consecutiveFailures: {
    none: 0,
    medium: 5,
    high: 10,
  },
  balanceProjection: {
    sufficient: 0,
    low: 5,
    insufficient: 10,
  },
  approvalExpiration: {
    valid: 0,
    expired: 10,
  },
};

/**
 * Risk context for evaluation (legacy)
 */
export interface RiskContext {
  currentTimestamp: Date;
  renewalAttempts?: RenewalAttempt[];
  approval?: SubscriptionApproval;
  projectedBalance?: number;
  [key: string]: any;
}

/**
 * Result of batch risk recalculation
 */
export interface RiskRecalculationResult {
  total: number;
  successful: number;
  failed: number;
  errors: Array<{
    subscription_id?: string;
    key_id?: string;
    error: string;
  }>;
  duration_ms: number;
}

/**
 * Risk notification payload
 */
export interface RiskNotificationPayload {
  subscription_id?: string;
  key_id?: string;
  agent_id?: string;
  subscription_name?: string;
  subscription_price?: number;
  previous_risk_level?: RiskLevel;
  new_risk_level: RiskLevel;
  risk_factors: RiskFactor[];
  action_taken?: RiskActionType;
  user_id: string;
}

