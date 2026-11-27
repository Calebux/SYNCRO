/**
 * backend/src/routes/reconciliation-metrics.ts
 *
 * Place at: backend/src/routes/reconciliation-metrics.ts (new file)
 *
 * Exposes reconciliation state to the ops dashboard, per acceptance
 * criteria ("Alert ... expose both on the ops dashboard").
 *
 * Mount in backend/src/index.ts alongside your other routes:
 *
 *   import reconciliationMetricsRouter from './routes/reconciliation-metrics';
 *   app.use('/api/ops/reconciliation', requireOpsAuth, reconciliationMetricsRouter);
 *
 * ADJUST: `requireOpsAuth` — use whatever admin/ops auth middleware this
 * repo already has; this data (tx hashes, amounts, contract ids) should
 * never be public.
 */

import { Router, Request, Response } from 'express';
import { supabase } from '../lib/supabase'; // ADJUST: your Supabase client export
import { runReconciliationNow } from '../jobs/reconciliation-scheduler';

const router = Router();

/** GET /summary — discrepancy counts by severity + status, and current lag. */
router.get('/summary', async (_req: Request, res: Response) => {
  const { data: discrepancies, error: discrepancyError } = await supabase
    .from('reconciliation_discrepancies')
    .select('severity, resolution_status, discrepancy_type');

  if (discrepancyError) {
    return res.status(500).json({ error: discrepancyError.message });
  }

  const { data: lastRun, error: runError } = await supabase
    .from('reconciliation_runs')
    .select('*')
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (runError) {
    return res.status(500).json({ error: runError.message });
  }

  const openCount = discrepancies.filter((d) => d.resolution_status !== 'resolved' && d.resolution_status !== 'auto_resolved').length;
  const bySeverity = countBy(discrepancies, 'severity');
  const byType = countBy(discrepancies, 'discrepancy_type');

  res.json({
    openDiscrepancyCount: openCount,
    totalDiscrepancyCount: discrepancies.length,
    bySeverity,
    byType,
    lastRun: lastRun ?? null,
    reconciliationLagMs: lastRun?.reconciliation_lag_ms ?? null,
  });
});

/** GET /discrepancies — paginated list for the dashboard table. */
router.get('/discrepancies', async (req: Request, res: Response) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const offset = Number(req.query.offset ?? 0);

  let query = supabase
    .from('reconciliation_discrepancies')
    .select('*')
    .order('detected_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq('resolution_status', status);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  res.json({ discrepancies: data });
});

/** GET /runs — recent job runs, for a lag-over-time chart. */
router.get('/runs', async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 200);

  const { data, error } = await supabase
    .from('reconciliation_runs')
    .select('*')
    .order('finished_at', { ascending: false })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ runs: data });
});

/** POST /run-now — manual trigger, e.g. an ops "run reconciliation now" button. */
router.post('/run-now', async (req: Request, res: Response) => {
  const mode = req.body?.mode === 'full_sweep' ? 'full_sweep' : 'sliding_window';
  try {
    await runReconciliationNow(mode);
    res.json({ ok: true, mode });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

function countBy<T extends Record<string, unknown>>(rows: T[], key: keyof T): Record<string, number> {
  return rows.reduce((acc, row) => {
    const k = String(row[key]);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}

export default router;