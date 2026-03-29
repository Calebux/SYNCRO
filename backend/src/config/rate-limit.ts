import logger from './logger';

export interface RateLimitConfig {
  windowMs: number;
  max: number;
  message: { error: string };
  standardHeaders: boolean;
  legacyHeaders: boolean;
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
    },
  });

  return config;
}

// Export singleton configuration
export const rateLimitConfig = loadRateLimitConfig();