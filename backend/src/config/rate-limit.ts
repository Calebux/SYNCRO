import logger from './logger';

export interface RateLimitConfig {
  windowMs: number;
  max: number;
  message: { error: string };
  standardHeaders: boolean;
  legacyHeaders: boolean;
}

export type SubscriptionTier = 'free' | 'pro' | 'enterprise';

export interface TierRateLimitConfig {
  windowMs: number;
  limits: Record<SubscriptionTier, number>;
  sensitiveMultiplier: number;
}

export const TIER_RATE_LIMIT_CONFIG: TierRateLimitConfig = {
  windowMs: 60 * 1000, // 1-minute sliding window
  limits: {
    free: 100,
    pro: 500,
    enterprise: 2000,
  },
  sensitiveMultiplier: 0.1, // 10% of normal limit for sensitive endpoints
};

export interface PrivacyRateLimitConfig {
  stealthAddress: RateLimitConfig & { windowHours: number };
  zkProof: RateLimitConfig & { windowMinutes: number };
  paymentChannel: {
    maxOpenChannels: number;
    maxStateUpdatesPerChannel: number;
    stateUpdate: RateLimitConfig & { windowHours: number };
  };
  settlementBatch: {
    maxBatchSize: number;
  };
  selectiveDisclosure: RateLimitConfig & { windowHours: number };
}

export interface RateLimitSettings {
  redis: {
    url?: string;
    enabled: boolean;
  };
  teamInvite: RateLimitConfig & {
    windowHours: number;
  };
  mfa: RateLimitConfig & {
    windowMinutes: number;
  };
  admin: RateLimitConfig & {
    windowHours: number;
  };
  simulation: RateLimitConfig & {
    windowHours: number;
  };
  privacy: PrivacyRateLimitConfig;
}

/**
 * Parse environment variable as integer with fallback to default
 */
