import { Request, Response } from 'express';
import { supabase } from '../config/database';
import { AuthenticatedRequest } from '../middleware/auth';
import { validateRequest } from '../utils/validation';
import { userProfileUpdateSchema } from '../schemas/user-profile';
import logger from '../config/logger';
import { roleService } from '../services/role-service';
import { createStealthAddressLimiter } from '../middleware/rate-limit-factory';
import { z } from 'zod';
import {
  createDescriptor,
  auth,
  rateLimit,
  validate,
  audit,
  commonSchemas,
} from '../router/descriptors';

const stealthMetaAddressSchema = z.object({
  stealthMetaAddress: z.string().min(1),
});

const passwordChangeSchema = z.object({
  newPassword: z.string().min(8, 'newPassword must be at least 8 characters'),
});

export const userRoutes = [
  createDescriptor({
    method: 'get',
    path: '/user/role',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
      try {
        const userId = req.user!.id;
        const role = await roleService.getUserRole(userId);
        return res.status(200).json({ user_id: userId, role });
      } catch (error) {
        logger.error('Error getting user role:', error);
        return res.status(500).json({ success: false, error: 'Failed to get user role' });
      }
    },
    auth: auth.user(),
    summary: 'Get current user role',
    tags: ['User'],
    audit: audit.read('user_role'),
  }),

  createDescriptor({
    method: 'post',
    path: '/user/stealth-meta-address',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
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

        const { error } = await supabase
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
    },
    auth: auth.user(),
    rateLimit: rateLimit.standard('createStealthAddressLimiter'),
    validation: [validate.body(stealthMetaAddressSchema)],
    summary: 'Save stealth meta-address',
    tags: ['User'],
    audit: audit.update('stealth_meta_address', { includeRequestBody: true }),
  }),

  createDescriptor({
    method: 'get',
    path: '/user/stealth-payments',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { stealthScanner } = await import('../services/stealth-scanner');
        const payments = await stealthScanner.scanForPayments(req.user!.id);
        return res.status(200).json({ success: true, data: payments });
      } catch (error) {
        logger.error('Error scanning stealth payments:', error);
        return res.status(500).json({ success: false, error: 'Failed to scan stealth payments' });
      }
    },
    auth: auth.user(),
    summary: 'Scan for stealth payments',
    tags: ['User'],
    audit: audit.read('stealth_payments'),
  }),

  createDescriptor({
    method: 'get',
    path: '/user/export-data',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
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
          supabase.from('profiles').select('*').eq('id', userId).single(),
          supabase.from('subscriptions').select('*').eq('user_id', userId),
          supabase.from('email_accounts').select('*').eq('user_id', userId),
          supabase.from('team_members').select('*').eq('user_id', userId),
          supabase.from('notifications').select('*').eq('user_id', userId),
          supabase.from('tags').select('*').eq('user_id', userId),
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
    },
    auth: auth.user(),
    summary: 'Export all user data (GDPR)',
    tags: ['User'],
    audit: audit.read('user_data_export', { includeResponseBody: true }),
  }),

  createDescriptor({
    method: 'delete',
    path: '/user/account',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
      try {
        const userId = req.user!.id;

        const tables = [
          'notifications',
          'tags',
          'email_accounts',
          'team_members',
          'subscriptions',
          'profiles',
        ];

        for (const table of tables) {
          const { error } = await supabase.from(table).delete().eq('user_id', userId);
          if (error) {
            logger.error(`Error deleting from ${table} for user ${userId}:`, error);
          }
        }

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
    },
    auth: auth.user(),
    summary: 'Delete user account and all data (GDPR)',
    tags: ['User'],
    audit: audit.delete('user_account', { severity: 'high' }),
  }),

  createDescriptor({
    method: 'get',
    path: '/user/profile',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
      try {
        const userId = req.user!.id;
        const { data: profile, error } = await supabase
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
    },
    auth: auth.user(),
    summary: 'Get current user profile',
    tags: ['User'],
    audit: audit.read('user_profile'),
  }),

  createDescriptor({
    method: 'put',
    path: '/user/profile',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
      try {
        const userId = req.user!.id;
        const validatedData = validateRequest(userProfileUpdateSchema, req.body);

        const { data: profile, error } = await supabase
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
    },
    auth: auth.user(),
    validation: [validate.body(userProfileUpdateSchema)],
    summary: 'Update user profile',
    tags: ['User'],
    audit: audit.update('user_profile', { includeRequestBody: true, includeResponseBody: true }),
  }),

  createDescriptor({
    method: 'post',
    path: '/user/password-change',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
      try {
        const userId = req.user!.id;
        const { newPassword } = req.body as { newPassword?: string };

        if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
          return res.status(400).json({ success: false, error: 'newPassword must be at least 8 characters' });
        }

        const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
          password: newPassword,
        });

        if (updateError) {
          logger.error('Error updating password:', updateError);
          return res.status(500).json({ success: false, error: 'Failed to update password' });
        }

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
    },
    auth: auth.user(),
    validation: [validate.body(passwordChangeSchema)],
    summary: 'Change user password',
    tags: ['User'],
    audit: audit.update('user_password', { severity: 'high' }),
  }),

  createDescriptor({
    method: 'post',
    path: '/user/wallet-disconnect',
    version: 'v1',
    handler: async (req: AuthenticatedRequest, res: Response) => {
      try {
        const userId = req.user!.id;

        const { error: profileError } = await supabase
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
    },
    auth: auth.user(),
    summary: 'Disconnect wallet and invalidate sessions',
    tags: ['User'],
    audit: audit.update('wallet_disconnect', { severity: 'high' }),
  }),
];