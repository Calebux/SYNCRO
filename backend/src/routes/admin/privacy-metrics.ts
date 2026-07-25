import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../../middleware/auth';
import { createAdminLimiter } from '../../middleware/rate-limit-factory';
import { requireRole } from '../../middleware/rbac';
import logger from '../../config/logger';
import { supabase } from '../../config/database';

const router = Router();

// Strict JWT + role gate (admin only)
router.use(createAdminLimiter());
router.use(authenticate);
router.use(requireRole('admin'));

type PrivacyMetrics = {
  privacy_mode_enabled_rate_percent: number | null;
  subscriptions_encrypted_onchain_rate_percent: number | null;
  active_payment_channels_count: number;
  zk_proofs_generated_count: number;
  zk_proofs_verified_count: number;
  stealth_address_adoption_rate_percent: number | null;
  gdpr_export_requests_count: number;
  gdpr_deletion_requests_count: number;
  generated_at: string;
};

function safeDivide(n: number, d: number): number | null {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return null;
  return (n / d) * 100;
}

async function getPrivacyMetricsAggregates(): Promise<Omit<PrivacyMetrics, 'generated_at'>> {
  // NOTE: These queries are placeholders until we confirm exact table/column names.
  // We intentionally avoid returning user-level rows.

  // 1) Privacy mode enabled rate
  const { data: privacyEnabledAgg } = await supabase
    .from('profiles')
    .select('privacy_mode_enabled')
    .eq('privacy_mode_enabled', true);

  const { count: privacyEnabledCount } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('privacy_mode_enabled', true);

  const { count: totalProfilesCount } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true });

  const privacyModeRate = safeDivide(Number(privacyEnabledCount ?? 0), Number(totalProfilesCount ?? 0));

  // 2) Subscriptions encrypted on-chain rate
  const { count: encryptedSubsCount } = await supabase
    .from('subscriptions')
    .select('*', { count: 'exact', head: true })
    .eq('encrypted_onchain', true);

  const { count: totalSubsCount } = await supabase
    .from('subscriptions')
    .select('*', { count: 'exact', head: true });

  const subsEncryptedRate = safeDivide(Number(encryptedSubsCount ?? 0), Number(totalSubsCount ?? 0));

  // 3) Active payment channels count
  const { count: activeChannelsCount } = await supabase
    .from('payment_channels')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active');

  // 4) ZK proofs generated/verified counts
  const { count: zkGeneratedCount } = await supabase
    .from('zk_proofs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'generated');

  const { count: zkVerifiedCount } = await supabase
    .from('zk_proofs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'verified');

  // 5) Stealth address adoption rate
  const { count: stealthConfiguredCount } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .not('stealth_meta_address', 'is', null);

  const { count: totalProfilesCount2 } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true });

  const stealthAdoptionRate = safeDivide(Number(stealthConfiguredCount ?? 0), Number(totalProfilesCount2 ?? 0));

  // 6) GDPR export/deletion requests counts
  const { count: gdprExportCount } = await supabase
    .from('gdpr_requests')
    .select('*', { count: 'exact', head: true })
    .eq('request_type', 'export');

  const { count: gdprDeletionCount } = await supabase
    .from('gdpr_requests')
    .select('*', { count: 'exact', head: true })
    .eq('request_type', 'deletion');

  return {
    privacy_mode_enabled_rate_percent: privacyModeRate,
    subscriptions_encrypted_onchain_rate_percent: subsEncryptedRate,
    active_payment_channels_count: Number(activeChannelsCount ?? 0),
    zk_proofs_generated_count: Number(zkGeneratedCount ?? 0),
    zk_proofs_verified_count: Number(zkVerifiedCount ?? 0),
    stealth_address_adoption_rate_percent: stealthAdoptionRate,
    gdpr_export_requests_count: Number(gdprExportCount ?? 0),
    gdpr_deletion_requests_count: Number(gdprDeletionCount ?? 0),
  };
}

router.get('/privacy-metrics', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const metricsBase = await getPrivacyMetricsAggregates();
    const payload: PrivacyMetrics = {
      ...metricsBase,
      generated_at: new Date().toISOString(),
    };

    res.json({
      success: true,
      data: payload,
      // Guardrail: do not include any user-level rows.
    });
  } catch (error) {
    logger.error('Failed to fetch privacy metrics', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to fetch privacy metrics' });
  }
});

router.get('/privacy-metrics.csv', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const metricsBase = await getPrivacyMetricsAggregates();
    const payload: PrivacyMetrics = {
      ...metricsBase,
      generated_at: new Date().toISOString(),
    };

    const headers = [
      'privacy_mode_enabled_rate_percent',
      'subscriptions_encrypted_onchain_rate_percent',
      'active_payment_channels_count',
      'zk_proofs_generated_count',
      'zk_proofs_verified_count',
      'stealth_address_adoption_rate_percent',
      'gdpr_export_requests_count',
      'gdpr_deletion_requests_count',
      'generated_at',
    ];

    const row = [
      payload.privacy_mode_enabled_rate_percent,
      payload.subscriptions_encrypted_onchain_rate_percent,
      payload.active_payment_channels_count,
      payload.zk_proofs_generated_count,
      payload.zk_proofs_verified_count,
      payload.stealth_address_adoption_rate_percent,
      payload.gdpr_export_requests_count,
      payload.gdpr_deletion_requests_count,
      payload.generated_at,
    ].map((v) => (v === null || v === undefined ? '' : String(v)));

    const csv = [headers.join(','), row.join(',')].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="privacy-metrics.csv"');
    res.status(200).send(csv);
  } catch (error) {
    logger.error('Failed to export privacy metrics CSV', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to export privacy metrics CSV' });
  }
});

export default router;

