import { createHash, randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { resolveSorobanRpcEndpoints, SorobanRpcPool } from '@syncro/shared/soroban-rpc-pool';
import { adminAuth } from '../middleware/admin';
import { RateLimiterFactory, createAdminLimiter } from '../middleware/rate-limit-factory';
import { env } from '../config/env';
import { supabase } from '../config/database';
import logger from '../config/logger';
import { emailService } from '../services/email-service';
import { sliMetricsService } from '../services/sli-metrics-service';
import {
  buildPublicStatusSnapshot,
  type PublicComponentStatus,
} from '../services/public-status-service';

const router = Router();
const subscriptionEmailSchema = z.string().trim().email().max(254);
const incidentSchema = z.object({
  title: z.string().trim().min(1).max(160),
  impact: z.enum(['minor', 'major', 'critical']),
  components: z.array(z.enum(['gateway', 'settlement', 'soroban_rpc'])).min(1).max(3),
  status: z.enum(['investigating', 'identified', 'monitoring', 'resolved']),
  message: z.string().trim().min(1).max(4000),
});
const incidentUpdateSchema = z.object({
  status: z.enum(['investigating', 'identified', 'monitoring', 'resolved']),
  message: z.string().trim().min(1).max(4000),
});

type IncidentStatus = z.infer<typeof incidentUpdateSchema>['status'];
type IncidentImpact = z.infer<typeof incidentSchema>['impact'];

interface IncidentRow {
  id: string;
  title: string;
  impact: IncidentImpact;
  components: Array<'gateway' | 'settlement' | 'soroban_rpc'>;
  created_at: string;
}

interface IncidentUpdateRow {
  id: string;
  incident_id: string;
  status: IncidentStatus;
  message: string;
  created_at: string;
}

let rpcPool: SorobanRpcPool | null = null;
let rpcHealthCache: { checkedAt: number; endpoints: Awaited<ReturnType<SorobanRpcPool['checkLedgerAgreement']>> } | null = null;
let statusMetricsCache: { checkedAt: number; snapshot: Awaited<ReturnType<typeof sliMetricsService.getSliMetrics>> } | null = null;
const subscriptionLimiter = RateLimiterFactory.createCustomLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many subscription requests. Please try again later.' },
  endpointType: 'status-subscription',
});

function createRpcPool(): SorobanRpcPool | null {
  const configured = resolveSorobanRpcEndpoints(env.SOROBAN_RPC_URL, env.SOROBAN_RPC_URLS);
  const fallback =
    env.STELLAR_NETWORK === 'mainnet'
      ? []
      : env.STELLAR_NETWORK === 'futurenet'
        ? ['https://rpc-futurenet.stellar.org']
        : ['https://soroban-testnet.stellar.org'];
  const endpoints = configured.length > 0 ? configured : fallback;
  if (endpoints.length === 0) return null;
  return new SorobanRpcPool({
    endpoints,
    timeoutMs: 4000,
  });
}

async function getRpcHealth(): Promise<Awaited<ReturnType<SorobanRpcPool['checkLedgerAgreement']>>> {
  if (!rpcPool) rpcPool = createRpcPool();
  if (!rpcPool) return [];
  if (rpcHealthCache && Date.now() - rpcHealthCache.checkedAt < 30_000) {
    return rpcHealthCache.endpoints;
  }
  const endpoints = await rpcPool.checkLedgerAgreement(AbortSignal.timeout(6000));
  rpcHealthCache = { checkedAt: Date.now(), endpoints };
  return endpoints;
}

async function getStatusMetrics(): Promise<Awaited<ReturnType<typeof sliMetricsService.getSliMetrics>>> {
  if (statusMetricsCache && Date.now() - statusMetricsCache.checkedAt < 30_000) {
    return statusMetricsCache.snapshot;
  }
  const snapshot = await sliMetricsService.getSliMetrics();
  statusMetricsCache = { checkedAt: Date.now(), snapshot };
  return snapshot;
}

async function getRecentIncidents() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: incidents, error: incidentError } = await supabase
    .from('status_incidents')
    .select('id, title, impact, components, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(50);
  if (incidentError) throw incidentError;
  if (!incidents?.length) return [];

  const incidentIds = incidents.map((incident: IncidentRow) => incident.id);
  const { data: updates, error: updateError } = await supabase
    .from('status_incident_updates')
    .select('id, incident_id, status, message, created_at')
    .in('incident_id', incidentIds)
    .order('created_at', { ascending: true });
  if (updateError) throw updateError;

  const updatesByIncident = new Map<string, IncidentUpdateRow[]>();
  for (const update of (updates ?? []) as IncidentUpdateRow[]) {
    const list = updatesByIncident.get(update.incident_id) ?? [];
    list.push(update);
    updatesByIncident.set(update.incident_id, list);
  }

  return (incidents as IncidentRow[]).map((incident) => {
    const incidentUpdates = updatesByIncident.get(incident.id) ?? [];
    return {
      ...incident,
      status: incidentUpdates.at(-1)?.status ?? 'investigating',
      updates: incidentUpdates,
    };
  });
}