function parseIntEnv(envVar: string | undefined, defaultValue: number): number {
  if (!envVar) return defaultValue;
  const parsed = parseInt(envVar, 10);
  if (isNaN(parsed) || parsed <= 0) {
    logger.warn(`Invalid rate limit configuration: ${envVar} is not a valid positive integer, using default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

/**
 * Parse environment variable as boolean with fallback to default
 */
function parseBooleanEnv(envVar: string | undefined, defaultValue: boolean): boolean {
  if (!envVar) return defaultValue;
  const lower = envVar.toLowerCase();
  if (lower === 'true' || lower === '1') return true;
  if (lower === 'false' || lower === '0') return false;
  logger.warn(`Invalid boolean configuration: ${envVar}, using default: ${defaultValue}`);
  return defaultValue;
}

/**
 * Load and validate rate limiting configuration from environment variables
 */
export function loadRateLimitConfig(): RateLimitSettings {
  // Redis configuration
  const redisUrl = process.env.RATE_LIMIT_REDIS_URL;
  const redisEnabled = parseBooleanEnv(process.env.RATE_LIMIT_REDIS_ENABLED, !!redisUrl);

  // Team invitation limits
  const teamInviteMax = parseIntEnv(process.env.RATE_LIMIT_TEAM_INVITE_MAX, 20);
  const teamInviteWindowHours = parseIntEnv(process.env.RATE_LIMIT_TEAM_INVITE_WINDOW_HOURS, 1);

  // MFA limits
  const mfaMax = parseIntEnv(process.env.RATE_LIMIT_MFA_MAX, 10);
  const mfaWindowMinutes = parseIntEnv(process.env.RATE_LIMIT_MFA_WINDOW_MINUTES, 15);

  // Admin limits
  const adminMax = parseIntEnv(process.env.RATE_LIMIT_ADMIN_MAX, 100);
  const adminWindowHours = parseIntEnv(process.env.RATE_LIMIT_ADMIN_WINDOW_HOURS, 1);

  // Simulation limits
  const simulationMax = parseIntEnv(process.env.RATE_LIMIT_SIMULATION_MAX, 5);
  const simulationWindowHours = parseIntEnv(process.env.RATE_LIMIT_SIMULATION_WINDOW_HOURS, 1);

  // Privacy feature rate limits
  const stealthAddressMax = parseIntEnv(process.env.RATE_LIMIT_STEALTH_ADDRESS_MAX, 100);
  const stealthAddressWindowHours = parseIntEnv(process.env.RATE_LIMIT_STEALTH_ADDRESS_WINDOW_HOURS, 1);

  const zkProofMax = parseIntEnv(process.env.RATE_LIMIT_ZK_PROOF_MAX, 10);
  const zkProofWindowMinutes = parseIntEnv(process.env.RATE_LIMIT_ZK_PROOF_WINDOW_MINUTES, 1);

  const paymentChannelMaxOpen = parseIntEnv(process.env.RATE_LIMIT_PAYMENT_CHANNEL_MAX_OPEN, 5);
  const paymentChannelMaxStateUpdates = parseIntEnv(process.env.RATE_LIMIT_PAYMENT_CHANNEL_MAX_STATE_UPDATES, 1000);
  const paymentChannelStateUpdateMax = parseIntEnv(process.env.RATE_LIMIT_PAYMENT_CHANNEL_STATE_UPDATE_RATE_MAX, 1000);
  const paymentChannelStateUpdateWindowHours = parseIntEnv(process.env.RATE_LIMIT_PAYMENT_CHANNEL_STATE_UPDATE_WINDOW_HOURS, 1);

  const settlementMaxBatchSize = parseIntEnv(process.env.RATE_LIMIT_SETTLEMENT_MAX_BATCH_SIZE, 50);

  const selectiveDisclosureMax = parseIntEnv(process.env.RATE_LIMIT_SELECTIVE_DISCLOSURE_MAX, 20);
  const selectiveDisclosureWindowHours = parseIntEnv(process.env.RATE_LIMIT_SELECTIVE_DISCLOSURE_WINDOW_HOURS, 24);

  const config: RateLimitSettings = {
    redis: {
      url: redisUrl,
      enabled: redisEnabled,
    },
    teamInvite: {
      windowMs: teamInviteWindowHours * 60 * 60 * 1000, // Convert hours to milliseconds
      windowHours: teamInviteWindowHours,
      max: teamInviteMax,
      message: { 
        error: `Too many team invitations. You can send up to ${teamInviteMax} invitations per ${teamInviteWindowHours} hour${teamInviteWindowHours > 1 ? 's' : ''}. Please try again later.` 
      },
      standardHeaders: true,
      legacyHeaders: false,
    },
    mfa: {
      windowMs: mfaWindowMinutes * 60 * 1000, // Convert minutes to milliseconds
      windowMinutes: mfaWindowMinutes,
      max: mfaMax,
      message: { 
        error: `Too many MFA attempts. You can make up to ${mfaMax} attempts per ${mfaWindowMinutes} minute${mfaWindowMinutes > 1 ? 's' : ''}. Please try again later.` 
      },
      standardHeaders: true,
      legacyHeaders: false,
    },
    admin: {
      windowMs: adminWindowHours * 60 * 60 * 1000, // Convert hours to milliseconds
      windowHours: adminWindowHours,
      max: adminMax,
      message: { 
        error: `Too many admin requests. You can make up to ${adminMax} requests per ${adminWindowHours} hour${adminWindowHours > 1 ? 's' : ''}. Please try again later.` 
      },
      standardHeaders: true,
      legacyHeaders: false,
    },
    simulation: {
      windowMs: simulationWindowHours * 60 * 60 * 1000, // Convert hours to milliseconds
      windowHours: simulationWindowHours,
      max: simulationMax,
      message: { 
        error: `Too many simulation requests. You can generate up to ${simulationMax} simulations per ${simulationWindowHours} hour${simulationWindowHours > 1 ? 's' : ''}. Please try again later.` 
      },
      standardHeaders: true,
      legacyHeaders: false,
    },
    privacy: {
      stealthAddress: {
        windowMs: stealthAddressWindowHours * 60 * 60 * 1000,
        windowHours: stealthAddressWindowHours,
        max: stealthAddressMax,
        message: {
          error: `Too many stealth address operations. You can perform up to ${stealthAddressMax} derivations per ${stealthAddressWindowHours} hour${stealthAddressWindowHours > 1 ? 's' : ''}. Please try again later.`,
        },
        standardHeaders: true,
        legacyHeaders: false,
      },
      zkProof: {
        windowMs: zkProofWindowMinutes * 60 * 1000,
        windowMinutes: zkProofWindowMinutes,
        max: zkProofMax,
        message: {
          error: `Too many ZK proof verification requests. You can verify up to ${zkProofMax} proofs per ${zkProofWindowMinutes} minute${zkProofWindowMinutes > 1 ? 's' : ''}. Please try again later.`,
        },
        standardHeaders: true,
        legacyHeaders: false,
      },
      paymentChannel: {
        maxOpenChannels: paymentChannelMaxOpen,
        maxStateUpdatesPerChannel: paymentChannelMaxStateUpdates,
        stateUpdate: {
          windowMs: paymentChannelStateUpdateWindowHours * 60 * 60 * 1000,
          windowHours: paymentChannelStateUpdateWindowHours,
          max: paymentChannelStateUpdateMax,
          message: {
            error: `Too many payment channel state updates. You can submit up to ${paymentChannelStateUpdateMax} updates per ${paymentChannelStateUpdateWindowHours} hour${paymentChannelStateUpdateWindowHours > 1 ? 's' : ''}. Please try again later.`,
          },
          standardHeaders: true,
          legacyHeaders: false,
        },
      },
      settlementBatch: {
        maxBatchSize: settlementMaxBatchSize,
      },
      selectiveDisclosure: {
        windowMs: selectiveDisclosureWindowHours * 60 * 60 * 1000,
        windowHours: selectiveDisclosureWindowHours,
        max: selectiveDisclosureMax,
        message: {
          error: `Too many selective disclosure proofs. You can generate up to ${selectiveDisclosureMax} proofs per ${selectiveDisclosureWindowHours} hour${selectiveDisclosureWindowHours > 1 ? 's' : ''}. Please try again later.`,
        },
        standardHeaders: true,
        legacyHeaders: false,
      },
    },
  };

  // Log configuration for operational visibility
  logger.info('Rate limiting configuration loaded', {
    redis: {
      enabled: config.redis.enabled,
      url: config.redis.url ? '[CONFIGURED]' : '[NOT_SET]',
    },
    limits: {
      teamInvite: `${config.teamInvite.max}/${config.teamInvite.windowHours}h`,
      mfa: `${config.mfa.max}/${config.mfa.windowMinutes}m`,
      admin: `${config.admin.max}/${config.admin.windowHours}h`,
      simulation: `${config.simulation.max}/${config.simulation.windowHours}h`,
    },
    privacy: {
      stealthAddress: `${config.privacy.stealthAddress.max}/${config.privacy.stealthAddress.windowHours}h`,
      zkProof: `${config.privacy.zkProof.max}/${config.privacy.zkProof.windowMinutes}m`,
      paymentChannel: {
        maxOpen: config.privacy.paymentChannel.maxOpenChannels,
        maxStateUpdates: config.privacy.paymentChannel.maxStateUpdatesPerChannel,
        stateUpdateRate: `${config.privacy.paymentChannel.stateUpdate.max}/${config.privacy.paymentChannel.stateUpdate.windowHours}h`,
      },
      settlementBatch: `max ${config.privacy.settlementBatch.maxBatchSize} tx/batch`,
      selectiveDisclosure: `${config.privacy.selectiveDisclosure.max}/${config.privacy.selectiveDisclosure.windowHours}h`,
    },
  });

  return config;
}

// Export singleton configuration
export const rateLimitConfig = loadRateLimitConfig();