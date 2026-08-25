import { Router, Response } from 'express';
import { supabase } from '../config/database';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { recoveryCodeService, totpService } from '../services/mfa-service';
import { TotpRateLimiter } from '../lib/totp-rate-limiter';
import { createMfaLimiter } from '../middleware/rate-limit-factory';
import logger from '../config/logger';
import { emitSecurityEvent } from '../services/audit-service';
import { verifyRecoveryCodeSchema, mfaNotifySchema, requireTwoFaSchema } from '../schemas/mfa';

const router: Router = Router();
const totpRateLimiter = new TotpRateLimiter();
router.use(authenticate);

// ---------------------------------------------------------------------------
// POST /api/2fa/totp/verify
// Verify a TOTP code with single-use enforcement and rate limiting
// ---------------------------------------------------------------------------

router.post(
  '/2fa/totp/verify',
  createMfaLimiter(),
  async (req: AuthenticatedRequest, res: Response) => {
    const sessionId = req.user!.id;

    // Check if user is locked out due to too many failures
    if (totpRateLimiter.isLocked(sessionId)) {
      const remainingMs = totpRateLimiter.getRemainingLockoutMs(sessionId);
      const remainingMinutes = Math.ceil(remainingMs / 60000);
      
      await emitSecurityEvent('mfa.totp_lockout_active', {
        severity: 'high',
        actorId: req.user!.id,
        resourceType: 'mfa',
        reason: 'TOTP verification attempted while locked out',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] as string | undefined,
        details: { remainingMinutes },
      });

      return res.status(429).json({
        success: false,
        error: `Too many failed attempts. Please try again in ${remainingMinutes} minute(s).`,
      });
    }

    try {
      const { token, secret } = req.body;

      if (!token || !secret) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: token and secret',
        });
      }

      // Verify TOTP with single-use enforcement
      const valid = await totpService.verify(req.user!.id, secret, token);

      if (!valid) {
        totpRateLimiter.recordFailure(sessionId);

        const failureCount = totpRateLimiter.getFailureCount(sessionId);
        const locked = totpRateLimiter.isLocked(sessionId);

        await emitSecurityEvent('mfa.totp_verification_failed', {
          severity: locked ? 'high' : 'medium',
          actorId: req.user!.id,
          resourceType: 'mfa',
          reason: locked ? 'TOTP lockout threshold reached' : 'Invalid TOTP code',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'] as string | undefined,
          details: { failureCount, locked },
        });

        if (locked) {
          await emitSecurityEvent('mfa.failure_threshold_reached', {
            severity: 'high',
            actorId: req.user!.id,
            resourceType: 'mfa',
            reason: 'TOTP failure threshold exceeded',
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'] as string | undefined,
          });
          
          const remainingMs = totpRateLimiter.getRemainingLockoutMs(sessionId);
          const remainingMinutes = Math.ceil(remainingMs / 60000);
          
          return res.status(429).json({
            success: false,
            error: `Too many failed attempts. Account locked for ${remainingMinutes} minute(s).`,
          });
        }

        return res.status(401).json({
          success: false,
          error: 'Invalid or already-used TOTP code',
        });
      }

      // Success - reset failure count
      totpRateLimiter.reset(sessionId);

      await emitSecurityEvent('mfa.totp_verification_success', {
        severity: 'info',
        actorId: req.user!.id,
        resourceType: 'mfa',
        reason: 'TOTP verification successful',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] as string | undefined,
      });

      res.json({ success: true });
    } catch (error) {
      logger.error('POST /api/2fa/totp/verify error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to verify TOTP code',
      });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/2fa/totp/generate
// Generate a new TOTP secret for the authenticated user
// ---------------------------------------------------------------------------

