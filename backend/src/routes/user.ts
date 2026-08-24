/**
 * User Data Routes — GDPR compliance (issue #294)
 * GET  /api/user/export-data  — download all personal data as JSON
 * DELETE /api/user/account    — cascade-delete all user data + auth record
 */

import express, { Response } from 'express';
import { supabase, databaseRepository, databaseRepository } from '../config/database';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { validateRequest } from '../utils/validation';
import { userProfileUpdateSchema } from '../schemas/user-profile';
import logger from '../config/logger';
import { roleService } from '../services/role-service';
import { createStealthAddressLimiter } from '../middleware/rate-limit-factory';

const router = express.Router();
router.use(authenticate);

/**
 * GET /api/user/role
 * Returns the current user's role from the authoritative source
 */
router.get('/role', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const role = await roleService.getUserRole(userId);

    return res.status(200).json({
      user_id: userId,
      role,
    });
  } catch (error) {
    logger.error('Error getting user role:', error);
    return res.status(500).json({ success: false, error: 'Failed to get user role' });
  }
});

router.post('/stealth-meta-address', createStealthAddressLimiter(), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { stealthMetaAddress } = req.body as { stealthMetaAddress?: string };

    if (!stealthMetaAddress || typeof stealthMetaAddress !== 'string') {
      return res.status(400).json({ success: false, error: 'stealthMetaAddress is required' });
    }

    const decoded = stealthMetaAddress.trim();
    const isValid = /^(syncro:stealth:v1):([0-9a-f]{64}):([0-9a-f]{64})$/i.test(decoded);
    if (!isValid) {
      return res.status(400).json({ success: false, error: 'Invalid stealth meta-address format' });
    }

    const { error } = await databaseRepository
      .from('profiles')
      .update({ stealth_meta_address: decoded, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (error) {
      logger.error('Error saving stealth meta-address:', error);
      return res.status(500).json({ success: false, error: 'Failed to save stealth meta-address' });
    }

    return res.status(200).json({ success: true, data: { stealthMetaAddress: decoded } });
  } catch (error) {
    logger.error('Error saving stealth meta-address:', error);
    return res.status(500).json({ success: false, error: 'Failed to save stealth meta-address' });
  }
});

router.get('/stealth-payments', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { stealthScanner } = await import('../services/stealth-scanner');
    const payments = await stealthScanner.scanForPayments(req.user!.id);
    return res.status(200).json({ success: true, data: payments });
  } catch (error) {
    logger.error('Error scanning stealth payments:', error);
    return res.status(500).json({ success: false, error: 'Failed to scan stealth payments' });
  }
});

/**
 * GET /api/user/export-data
 * Returns a JSON bundle of every record belonging to the authenticated user.
 */
router.get('/export-data', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const [
      { data: profile },
      { data: subscriptions },
      { data: emailAccounts },
      { data: teamMembers },
      { data: notifications },
      { data: tags },
    ] = await Promise.all([
      databaseRepository.from('profiles').select('*').eq('id', userId).single(),
      databaseRepository.from('subscriptions').select('*').eq('user_id', userId),
      databaseRepository.from('email_accounts').select('*').eq('user_id', userId),
      databaseRepository.from('team_members').select('*').eq('user_id', userId),
      databaseRepository.from('notifications').select('*').eq('user_id', userId),
      databaseRepository.from('tags').select('*').eq('user_id', userId),
    ]);

    const exportData = {
      exported_at: new Date().toISOString(),
      user_id: userId,
      profile,
      subscriptions: subscriptions ?? [],
      email_accounts: emailAccounts ?? [],
      team_members: teamMembers ?? [],
      notifications: notifications ?? [],
      tags: tags ?? [],
    };

    res.setHeader('Content-Disposition', 'attachment; filename="syncro-data-export.json"');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(exportData);
  } catch (error) {
    logger.error('Error exporting user data:', error);
    return res.status(500).json({ success: false, error: 'Failed to export data' });
  }
});

/**
 * DELETE /api/user/account
 * Cascade-deletes all records belonging to the user, then removes the auth account.
 */
