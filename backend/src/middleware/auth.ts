import * as crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { supabase } from '../config/database';
import logger from '../config/logger';
import { setRequestUserId, setRequestPrivacyMode, setRequestPrivacyPreferences } from './requestContext';
import * as Sentry from '@sentry/node';

async function loadPrivacyPreferences(userId: string): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('privacy_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();
    
    if (!error && data) {
      setRequestPrivacyMode(!!data.privacy_mode);
      setRequestPrivacyPreferences(data);
    } else {
      setRequestPrivacyMode(false);
      setRequestPrivacyPreferences(null);
    }
  } catch (err) {
    logger.warn(`Failed to load privacy preferences for user ${userId}: ${err instanceof Error ? err.message : String(err)}`);
    setRequestPrivacyMode(false);
    setRequestPrivacyPreferences(null);
  }
}
import { roleService } from '../services/role-service';
import { auditApiKeyEvent, emitSecurityEvent } from '../services/audit-service';

export type UserRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email?: string;
    role: UserRole;
    authMethod?: 'jwt' | 'api_key';
    scopes?: string[];
  };
}

const API_KEY_SCOPES = new Set([
  'subscriptions:read',
  'subscriptions:write',
  'webhooks:write',
  'analytics:read',
]);

export function requireScope(requiredScope: string | string[]) {
  const requiredScopes = Array.isArray(requiredScope) ? requiredScope : [requiredScope];

  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
      return;
    }

    if (req.user.authMethod === 'api_key') {
      const keyScopes = req.user.scopes || [];
      const missing = requiredScopes.filter((scope) => !keyScopes.includes(scope));

      if (missing.length > 0) {
        res.status(403).json({
          error: 'Forbidden',
          message: `API key missing required scopes: ${missing.join(', ')}`,
        });
        return;
      }
    }

    next();
  };
}

async function authenticateWithApiKey(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<boolean> {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    return false;
  }

  const hash = crypto.createHash('sha256').update(apiKey).digest('hex');

  const { data: keyRecord, error } = await supabase
    .from('api_keys')
    .select('user_id, scopes, revoked, last_used_at, request_count')
    .eq('key_hash', hash)
    .eq('revoked', false)
    .single();

  if (error || !keyRecord) {
    await auditApiKeyEvent('api_key.auth_failed', undefined, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
      reason: 'Invalid or revoked API key',
    });
    res.status(401).json({ error: 'Invalid API key' });
    return true;
  }

  // Update last_used_at and request_count
  await supabase
    .from('api_keys')
    .update({
      last_used_at: new Date().toISOString(),
      request_count: (keyRecord.request_count ?? 0) + 1,
    })
    .eq('key_hash', hash);

  req.user = {
    id: keyRecord.user_id,
    role: 'user' as any,
    authMethod: 'api_key',
    scopes: Array.isArray(keyRecord.scopes) ? keyRecord.scopes : [],
    role: await roleService.getUserRole(keyRecord.user_id),
  };

  setRequestUserId(keyRecord.user_id);
  await loadPrivacyPreferences(keyRecord.user_id);
  next();
  return true;
}

/**
 * Authentication middleware
 * Supports API key (x-api-key) and JWT tokens (Bearer and cookie)
 */
export async function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const apiKeyAttempted = await authenticateWithApiKey(req, res, next);
    if (apiKeyAttempted) {
      return;
    }

    // Try to get token from Authorization header (Bearer token)
    const authHeader = req.headers.authorization;
    let token: string | null = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (req.cookies?.authToken) {
      token = req.cookies.authToken;
    }

    if (!token) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication token required',
      });
      return;
    }

    // Verify token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      logger.warn('Authentication failed', { error: error?.message });
      const isExpired = error?.message?.toLowerCase().includes('expired');
      await emitSecurityEvent(
        isExpired ? 'auth.jwt_expired' : 'auth.jwt_invalid',
        {
          severity: 'medium',
          resourceType: 'auth',
          reason: error?.message || 'Invalid or expired token',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'] as string | undefined,
        },
      );
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired token',
      });
      return;
    }

    // Attach user to request and propagate to log context
    // Get role from authoritative source instead of metadata fallback
    const role = await roleService.getUserRole(user.id);

    req.user = {
      id: user.id,
      email: user.email || '',
      role,
      authMethod: 'jwt',
      scopes: Array.from(API_KEY_SCOPES),
    };
    setRequestUserId(user.id);
    await loadPrivacyPreferences(user.id);
    Sentry.setUser({ id: user.id, email: user.email });


    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Authentication failed',
    });
  }
}

/**
 * Optional authentication - doesn't fail if no token
 * Useful for endpoints that work both authenticated and unauthenticated if there's any later on.
 */
export async function optionalAuthenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const apiKeyAttempted = await authenticateWithApiKey(req, res, next);
    if (apiKeyAttempted) {
      return;
    }

    const authHeader = req.headers.authorization;
    let token: string | null = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (req.cookies?.authToken) {
      token = req.cookies.authToken;
    }

    if (token) {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (!error && user) {
        // Get role from authoritative source instead of metadata fallback
        const role = await roleService.getUserRole(user.id);

        req.user = {
          id: user.id,
          email: user.email || '',
          role,
          authMethod: 'jwt',
          scopes: Array.from(API_KEY_SCOPES),
        };
        setRequestUserId(user.id);
        await loadPrivacyPreferences(user.id);
        Sentry.setUser({ id: user.id, email: user.email });
      }

    }

    next();
  } catch (error) {
    // Continue even on error for optional auth
    next();
  }
}

