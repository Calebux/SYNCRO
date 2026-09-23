import { Request, Response, NextFunction } from 'express';
import { totpService, recoveryCodeService } from '../services/mfa-service';
import { emitSecurityEvent } from '../services/audit-service';
import { supabase } from '../config/database';
import logger from '../config/logger';
import type { AuthenticatedRequest } from './auth';

export interface AdminOperatorRequest extends AuthenticatedRequest {
  user?: NonNullable<AuthenticatedRequest['user']>;
}

async function loadTotpSecret(userId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('totp_secret')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) return null;
    return (data as { totp_secret?: string | null }).totp_secret ?? null;
  } catch (error) {
    logger.warn('[admin-mfa] Failed to load TOTP secret', { userId, error });
    return null;
  }
}

export function extractMfaCode(req: Request): string | undefined {
  const header = req.headers['x-admin-mfa-code'];
  if (typeof header === 'string' && header.length > 0) return header;

  const bodyCode = (req.body as { mfaCode?: string })?.mfaCode;
  if (typeof bodyCode === 'string' && bodyCode.length > 0) return bodyCode;

  return undefined;
}

export async function verifyOperatorMfa(
  userId: string,
  mfaCode: string,
  req: Request
): Promise<{ valid: boolean; method?: 'totp' | 'recovery'; error?: string }> {
  const secret = await loadTotpSecret(userId);

  if (secret) {
    const ok = await totpService.verify(userId, secret, mfaCode);
    if (ok) {
      return { valid: true, method: 'totp' };
    }
  }

  const recoveryOk = await recoveryCodeService.verify(userId, mfaCode);
  if (recoveryOk) {
    return { valid: true, method: 'recovery' };
  }

  await emitSecurityEvent('admin.mfa_failed', {
    severity: 'high',
    actorId: userId,
    resourceType: 'admin.mfa_gate',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    details: {
      codeLength: mfaCode.length,
      hasTotpSecret: !!secret,
    },
  });

  return { valid: false, error: 'Invalid or expired MFA code' };
}

export function requireOperatorRole(req: Request, res: Response, next: NextFunction): void {
  const user = (req as AdminOperatorRequest).user;
  if (!user) {
    res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
    return;
  }
  if (user.role !== 'owner' && user.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden', message: 'Operator role required' });
    return;
  }
  next();
}
