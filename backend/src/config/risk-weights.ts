/**
 * Risk Weight Configuration
 * Centralized configuration for risk factor weights
 */

import { RiskWeightConfig } from '../types/risk-detection';
import logger from './logger';
import { env } from './env';

/**
 * Load risk weight configuration from environment or use defaults
 */
export function loadRiskWeightConfig(): RiskWeightConfig {
  const config: RiskWeightConfig = {
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

  // Validate configuration
  if (!validateRiskWeightConfig(config)) {
    logger.warn('Invalid risk weight configuration, using defaults');
    return getDefaultRiskWeightConfig();
  }

  logger.info('Risk weight configuration loaded', config);
  return config;
}

/**
 * Get default risk weight configuration
 */
export function getDefaultRiskWeightConfig(): RiskWeightConfig {
  return {
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
}

/**
 * Validate risk weight configuration
 */
function validateRiskWeightConfig(config: RiskWeightConfig): boolean {
  // Check that all weights are non-negative numbers
  const allWeights = [
    config.consecutiveFailures.none,
    config.consecutiveFailures.medium,
    config.consecutiveFailures.high,
    config.balanceProjection.sufficient,
    config.balanceProjection.low,
    config.balanceProjection.insufficient,
    config.approvalExpiration.valid,
    config.approvalExpiration.expired,
  ];

  for (const weight of allWeights) {
    if (typeof weight !== 'number' || weight < 0 || isNaN(weight)) {
      logger.error('Invalid weight value:', weight);
      return false;
    }
  }

  // Check that weights follow logical ordering
  if (config.consecutiveFailures.none > config.consecutiveFailures.medium ||
      config.consecutiveFailures.medium > config.consecutiveFailures.high) {
    logger.error('Consecutive failures weights must be in ascending order');
    return false;
  }

  if (config.balanceProjection.sufficient > config.balanceProjection.low ||
      config.balanceProjection.low > config.balanceProjection.insufficient) {
    logger.error('Balance projection weights must be in ascending order');
    return false;
  }

  if (config.approvalExpiration.valid > config.approvalExpiration.expired) {
    logger.error('Approval expiration weights must be in ascending order');
    return false;
  }

  return true;
}

/**
 * Export configured instance
 */
export const riskWeightConfig = loadRiskWeightConfig();
