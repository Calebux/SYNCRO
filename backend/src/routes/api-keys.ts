import { Router, Response } from 'express';
import crypto from 'crypto';
import { supabase } from '../config/database';
import { AuthenticatedRequest, requireScope } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import logger from '../config/logger';
import { createApiKeySchema } from '../schemas/api-key';
import { NotFoundError, BadRequestError } from '../errors';
import { auditApiKeyEvent } from '../services/audit-service';
import { createApiKeyLimiter } from '../middleware/rate-limit-factory';

const router: Router = Router();


function generateApiKey(): { key: string; hash: string } {
  const key = `sk_${crypto.randomBytes(32).toString('hex')}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  return { key, hash };
}

/**
 * POST /api/keys
 * Create a new API key
 */
router.post(
  '/',
  createApiKeyLimiter(),
  requireRole('owner', 'admin'),
  requireScope('subscriptions:write'),
  validate(createApiKeySchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { name, scopes } = req.body;
      const { key, hash } = generateApiKey();

      const { error } = await supabase.from('api_keys').insert([
        {
          user_id: req.user.id,
          service_name: name,
          key_hash: hash,
          scopes,
          revoked: false,
          last_used_at: null,
          request_count: 0,
        },
      ]);

      if (error) {
        logger.error('Failed to create API key', { error });
        return res.status(500).json({ error: 'Failed to create API key' });
      }

      await auditApiKeyEvent('api_key.created', req.user.id, {
        keyName: name,
        scopes,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return res.status(201).json({ success: true, key, scopes });
    } catch (error) {
      logger.error('Create API key error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  },
);

/**
 * GET /api/keys
 * List API keys for the authenticated user
 */
router.get('/', requireRole('owner', 'admin'), requireScope('subscriptions:read'), async (req: AuthenticatedRequest, res: Response) => {
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, service_name, scopes, revoked, created_at, updated_at, last_used_at, request_count')
    .eq('user_id', req.user!.id)
    .order('created_at', { ascending: false });

  if (error) throw error;

  res.json({ success: true, data });
});

/**
 * DELETE /api/keys/:id
 * Revoke an API key
 */
router.delete('/:id', requireRole('owner', 'admin'), requireScope('subscriptions:write'), async (req: AuthenticatedRequest, res: Response) => {
  const { data: existingKey, error: fetchError } = await supabase
    .from('api_keys')
    .select('id')
    .eq('id', req.params.id)
    .eq('user_id', req.user!.id)
    .maybeSingle();

  if (fetchError || !existingKey) {
    throw new NotFoundError('API key not found');
  }

  const { error } = await supabase
    .from('api_keys')
    .update({ revoked: true, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('user_id', req.user!.id);

  if (error) throw error;

  await auditApiKeyEvent('api_key.revoked', req.user!.id, {
    keyId: req.params.id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  res.json({ success: true, message: 'API key revoked' });
});

/**
 * GET /api/keys/:id/usage
 * Get usage stats for an API key
 */
router.get('/:id/usage', requireRole('owner', 'admin'), requireScope('subscriptions:read'), async (req: AuthenticatedRequest, res: Response) => {
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, service_name, scopes, revoked, created_at, updated_at, last_used_at, request_count')
    .eq('id', req.params.id)
    .eq('user_id', req.user!.id)
    .maybeSingle();

  if (error || !data) {
    throw new NotFoundError('API key not found');
  }

  res.json({ success: true, data });
});

/**
 * POST /api/keys/:id/rotate
 * Atomically revoke an existing key and issue a replacement with the same
 * name and scopes. The old key stops working immediately; the new plaintext
 * key is returned once and never stored.
 */
router.post(
  '/:id/rotate',
  requireRole('owner', 'admin'),
  requireScope('subscriptions:write'),
  async (req: AuthenticatedRequest, res: Response) => {
    const { data: existing, error: fetchError } = await supabase
      .from('api_keys')
      .select('id, service_name, scopes, revoked')
      .eq('id', req.params.id)
      .eq('user_id', req.user!.id)
      .maybeSingle();

    if (fetchError || !existing) {
      throw new NotFoundError('API key not found');
    }

    if (existing.revoked) {
      throw new BadRequestError('Cannot rotate a revoked API key');
    }

    const { key: newKey, hash: newHash } = generateApiKey();

    // Revoke the old key
    const { error: revokeError } = await supabase
      .from('api_keys')
      .update({ revoked: true, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('user_id', req.user!.id);

    if (revokeError) {
      logger.error('Failed to revoke old API key during rotation', { error: revokeError });
      return res.status(500).json({ error: 'Internal server error' });
    }

    // Insert replacement key
    const { error: insertError } = await supabase.from('api_keys').insert([
      {
        user_id: req.user!.id,
        service_name: existing.service_name,
        key_hash: newHash,
        scopes: existing.scopes,
        revoked: false,
        last_used_at: null,
        request_count: 0,
      },
    ]);

    if (insertError) {
      logger.error('Failed to insert replacement API key during rotation', { error: insertError });
      // Attempt to un-revoke the original to avoid a total lockout
      await supabase
        .from('api_keys')
        .update({ revoked: false, updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .eq('user_id', req.user!.id);
      return res.status(500).json({ error: 'Internal server error' });
    }

    await auditApiKeyEvent('api_key.rotated', req.user!.id, {
      oldKeyId: req.params.id,
      keyName: existing.service_name,
      scopes: existing.scopes,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({ success: true, key: newKey, scopes: existing.scopes });
  },
);

export default router;
