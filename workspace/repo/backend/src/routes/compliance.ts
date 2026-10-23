import { Router, Request, Response } from 'express';
import archiver from 'archiver';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { complianceService } from '../services/compliance-service';
import { supabase } from '../config/database';
import logger from '../config/logger';
import { RateLimiterFactory } from '../middleware/rate-limit-factory';
import { deleteAccountSchema } from '../schemas/compliance';
import { UnauthorizedError } from '../errors';

const router: Router = Router();

// ═══════════════════════════════════════════════════════════════════
//  V3 Compliance Posture
// ═══════════════════════════════════════════════════════════════════
//
// SYNCRO v3 is non-custodial. At any moment SYNCRO ideally
// custody nothing — funds move through pre-authorized payment
// channels and machine payers (agent bots) execute renewals
// within strict spend limits and time windows (see ADR-005).
//
// What this implies for compliance:
//  1. No KYC/AML burden for crypto-only operations — no consumer
//     funds pass through SYNCRO's own accounts.
//  2. If a provider enables a fiat on-ramp (taking fiat currency
//     into the system), the answer changes substantially — KYC/AML
//     verification becomes required at that threshold.
//  3. GDPR data-export and right-to-erasure obligations still apply
//     because the system holds personal data (profiles, preferences,
//     audit logs), even though it holds no funds.
//  4. Consumer-subscription compliance logic (email unsubscribe,
//     marketing preferences, subscription cancellation on deletion)
//     has been removed — it no longer applies to v3's machine-payer
//     model.
//
// ═══════════════════════════════════════════════════════════════════

// ─── Rate limiters ────────────────────────────────────────────────────

const exportRateLimit = RateLimiterFactory.createCustomLimiter({
  windowMs: 60 * 60 * 1000,
  max: 1,
  message: { error: 'Export rate limit exceeded. Try again in 1 hour.' },
  keyGenerator: (req: Request) => {
    const authReq = req as AuthenticatedRequest;
    return authReq.user?.id || req.ip || 'anonymous';
  },
  endpointType: 'data-export',
});

// ─── Data Export ─────────────────────────────────────────────────────

router.get('/export', authenticate, exportRateLimit, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const data = await complianceService.gatherUserData(userId);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="syncro-data-export-${Date.now()}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => logger.error('Archiver error:', err));
    archive.pipe(res);

    archive.on('error', (err) => {
      logger.error('Archiver error during export:', err);
    });

    archive.append(JSON.stringify(data.profile, null, 2), { name: 'profile.json' });
    archive.append(JSON.stringify(data.notifications, null, 2), { name: 'notifications.json' });
    archive.append(JSON.stringify(data.auditLogs, null, 2), { name: 'audit_logs.json' });
    archive.append(JSON.stringify(data.preferences, null, 2), { name: 'preferences.json' });
    archive.append(JSON.stringify(data.emailAccounts, null, 2), { name: 'email_accounts.json' });
    archive.append(JSON.stringify(data.teams, null, 2), { name: 'teams.json' });

    const readme = [
      'Syncro — Personal Data Export',
      '==============================',
      `Generated: ${new Date().toISOString()}`,
      `User ID: ${userId}`,
      '',
      'Files included:',
      '  profile.json        — Your account profile',
      '  notifications.json  — Notification history',
      '  audit_logs.json     — Account activity log',
      '  preferences.json    — User preferences and settings',
      '  email_accounts.json — Connected email accounts',
      '  teams.json          — Team membership records',
      '',
      'For questions or deletion requests, contact support.',
    ].join('\n');

    archive.append(readme, { name: 'README.txt' });

    await archive.finalize();

    await supabase.from('audit_logs').insert({
      user_id: userId,
      action: 'data_export',
      resource_type: 'account',
      resource_id: userId,
      metadata: { exported_at: new Date().toISOString() },
    });

    logger.info(`Data export completed for user ${userId}`);
  } catch (error) {
    logger.error('Data export error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export data',
      });
    }
  }
});

// ─── Account Deletion ─────────────────────────────────────────────────

router.post(
  '/account/delete',
  authenticate,
  requireRole('owner'),
  validate(deleteAccountSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    try {
      const { reason } = req.body;
      const result = await complianceService.requestDeletion(userId, reason);
      res.json({ success: true, data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to request deletion';
      if (message.includes('already pending')) {
        return res.status(409).json({ success: false, error: message });
      }
      logger.error('Account deletion request error:', error);
      res.status(500).json({ success: false, error: message });
    }
  },
);

router.post('/account/delete/cancel', authenticate, requireRole('owner'), async (req: AuthenticatedRequest, res: Response) => {
  const result = await complianceService.cancelDeletion(req.user!.id);
  res.json({ success: true, data: result });
});

router.get('/account/deletion-status', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const status = await complianceService.getDeletionStatus(req.user!.id);
  res.json({ success: true, data: status });
});

// ─── Provider Verification ────────────────────────────────────────────
//
// Determines whether a provider taking payouts needs KYC/AML
// verification. For v3's non-custodial posture:
//
//  - Crypto-only payouts (no fiat on-ramp): verification NOT required.
//  - Fiat on-ramp enabled: verification IS required, because taking
//    fiat currency introduces KYC/AML obligations that do not apply
//    to purely on-chain transfers.
//
// The threshold is binary: fiat enabled → verification required.

router.get(
  '/provider/verification',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const status = await complianceService.verifyProviderPayoutStatus(userId);
      res.json({ success: true, data: status });
    } catch (error) {
      logger.error('Provider verification error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to verify provider',
      });
    }
  },
);

export default router;
