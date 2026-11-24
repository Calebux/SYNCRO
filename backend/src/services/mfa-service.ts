import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import * as speakeasy from 'speakeasy';
import { supabase } from '../config/database';
import logger from '../config/logger';

const BCRYPT_COST = 12;
const CODE_COUNT = 10;
const TOTP_WINDOW = 1; // Allow 1 step before/after (±30 seconds)
const TOTP_STEP = 30; // 30-second time windows

export class RecoveryCodeService {
  /**
   * Generate 10 unique recovery codes for a user.
   * Hashes each with bcrypt (cost 12) and bulk-inserts into recovery_codes.
   * Returns the plain-text codes (shown to the user exactly once).
   */
  async generate(userId: string): Promise<string[]> {
    const plainCodes: string[] = Array.from({ length: CODE_COUNT }, () =>
      crypto.randomBytes(10).toString('hex')
    );

    const hashed = await Promise.all(
      plainCodes.map((code) => bcrypt.hash(code, BCRYPT_COST))
    );

    const rows = hashed.map((code_hash: string) => ({ user_id: userId, code_hash }));

    const { error } = await supabase.from('recovery_codes').insert(rows);

    if (error) {
      logger.error('Failed to insert recovery codes:', error);
      throw new Error(`Failed to store recovery codes: ${error.message}`);
    }

    return plainCodes;
  }

  /**
   * Verify a plain-text recovery code against stored hashes for the user.
   * On match, marks the code as used (sets used_at = now()).
   * Returns true if a valid unused code matched, false otherwise.
   */
  async verify(userId: string, code: string): Promise<boolean> {
    const { data: rows, error } = await supabase
      .from('recovery_codes')
      .select('id, code_hash')
      .eq('user_id', userId)
      .is('used_at', null);

    if (error) {
      logger.error('Failed to fetch recovery codes:', error);
      return false;
    }

    if (!rows || rows.length === 0) {
      return false;
    }

    for (const row of rows) {
      const match = await bcrypt.compare(code, row.code_hash);
      if (match) {
        const { error: updateError } = await supabase
          .from('recovery_codes')
          .update({ used_at: new Date().toISOString() })
          .eq('id', row.id);

        if (updateError) {
          logger.error('Failed to mark recovery code as used:', updateError);
        }

        return true;
      }
    }

    return false;
  }

  /**
   * Delete all recovery codes for a user (called when 2FA is disabled).
   */
  async invalidateAll(userId: string): Promise<void> {
    const { error } = await supabase
      .from('recovery_codes')
      .delete()
      .eq('user_id', userId);

    if (error) {
      logger.error('Failed to delete recovery codes:', error);
      throw new Error(`Failed to invalidate recovery codes: ${error.message}`);
    }
  }
}

export const recoveryCodeService = new RecoveryCodeService();

/**
 * TOTP Service for verifying time-based one-time passwords
 * with replay prevention and single-use enforcement.
 */
export class TotpService {
  /**
   * Verify a TOTP code for a user with replay prevention.
   * Ensures codes are single-use within their time window.
   * 
   * @param userId - The user's ID
   * @param secret - The user's TOTP secret (base32 encoded)
   * @param token - The 6-digit TOTP code to verify
   * @returns true if valid and unused, false otherwise
   */
  async verify(userId: string, secret: string, token: string): Promise<boolean> {
    try {
      // Step 1: Verify the TOTP code is mathematically valid
      const isValid = speakeasy.totp.verify({
        secret,
        encoding: 'base32',
        token,
        window: TOTP_WINDOW, // Allow ±30 seconds clock drift
        step: TOTP_STEP,
      });

      if (!isValid) {
        logger.debug('TOTP verification failed: invalid code', { userId });
        return false;
      }

      // Step 2: Determine which time window this code belongs to
      const currentTime = Math.floor(Date.now() / 1000);
      const timeWindow = Math.floor(currentTime / TOTP_STEP);

      // Step 3: Check if this code was already used in this time window
      const codeHash = crypto
        .createHash('sha256')
        .update(`${userId}:${token}:${timeWindow}`)
        .digest('hex');

      const { data: existingCode, error: lookupError } = await supabase
        .from('totp_used_codes')
        .select('id')
        .eq('user_id', userId)
        .eq('code_hash', codeHash)
        .eq('time_window', timeWindow)
        .maybeSingle();

      if (lookupError) {
        logger.error('Failed to check TOTP used codes:', lookupError);
        return false;
      }

      if (existingCode) {
        logger.warn('TOTP replay attempt detected', { userId, timeWindow });
        return false; // Code already used (replay attack)
      }

      // Step 4: Mark the code as used
      const expiresAt = new Date((timeWindow + 4) * TOTP_STEP * 1000); // Expire after 2 minutes

      const { error: insertError } = await supabase
        .from('totp_used_codes')
        .insert({
          user_id: userId,
          code_hash: codeHash,
          time_window: timeWindow,
          expires_at: expiresAt.toISOString(),
        });

      if (insertError) {
        // Check if it's a unique constraint violation (concurrent replay attempt)
        if (insertError.code === '23505' || insertError.message?.includes('unique')) {
          logger.warn('TOTP concurrent replay attempt detected', { userId, timeWindow });
          return false; // Code already used (concurrent request)
        }
        
        logger.error('Failed to mark TOTP code as used:', insertError);
        // Don't fail the verification if we can't track it for other reasons
        // This is a security tradeoff, but better than blocking legitimate users
        return true;
      }

      logger.info('TOTP verification successful', { userId, timeWindow });
      return true;
    } catch (error) {
      logger.error('TOTP verification error:', error);
      return false;
    }
  }

  /**
   * Clean up expired TOTP used codes for a user.
   * This can be called periodically or before verification.
   */
  async cleanupExpired(userId?: string): Promise<void> {
    try {
      let query = supabase
        .from('totp_used_codes')
        .delete()
        .lt('expires_at', new Date().toISOString());

      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { error } = await query;

      if (error) {
        logger.error('Failed to cleanup expired TOTP codes:', error);
      }
    } catch (error) {
      logger.error('TOTP cleanup error:', error);
    }
  }

  /**
   * Generate a new TOTP secret for a user.
   * Returns the secret and otpauth URL for QR code generation.
   */
  generateSecret(userEmail: string): { secret: string; otpauth_url: string } {
    const secret = speakeasy.generateSecret({
      name: `Syncro (${userEmail})`,
      issuer: 'Syncro',
      length: 32,
    });

    return {
      secret: secret.base32!,
      otpauth_url: secret.otpauth_url!,
    };
  }
}

export const totpService = new TotpService();