router.post('/2fa/totp/generate', createMfaLimiter(), async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Get user email from Supabase auth
    const { data: authData, error: authError } = await supabase.auth.admin.getUserById(req.user!.id);

    if (authError || !authData.user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    const userEmail = authData.user.email || req.user!.id;
    const { secret, otpauth_url } = totpService.generateSecret(userEmail);

    await emitSecurityEvent('mfa.totp_secret_generated', {
      severity: 'info',
      actorId: req.user!.id,
      resourceType: 'mfa',
      reason: 'New TOTP secret generated',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });

    res.status(201).json({
      success: true,
      data: {
        secret,
        otpauth_url,
      },
    });
  } catch (error) {
    logger.error('POST /api/2fa/totp/generate error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate TOTP secret',
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/2fa/recovery-codes/generate
// Generate 10 recovery codes for the authenticated user
// ---------------------------------------------------------------------------

router.post('/2fa/recovery-codes/generate', createMfaLimiter(), async (req: AuthenticatedRequest, res: Response) => {
  const codes = await recoveryCodeService.generate(req.user!.id);
  res.status(201).json({ success: true, data: { codes } });
});

// ---------------------------------------------------------------------------
// POST /api/2fa/recovery-codes/verify
// Verify a recovery code — rate-limited per session
// ---------------------------------------------------------------------------

router.post(
  '/2fa/recovery-codes/verify',
  createMfaLimiter(),
  validate(verifyRecoveryCodeSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    const sessionId = req.user!.id;

    if (totpRateLimiter.isLocked(sessionId)) {
      return res.status(429).json({
        success: false,
        error: 'Too many failed attempts. Please try again later.',
      });
    }

    try {
      const { code } = req.body;

      const valid = await recoveryCodeService.verify(req.user!.id, code);

      if (!valid) {
        totpRateLimiter.recordFailure(sessionId);

        const locked = totpRateLimiter.isLocked(sessionId);
        await emitSecurityEvent('mfa.recovery_code_failed', {
          severity: locked ? 'high' : 'medium',
          actorId: req.user!.id,
          resourceType: 'mfa',
          reason: locked ? 'MFA lockout threshold reached' : 'Invalid recovery code',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'] as string | undefined,
          details: { locked },
        });

        if (locked) {
          await emitSecurityEvent('mfa.failure_threshold_reached', {
            severity: 'high',
            actorId: req.user!.id,
            resourceType: 'mfa',
            reason: 'Recovery code failure threshold exceeded',
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'] as string | undefined,
          });
          return res.status(429).json({
            success: false,
            error: 'Too many failed attempts. Please try again later.',
          });
        }

        return res.status(401).json({ success: false, error: 'Invalid or already-used recovery code' });
      }

      totpRateLimiter.reset(sessionId);
      res.json({ success: true });
    } catch (error) {
      logger.error('POST /api/2fa/recovery-codes/verify error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to verify recovery code',
      });
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /api/2fa/recovery-codes
// Invalidate all recovery codes
// ---------------------------------------------------------------------------

router.delete('/2fa/recovery-codes', async (req: AuthenticatedRequest, res: Response) => {
  try {
    await recoveryCodeService.invalidateAll(req.user!.id);
    res.json({ success: true });
  } catch (error) {
    logger.error('DELETE /api/2fa/recovery-codes error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to invalidate recovery codes',
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/2fa/notify
// Send a 2FA lifecycle notification email
// ---------------------------------------------------------------------------

router.post('/2fa/notify', validate(mfaNotifySchema), async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  
  totpRateLimiter.reset(userId);
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// PUT /api/teams/:teamId/require-2fa
// Set team 2FA enforcement policy (owner only)
// ---------------------------------------------------------------------------

router.put(
  '/teams/:teamId/require-2fa',
  validate(requireTwoFaSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    const { teamId } = req.params;
    const { required } = req.body;

    try {
      const { data: team, error: teamErr } = await supabase
        .from('teams')
        .select('id, owner_id')
        .eq('id', teamId)
        .single();

      if (teamErr || !team) {
        return res.status(404).json({ success: false, error: 'Team not found' });
      }

      if (team.owner_id !== req.user!.id) {
        return res.status(403).json({ success: false, error: 'Only the team owner can change 2FA enforcement' });
      }

      const { error: updateErr } = await supabase
        .from('teams')
        .update({
          require_2fa: required,
          require_2fa_set_at: required ? new Date().toISOString() : null,
        })
        .eq('id', teamId);

      if (updateErr) throw updateErr;

      res.json({ success: true, data: { teamId, require2fa: required } });
    } catch (error) {
      logger.error('PUT /api/teams/:teamId/require-2fa error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update team 2FA enforcement',
      });
    }
  },
);

export default router;