router.delete('/account', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    // Delete user-owned rows from every related table (order respects FK constraints)
    const tables = [
      'notifications',
      'tags',
      'email_accounts',
      'team_members',
      'subscriptions',
      'profiles',
    ];

    for (const table of tables) {
      const { error } = await databaseRepository.from(table).delete().eq('user_id', userId);
      if (error) {
        logger.error(`Error deleting from ${table} for user ${userId}:`, error);
      }
    }

    // Remove the auth record using the service-role client
    const { error: authError } = await supabase.auth.admin.deleteUser(userId);
    if (authError) {
      logger.error('Error deleting auth user:', authError);
      return res.status(500).json({ success: false, error: 'Failed to delete account' });
    }

    logger.info('User account deleted (GDPR)', { user_id: userId });
    return res.status(200).json({ success: true, message: 'Account and all associated data have been deleted.' });
  } catch (error) {
    logger.error('Error deleting user account:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete account' });
  }
});

/**
 * GET /api/user/profile
 * Returns the current user's profile data.
 */
router.get('/profile', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { data: profile, error } = await databaseRepository
      .from('profiles')
      .select('id, display_name, company_name, plan_type, stealth_meta_address, created_at, updated_at')
      .eq('id', userId)
      .single();

    if (error) {
      logger.error('Error fetching user profile:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch profile' });
    }

    return res.status(200).json({ success: true, data: profile });
  } catch (error) {
    logger.error('Error fetching user profile:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch profile' });
  }
});

/**
 * PUT /api/user/profile
 * Update profile fields such as display name, company name, or stealth meta-address.
 */
router.put('/profile', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const validatedData = validateRequest(userProfileUpdateSchema, req.body);

    const { data: profile, error } = await databaseRepository
      .from('profiles')
      .update({
        ...validatedData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      logger.error('Error updating user profile:', error);
      return res.status(500).json({ success: false, error: 'Failed to update profile' });
    }

    return res.status(200).json({ success: true, data: profile });
  } catch (error) {
    logger.error('Error updating user profile:', error);
    return res.status(500).json({ success: false, error: 'Failed to update profile' });
  }
});

/**
 * POST /api/user/password-change
 * Updates the user's password and schedules session invalidation after a
 * 5-minute grace period so any other open tabs have time to save work.
 */
router.post('/password-change', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { newPassword } = req.body as { newPassword?: string };

    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'newPassword must be at least 8 characters' });
    }

    // Update password via Supabase admin API
    const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
      password: newPassword,
    });

    if (updateError) {
      logger.error('Error updating password:', updateError);
      return res.status(500).json({ success: false, error: 'Failed to update password' });
    }

    // Send a grace-period warning immediately, then invalidate after 5 minutes
    const { sessionService } = await import('../services/session-service');

    await sessionService.sendGracePeriodNotification(userId, 'password change', 5);

    setTimeout(() => {
      sessionService.invalidateAllSessions(userId, 'password_change').catch((err: unknown) => {
        logger.error('Error invalidating sessions after password change:', err);
      });
    }, 5 * 60 * 1000);

    logger.info('Password changed; sessions will be invalidated in 5 minutes', { userId });
    return res.status(200).json({
      success: true,
      message: 'Password updated. All sessions will be signed out in 5 minutes.',
    });
  } catch (error) {
    logger.error('Error changing password:', error);
    return res.status(500).json({ success: false, error: 'Failed to change password' });
  }
});

/**
 * POST /api/user/wallet-disconnect
 * Clears the Stellar wallet address from the user's profile and immediately
 * invalidates all sessions (wallet ownership is a security boundary).
 */
router.post('/wallet-disconnect', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const { error: profileError } = await databaseRepository
      .from('profiles')
      .update({ stellar_wallet_address: null, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (profileError) {
      logger.error('Error clearing wallet address:', profileError);
      return res.status(500).json({ success: false, error: 'Failed to disconnect wallet' });
    }

    const { sessionService } = await import('../services/session-service');
    await sessionService.invalidateAllSessions(userId, 'wallet_disconnect');

    logger.info('Wallet disconnected and all sessions invalidated', { userId });
    return res.status(200).json({
      success: true,
      message: 'Wallet disconnected and all sessions have been signed out.',
    });
  } catch (error) {
    logger.error('Error disconnecting wallet:', error);
    return res.status(500).json({ success: false, error: 'Failed to disconnect wallet' });
  }
});

export default router;