function publicStatus(status: IncidentStatus): PublicComponentStatus {
  return status === 'resolved' ? 'operational' : status === 'monitoring' ? 'degraded' : 'major_outage';
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[char];
  });
}

async function sendIncidentNotifications(
  incident: IncidentRow,
  update: IncidentUpdateRow,
): Promise<{ sent: number; failed: number }> {
  const { data: subscribers, error } = await supabase
    .from('status_subscribers')
    .select('email')
    .not('confirmed_at', 'is', null)
    .limit(5000);
  if (error) throw error;

  const incidentUrl = `${env.FRONTEND_URL}/status`;
  const unsubscribeUrl = `${env.BACKEND_URL}/api/status/subscriptions/unsubscribe`;
  let sent = 0;
  let failed = 0;
  for (let start = 0; start < (subscribers ?? []).length; start += 20) {
    const batch = (subscribers ?? []).slice(start, start + 20);
    const outcomes = await Promise.allSettled(
      batch.map(({ email }: { email: string }) => {
        const token = jwt.sign(
          { email, purpose: 'status-unsubscribe' },
          env.JWT_SECRET,
          { expiresIn: '10y' },
        );
        const unsubscribe = `${unsubscribeUrl}?token=${encodeURIComponent(token)}`;
        const text = `${incident.title}\n${update.status}: ${update.message}\n\nStatus: ${incidentUrl}\nUnsubscribe: ${unsubscribe}`;
        const html = `<h2>${escapeHtml(incident.title)}</h2><p><strong>${update.status}</strong>: ${escapeHtml(update.message)}</p><p><a href="${incidentUrl}">View status page</a> · <a href="${unsubscribe}">Unsubscribe</a></p>`;
        return emailService.sendSimpleEmail(
          email,
          `SYNCRO status: ${incident.title}`,
          text,
          { html },
        );
      }),
    );
    for (const outcome of outcomes) {
      if (outcome.status === 'fulfilled') sent += 1;
      else {
        failed += 1;
        logger.error('[StatusPage] Incident notification delivery failed', {
          error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
        });
      }
    }
  }
  return { sent, failed };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function htmlResponse(res: Response, title: string, message: string, status = 200): void {
  res.status(status).type('html').send(
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escapeHtml(title)}</title><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><a href="${env.FRONTEND_URL}/status">Return to SYNCRO status</a></main></body></html>`,
  );
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const [metrics, rpcHealth, incidents] = await Promise.all([
      getStatusMetrics(),
      getRpcHealth(),
      getRecentIncidents(),
    ]);
    const snapshot = buildPublicStatusSnapshot(metrics, rpcHealth, metrics.calculated_at);
    const incidentsWithStatus = incidents.map((incident) => ({
      ...incident,
      component_status: publicStatus(incident.status),
    }));
    res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=15');
    res.status(200).json({ ...snapshot, incidents: incidentsWithStatus });
  } catch (error) {
    logger.error('[StatusPage] Failed to build public status snapshot', { error });
    res.status(503).json({ error: 'Status data is temporarily unavailable' });
  }
});

router.post('/subscriptions', subscriptionLimiter, async (req: Request, res: Response) => {
  const parsedEmail = subscriptionEmailSchema.safeParse(req.body?.email);
  if (!parsedEmail.success) {
    res.status(400).json({ error: 'A valid email address is required' });
    return;
  }

  const email = parsedEmail.data.toLowerCase();
  const token = randomBytes(32).toString('hex');
  const { error } = await supabase.from('status_subscribers').upsert(
    {
      email,
      confirmation_token_hash: hashToken(token),
      confirmation_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      confirmed_at: null,
    },
    { onConflict: 'email' },
  );
  if (error) {
    logger.error('[StatusPage] Failed to save status subscription', { error });
    res.status(500).json({ error: 'Unable to save the subscription' });
    return;
  }

  try {
    const confirmUrl = `${env.BACKEND_URL}/api/status/subscriptions/confirm?token=${token}`;
    await emailService.sendSimpleEmail(
      email,
      'Confirm your SYNCRO status updates',
      `Confirm your email to receive SYNCRO incident updates: ${confirmUrl}`,
      { html: `<p>Confirm your email to receive SYNCRO incident updates.</p><p><a href="${confirmUrl}">Confirm subscription</a></p>` },
    );
    res.status(202).json({ message: 'Check your email to confirm the subscription.' });
  } catch (error) {
    logger.error('[StatusPage] Failed to send subscription confirmation', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(503).json({ error: 'Confirmation email could not be sent. Please try again later.' });
  }
});

router.get('/subscriptions/confirm', async (req: Request, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!/^[a-f0-9]{64}$/.test(token)) {
    htmlResponse(res, 'Invalid confirmation link', 'Request a new status subscription confirmation.', 400);
    return;
  }
  const { data, error } = await supabase
    .from('status_subscribers')
    .select('email')
    .eq('confirmation_token_hash', hashToken(token))
    .gt('confirmation_expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) {
    logger.error('[StatusPage] Failed to validate status subscription confirmation', { error });
    htmlResponse(res, 'Confirmation unavailable', 'Please try again later.', 503);
    return;
  }
  if (!data) {
    htmlResponse(res, 'Invalid confirmation link', 'The link may have expired or already been used.', 400);
    return;
  }

  const { error: updateError } = await supabase
    .from('status_subscribers')
    .update({
      confirmed_at: new Date().toISOString(),
      confirmation_token_hash: null,
      confirmation_expires_at: null,
    })
    .eq('email', data.email);
  if (updateError) {
    logger.error('[StatusPage] Failed to confirm status subscription', { updateError });
    htmlResponse(res, 'Confirmation unavailable', 'Please try again later.', 503);
    return;
  }
  htmlResponse(res, 'Subscription confirmed', 'You will receive email updates when incidents are posted.');
});

router.get('/subscriptions/unsubscribe', async (req: Request, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch {
    htmlResponse(res, 'Invalid unsubscribe link', 'This link is invalid or expired.', 400);
    return;
  }
  if (typeof payload !== 'object' || payload.purpose !== 'status-unsubscribe' || typeof payload.email !== 'string') {
    htmlResponse(res, 'Invalid unsubscribe link', 'This link is invalid or expired.', 400);
    return;
  }
  const { error } = await supabase.from('status_subscribers').delete().eq('email', payload.email);
  if (error) {
    logger.error('[StatusPage] Failed to unsubscribe from status updates', { error });
    htmlResponse(res, 'Unsubscribe unavailable', 'Please try again later.', 503);
    return;
  }
  htmlResponse(res, 'Unsubscribed', 'You will no longer receive SYNCRO status email updates.');
});

router.post('/incidents', createAdminLimiter(), adminAuth, async (req: Request, res: Response) => {
  const parsed = incidentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid incident', details: parsed.error.issues });
    return;
  }
  const { title, impact, components, status, message } = parsed.data;
  const { data: incident, error: insertError } = await supabase
    .from('status_incidents')
    .insert({ title, impact, components })
    .select('id, title, impact, components, created_at')
    .single();
  if (insertError || !incident) {
    logger.error('[StatusPage] Failed to create incident', { insertError });
    res.status(500).json({ error: 'Unable to create the incident' });
    return;
  }
  const { data: update, error: updateError } = await supabase
    .from('status_incident_updates')
    .insert({ incident_id: incident.id, status, message })
    .select('id, incident_id, status, message, created_at')
    .single();
  if (updateError || !update) {
    await supabase.from('status_incidents').delete().eq('id', incident.id);
    logger.error('[StatusPage] Failed to add initial incident update', { updateError });
    res.status(500).json({ error: 'Unable to create the incident update' });
    return;
  }
  let notifications: { sent: number; failed: number; error?: string };
  try {
    notifications = await sendIncidentNotifications(incident as IncidentRow, update as IncidentUpdateRow);
  } catch (error) {
    logger.error('[StatusPage] Incident notification fanout failed', { error });
    notifications = { sent: 0, failed: 0, error: 'notification_fanout_failed' };
  }
  res.status(201).json({ incident, update, notifications });
});

router.post('/incidents/:id/updates', createAdminLimiter(), adminAuth, async (req: Request, res: Response) => {
  const parsed = incidentUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid incident update', details: parsed.error.issues });
    return;
  }

  const { data: incident, error: incidentError } = await supabase
    .from('status_incidents')
    .select('id, title, impact, components, created_at')
    .eq('id', req.params.id)
    .maybeSingle();
  if (incidentError) {
    logger.error('[StatusPage] Failed to load incident for update', { incidentError });
    res.status(500).json({ error: 'Unable to load the incident' });
    return;
  }
  if (!incident) {
    res.status(404).json({ error: 'Incident not found' });
    return;
  }

  const { data: update, error: updateError } = await supabase
    .from('status_incident_updates')
    .insert({
      incident_id: incident.id,
      status: parsed.data.status,
      message: parsed.data.message,
    })
    .select('id, incident_id, status, message, created_at')
    .single();
  if (updateError || !update) {
    logger.error('[StatusPage] Failed to publish incident update', { updateError });
    res.status(500).json({ error: 'Unable to publish the incident update' });
    return;
  }
  let notifications: { sent: number; failed: number; error?: string };
  try {
    notifications = await sendIncidentNotifications(incident as IncidentRow, update as IncidentUpdateRow);
  } catch (error) {
    logger.error('[StatusPage] Incident notification fanout failed', { error });
    notifications = { sent: 0, failed: 0, error: 'notification_fanout_failed' };
  }
  res.status(201).json({ update, notifications });
});

export default router;
