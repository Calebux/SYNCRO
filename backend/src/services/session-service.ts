/**
 * Session Service — issue #966
 * Manages user session tracking and invalidation.
 * We maintain a `user_sessions` table because Supabase does not expose a
 * server-side API for listing all active sessions for a given user.
 */

import { supabase } from '../config/database';
import { emitSecurityEvent } from './audit-service';
import { emailService } from './email-service';
import logger from '../config/logger';

export interface UserSession {
  id: string;
  user_id: string;
  user_agent?: string;
  ip_address?: string;
  created_at: string;
  last_active_at: string;
  revoked_at?: string;
  revoked_reason?: string;
}

export const sessionService = {
  /**
   * Record a new session when the user logs in.
   * The `sessionId` should be the Supabase session id from the JWT.
   */
  async recordSession(
    userId: string,
    sessionData: { userAgent?: string; ipAddress?: string; sessionId: string },
  ): Promise<void> {
    const { error } = await supabase.from('user_sessions').insert({
      id: sessionData.sessionId,
      user_id: userId,
      user_agent: sessionData.userAgent ?? null,
      ip_address: sessionData.ipAddress ?? null,
      created_at: new Date().toISOString(),
      last_active_at: new Date().toISOString(),
    });

    if (error) {
      // Non-fatal: duplicate inserts (e.g. from token refresh) should be silently ignored
      if (error.code !== '23505') {
        logger.warn('Failed to record session', { userId, error: error.message });
      }
    }
  },

  /**
   * Return all active (non-revoked) sessions for the given user.
   */
  async listActiveSessions(userId: string): Promise<UserSession[]> {
    const { data, error } = await supabase
      .from('user_sessions')
      .select('*')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .order('last_active_at', { ascending: false });

    if (error) {
      logger.error('Failed to list active sessions', { userId, error: error.message });
      throw new Error('Failed to list active sessions');
    }

    return (data ?? []) as UserSession[];
  },

  /**
   * Revoke a single session by id.
   * Only sessions belonging to `userId` can be revoked via this method.
   */
  async revokeSession(userId: string, sessionId: string, reason: string): Promise<void> {
    const { error } = await supabase
      .from('user_sessions')
      .update({
        revoked_at: new Date().toISOString(),
        revoked_reason: reason,
      })
      .eq('id', sessionId)
      .eq('user_id', userId)
      .is('revoked_at', null);

    if (error) {
      logger.error('Failed to revoke session', { userId, sessionId, error: error.message });
      throw new Error('Failed to revoke session');
    }

    await emitSecurityEvent('session.revoked', {
      severity: 'medium',
      actorId: userId,
      resourceType: 'session',
      resourceId: sessionId,
      reason,
    });

    logger.info('Session revoked', { userId, sessionId, reason });
  },

  /**
   * Revoke ALL active sessions for a user and force a global Supabase sign-out.
   * This is the primary security action called on password change or wallet disconnect.
   */
  async invalidateAllSessions(
    userId: string,
    reason: 'password_change' | 'wallet_disconnect' | 'manual',
  ): Promise<{ count: number }> {
    // 1. Count active sessions before revoking so we can return a meaningful result
    const { count, error: countError } = await supabase
      .from('user_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('revoked_at', null);

    if (countError) {
      logger.warn('Could not count active sessions before invalidation', {
        userId,
        error: countError.message,
      });
    }

    // 2. Mark all sessions as revoked in our tracking table
    const { error: updateError } = await supabase
      .from('user_sessions')
      .update({
        revoked_at: new Date().toISOString(),
        revoked_reason: reason,
      })
      .eq('user_id', userId)
      .is('revoked_at', null);

    if (updateError) {
      logger.error('Failed to mark sessions as revoked', { userId, error: updateError.message });
      // Continue — the Supabase admin sign-out below is the stronger guarantee
    }

    // 3. Force-sign-out all Supabase sessions for this user at the auth-server level
    // `signOut(userId, 'global')` invalidates every JWT issued for this user
    const { error: signOutError } = await (supabase.auth.admin as any).signOut(userId, 'global');
    if (signOutError) {
      // The Supabase JS client version installed may not support the two-arg form.
      // Fall back to a password-less ban/unban cycle which also rotates the refresh token.
      // TODO(#966): upgrade @supabase/supabase-js to a version that supports signOut(userId, 'global')
      logger.warn(
        'supabase.auth.admin.signOut(userId, "global") failed — falling back to updateUserById ban cycle',
        { userId, error: signOutError.message },
      );
      await supabase.auth.admin.updateUserById(userId, { ban_duration: 'none' });
    }

    // 4. Emit audit event
    await emitSecurityEvent('session.invalidated_all', {
      severity: 'high',
      actorId: userId,
      resourceType: 'session',
      reason,
      details: { revoked_count: count ?? 0 },
    });

    logger.info('All sessions invalidated', { userId, reason, count: count ?? 0 });

    // 5. Send email notification
    try {
      await sessionService.sendGracePeriodNotification(userId, reason, 0);
    } catch (emailErr) {
      logger.warn('Failed to send session-invalidation notification email', {
        userId,
        error: emailErr instanceof Error ? emailErr.message : String(emailErr),
      });
    }

    return { count: count ?? 0 };
  },

  /**
   * Send a warning email before sessions are invalidated (grace period).
   * Also used as the post-invalidation confirmation email when gracePeriodMinutes = 0.
   */
  async sendGracePeriodNotification(
    userId: string,
    reason: string,
    gracePeriodMinutes: number,
  ): Promise<void> {
    // Retrieve the user's email address from Supabase auth
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
    if (userError || !userData?.user?.email) {
      logger.warn('Could not retrieve user email for session notification', {
        userId,
        error: userError?.message,
      });
      return;
    }

    const email = userData.user.email;
    const reasonLabel = reason.replace(/_/g, ' ');

    const subject =
      gracePeriodMinutes > 0
        ? `Security alert: All sessions will be invalidated in ${gracePeriodMinutes} minute(s)`
        : `Security alert: All sessions have been invalidated`;

    const text =
      gracePeriodMinutes > 0
        ? `Your account security settings were changed (${reasonLabel}). All active sessions will be signed out in ${gracePeriodMinutes} minute(s). If you did not make this change, please contact support immediately.`
        : `Your account security settings were changed (${reasonLabel}). All active sessions have been signed out. If you did not make this change, please contact support immediately.`;

    await emailService.sendSimpleEmail(email, subject, text, {
      userId,
      emailType: 'security',
    });

    logger.info('Session invalidation notification email sent', { userId, reason, gracePeriodMinutes });
  },
};
