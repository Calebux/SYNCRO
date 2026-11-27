/**
 * Risk Weight Configuration
 * Centralized configuration for risk factor weights and high-score action policies
 */

import { RiskWeightConfig, DEFAULT_RISK_WEIGHTS, RiskActionType } from '../types/risk-detection';
import logger from './logger';
import { env } from './env';

/**
 * Load risk weight configuration from environment or use defaults
 */
export function loadRiskWeightConfig(): RiskWeightConfig {
  const highAction = (process.env.RISK_ACTION_HIGH as RiskActionType) || 'warn';
  const mediumAction = (process.env.RISK_ACTION_MEDIUM as RiskActionType) || 'warn';

  const config: RiskWeightConfig = {
    callRateVsBaseline: {
      none: parseInt(process.env.RISK_WEIGHT_CALL_RATE_NONE || '0', 10),
      medium: parseInt(process.env.RISK_WEIGHT_CALL_RATE_MEDIUM || '5', 10),
      high: parseInt(process.env.RISK_WEIGHT_CALL_RATE_HIGH || '10', 10),
    },
    spendVelocityVsCap: {
      none: parseInt(process.env.RISK_WEIGHT_SPEND_VELOCITY_NONE || '0', 10),
      medium: parseInt(process.env.RISK_WEIGHT_SPEND_VELOCITY_MEDIUM || '5', 10),
      high: parseInt(process.env.RISK_WEIGHT_SPEND_VELOCITY_HIGH || '10', 10),
    },
    routeMixShift: {
      none: parseInt(process.env.RISK_WEIGHT_ROUTE_MIX_NONE || '0', 10),
      medium: parseInt(process.env.RISK_WEIGHT_ROUTE_MIX_MEDIUM || '5', 10),
      high: parseInt(process.env.RISK_WEIGHT_ROUTE_MIX_HIGH || '10', 10),
    },
    firstTimeProvider: {
      none: parseInt(process.env.RISK_WEIGHT_FIRST_TIME_PROVIDER_NONE || '0', 10),
      high: parseInt(process.env.RISK_WEIGHT_FIRST_TIME_PROVIDER_HIGH || '10', 10),
    },
    dormantKeyActivity: {
      none: parseInt(process.env.RISK_WEIGHT_DORMANT_KEY_NONE || '0', 10),
      medium: parseInt(process.env.RISK_WEIGHT_DORMANT_KEY_MEDIUM || '5', 10),
      high: parseInt(process.env.RISK_WEIGHT_DORMANT_KEY_HIGH || '10', 10),
    },
    actionPolicy: {
      highRiskAction: isValidAction(highAction) ? highAction : 'warn',
      mediumRiskAction: isValidAction(mediumAction) ? mediumAction : 'warn',
      notifyPrincipal: process.env.RISK_NOTIFY_PRINCIPAL !== 'false',
    },
    consecutiveFailures: {
      none: parseInt(env.RISK_WEIGHT_CONSECUTIVE_NONE || '0', 10),
      medium: parseInt(env.RISK_WEIGHT_CONSECUTIVE_MEDIUM || '5', 10),
      high: parseInt(env.RISK_WEIGHT_CONSECUTIVE_HIGH || '10', 10),
    },
    balanceProjection: {
      sufficient: parseInt(env.RISK_WEIGHT_BALANCE_SUFFICIENT || '0', 10),
      low: parseInt(env.RISK_WEIGHT_BALANCE_LOW || '5', 10),
      insufficient: parseInt(env.RISK_WEIGHT_BALANCE_INSUFFICIENT || '10', 10),
    },
    approvalExpiration: {
      valid: parseInt(env.RISK_WEIGHT_APPROVAL_VALID || '0', 10),
      expired: parseInt(env.RISK_WEIGHT_APPROVAL_EXPIRED || '10', 10),
    },
  };

  if (!validateRiskWeightConfig(config)) {
    logger.warn('Invalid risk weight configuration, using defaults');
    return getDefaultRiskWeightConfig();
  }

  logger.info('Risk weight configuration loaded', config);
  return config;
}

function isValidAction(action: string): action is RiskActionType {
  return action === 'warn' || action === 'throttle' || action === 'require_reauthorization' || action === 'none';
}

/**
 * Get default risk weight configuration
 */
export function getDefaultRiskWeightConfig(): RiskWeightConfig {
  return { ...DEFAULT_RISK_WEIGHTS };
}

/**
 * Validate risk weight configuration
 */
function validateRiskWeightConfig(config: RiskWeightConfig): boolean {
  const allWeights = [
    config.callRateVsBaseline.none,
    config.callRateVsBaseline.medium,
    config.callRateVsBaseline.high,
    config.spendVelocityVsCap.none,
    config.spendVelocityVsCap.medium,
    config.spendVelocityVsCap.high,
    config.routeMixShift.none,
    config.routeMixShift.medium,
    config.routeMixShift.high,
    config.firstTimeProvider.none,
    config.firstTimeProvider.high,
    config.dormantKeyActivity.none,
    config.dormantKeyActivity.medium,
    config.dormantKeyActivity.high,
  ];

  for (const weight of allWeights) {
    if (typeof weight !== 'number' || weight < 0 || isNaN(weight)) {
      logger.error('Invalid weight value:', weight);
      return false;
    }
  }

  return true;
}

/**
 * Export configured instance
 */
export const riskWeightConfig = loadRiskWeightConfig();

