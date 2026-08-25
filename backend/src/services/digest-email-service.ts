import nodemailer from 'nodemailer';
import { supabase } from '../config/database';
import logger from '../config/logger';
import { buildDigestEmailHtml, buildDigestEmailText } from './digest-template';
import type { MonthlyDigestSummary, DigestAuditRecord } from '../types/digest';
import { secretProvider } from './secret-provider';

export interface DigestAuditInput {
  userId:       string;
  digestType:   'monthly' | 'test';
  periodLabel:  string;
  status:       'sent' | 'failed' | 'skipped';
  errorMessage: string | null;
}

export interface DigestSendRequest {
  recipientEmail: string;
  summary:        MonthlyDigestSummary;
  digestType?:    'monthly' | 'test';
}

export interface DigestSendResult {
  userId:  string;
  success: boolean;
  error?:  string;
}

/** How many digest emails to have in flight at once during a batch run. */
const SEND_CONCURRENCY = 5;

export class DigestEmailService {
  private transporter: nodemailer.Transporter | null = null;
  private fromEmail: string;
  private dashboardUrl: string;

  constructor() {
    this.fromEmail    = process.env.EMAIL_FROM    ?? 'noreply@synchro.app';
    this.dashboardUrl = process.env.FRONTEND_URL  ?? 'https://app.syncro.ai';
  }

  private async getTransporter(): Promise<nodemailer.Transporter> {
    if (this.transporter) {
      return this.transporter;
    }

    if (process.env.SMTP_HOST) {
      const password =
        (await secretProvider.getSecret('SMTP_PASSWORD')) ||
        (await secretProvider.getSecret('SMTP_PASS')) ||
        '';

      this.transporter = nodemailer.createTransport({
        host:   process.env.SMTP_HOST,
        port:   parseInt(process.env.SMTP_PORT ?? '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER ?? '',
          pass: password,
        },
      });
    } else {
      // Development fallback — logs message JSON to console
      this.transporter = nodemailer.createTransport({ jsonTransport: true });
      logger.warn('DigestEmailService: SMTP not configured, using mock transporter.');
    }
    return this.transporter;
  }

  /**
   * Deliver one digest email. Returns the outcome without touching the audit
   * log, so callers can decide whether to record it one-by-one or in a batch.
   */
  private async deliver(
    recipientEmail: string,
    summary: MonthlyDigestSummary,
    digestType: 'monthly' | 'test',
  ): Promise<{ success: boolean; error?: string }> {
    const subject = `Your SYNCRO Monthly Summary — ${summary.periodLabel}`;

    try {
      const transporter = await this.getTransporter();
      const info = await transporter.sendMail({
        from:    this.fromEmail,
        to:      recipientEmail,
        subject,
        html:    buildDigestEmailHtml(summary, this.dashboardUrl),
        text:    buildDigestEmailText(summary, this.dashboardUrl),
      });

      logger.info('Monthly digest sent', {
        messageId: info.messageId,
        period:    summary.periodLabel,
        digestType,
      });

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Failed to send monthly digest', err);
      return { success: false, error: message };
    }
  }

  /**
   * Send the monthly digest email to a user and record the result in the audit log.
   */
  async sendMonthlyDigest(
    recipientEmail: string,
    summary: MonthlyDigestSummary,
    digestType: 'monthly' | 'test' = 'monthly',
  ): Promise<{ success: boolean; error?: string }> {
    const outcome = await this.deliver(recipientEmail, summary, digestType);

    await this.writeAuditRecords([
      {
        userId:       summary.userId,
        digestType,
        periodLabel:  summary.periodLabel,
        status:       outcome.success ? 'sent' : 'failed',
        errorMessage: outcome.error ?? null,
      },
    ]);

    return outcome;
  }

  /**
   * Send digests for many users, writing all audit rows in a single insert
   * (issue #1095).
   *
   * The per-user path wrote one `digest_audit_log` row per send, so a digest run
   * for N users cost N inserts on top of the sends themselves. Batching leaves
   * exactly one audit write per call.
   */
  async sendMonthlyDigestBatch(requests: readonly DigestSendRequest[]): Promise<DigestSendResult[]> {
    if (requests.length === 0) return [];

    const results: DigestSendResult[] = new Array(requests.length);
    const audits: DigestAuditInput[] = new Array(requests.length);

    // Bounded concurrency — SMTP providers throttle aggressive parallel sends.
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < requests.length) {
        const index = cursor++;
        const { recipientEmail, summary, digestType = 'monthly' } = requests[index];
        const outcome = await this.deliver(recipientEmail, summary, digestType);

        results[index] = { userId: summary.userId, ...outcome };
        audits[index] = {
          userId:       summary.userId,
          digestType,
          periodLabel:  summary.periodLabel,
          status:       outcome.success ? 'sent' : 'failed',
          errorMessage: outcome.error ?? null,
        };
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(SEND_CONCURRENCY, requests.length) }, worker),
    );

    await this.writeAuditRecords(audits);

    return results;
  }

  // ─── Audit ────────────────────────────────────────────────────────────────

  /** Write one or many digest audit rows in a single insert. */
  async writeAuditRecords(records: readonly DigestAuditInput[]): Promise<void> {
    if (records.length === 0) return;

    const { error } = await supabase.from('digest_audit_log').insert(
      records.map((record) => ({
        user_id:       record.userId,
        digest_type:   record.digestType,
        period_label:  record.periodLabel,
        status:        record.status,
        error_message: record.errorMessage,
        sent_at:       new Date().toISOString(),
      })),
    );

    if (error) {
      logger.error('Failed to write digest audit record:', error);
    }
  }

  /**
   * Retrieve the audit history for a user (newest first, capped at 24 records).
   */
  async getAuditHistory(userId: string, limit = 24): Promise<DigestAuditRecord[]> {
    const { data, error } = await supabase
      .from('digest_audit_log')
      .select('*')
      .eq('user_id', userId)
      .order('sent_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('Failed to fetch digest audit history:', error);
      return [];
    }

    return (data ?? []).map((r) => ({
      id:           r.id,
      userId:       r.user_id,
      digestType:   r.digest_type,
      periodLabel:  r.period_label,
      status:       r.status,
      errorMessage: r.error_message ?? null,
      sentAt:       r.sent_at,
    }));
  }
}

export const digestEmailService = new DigestEmailService();
