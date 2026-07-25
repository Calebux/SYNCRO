import crypto from 'crypto';
import { supabase } from '../config/database';
import logger from '../config/logger';
import { requestContextStorage } from '../middleware/requestContext';
import { env } from '../config/env';
import {
  PRIVACY_FLAGS_CONFIG,
  PrivacyFlag,
} from '../../../shared/src/blockchain-flags';

export class PrivacyService {
  /**
   * Derive a 32-byte key for a user using HMAC-SHA256 of their userId with the system encryption key.
   */
  getUserDerivedKey(userId: string): Buffer {
    const systemKeySource = env.ENCRYPTION_KEY || env.JWT_SECRET || 'fallback-system-secret-key';
    const systemKey = crypto.createHash('sha256').update(systemKeySource).digest();
    return crypto.createHmac('sha256', systemKey).update(userId).digest();
  }

  /**
   * Check if a global privacy flag is active (via database overrides or env vars).
   */
  async isGlobalFlagEnabled(flag: PrivacyFlag): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('global_privacy_flags')
        .select('enabled')
        .eq('flag_name', flag)
        .single();
      
      if (!error && data) {
        return !!data.enabled;
      }
    } catch (err) {
      logger.warn(`Failed to fetch global privacy flag ${flag} from database, falling back: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Fallback to env var
    const envVal = process.env[flag];
    if (envVal !== undefined) {
      return envVal === 'true';
    }

    // Fallback to default config
    return PRIVACY_FLAGS_CONFIG[flag]?.default ?? false;
  }

  /**
   * Asynchronous check for both global and per-user privacy flags.
   */
  async isPrivacyFeatureEnabled(userId: string | null | undefined, flag: PrivacyFlag): Promise<boolean> {
    const config = PRIVACY_FLAGS_CONFIG[flag];
    if (!config) {
      return false;
    }

    if (config.scope === 'global') {
      return await this.isGlobalFlagEnabled(flag);
    }

    // Per-user flag
    if (!userId) {
      // If no user context, fallback to global default
      return config.default;
    }

    try {
      const { data, error } = await supabase
        .from('privacy_preferences')
        .select('*')
        .eq('user_id', userId)
        .single();
      
      if (!error && data) {
        const dbKey = flag.replace('PRIVACY_', '').toLowerCase();
        if (data[dbKey] !== undefined) {
          return !!data[dbKey];
        }
      }
    } catch (err) {
      logger.warn(`Failed to fetch privacy preferences for user ${userId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Fallback to global config default
    return config.default;
  }

  /**
   * Synchronous check leveraging AsyncLocalStorage request context cache.
   * If context is not found, fallback to checking environment variables/defaults.
   */
  isPrivacyFeatureEnabledSync(flag: PrivacyFlag): boolean {
    const store = requestContextStorage.getStore();
    const config = PRIVACY_FLAGS_CONFIG[flag];
    if (!config) {
      return false;
    }

    if (config.scope === 'global') {
      const envVal = process.env[flag];
      if (envVal !== undefined) {
        return envVal === 'true';
      }
      return config.default;
    }

    // Per-user flag checked in current request context
    if (store && store.privacyPreferences) {
      const dbKey = flag.replace('PRIVACY_', '').toLowerCase();
      if (store.privacyPreferences[dbKey] !== undefined) {
        return !!store.privacyPreferences[dbKey];
      }
    }

    // If context check was not possible, check process.env or fallback to default
    const envVal = process.env[flag];
    if (envVal !== undefined) {
      return envVal === 'true';
    }

    return config.default;
  }
}

export const privacyService = new PrivacyService();
export default privacyService;
