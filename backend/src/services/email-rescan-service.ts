import crypto from 'node:crypto';
import { google } from 'googleapis';
import { supabase } from '../config/database';
import logger from '../config/logger';
import { idempotencyService } from './idempotency';
import { auditService } from './audit-service';
import { parseSubscriptionEmailWithFallback } from './email-parser';
import { refreshOutlookToken } from './outlook-service';

export interface RescanOptions {
  userId: string;
  emailAccountId: string;
  startDate: string; // ISO 8601 string
  endDate: string;   // ISO 8601 string
  operatorId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface RescanResult {
  jobId: string;
  status: 'started' | 'completed' | 'failed';
  processedCount: number;
  subscriptionsCreated: number;
  duplicatesSkipped: number;
  error?: string;
}

// Minimal interface representing a raw email fetched from provider
export interface RawEmail {
  id: string;
  from?: string | null;
  subject: string;
  bodyText: string;
  date: string;
}

interface EmailAccountRecord {
  id: string;
  provider: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expiry: string | null;
  is_connected: boolean | null;
}

const MAX_RESCAN_WINDOW_DAYS = 31;
const MAX_PROVIDER_MESSAGES = 100;
const PROVIDER_KEYWORDS = [
  'subscription',
  'renewal',
  'invoice',
  'receipt',
  'billing',
  'charged',
  'trial',
  'membership',
  'plan',
];

export class EmailRescanService {
  private validateOptions(options: RescanOptions): { startAt: Date; endAt: Date; windowDays: number } {
    const startAt = new Date(options.startDate);
    const endAt = new Date(options.endDate);

    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new Error('startDate and endDate must be valid ISO-8601 timestamps');
    }

    if (startAt > endAt) {
      throw new Error('startDate must be less than or equal to endDate');
    }

    const windowMs = endAt.getTime() - startAt.getTime();
    const windowDays = windowMs / (24 * 60 * 60 * 1000);

    if (windowDays > MAX_RESCAN_WINDOW_DAYS) {
      throw new Error(`Re-scan window cannot exceed ${MAX_RESCAN_WINDOW_DAYS} days`);
    }

    if (endAt.getTime() > Date.now()) {
      throw new Error('endDate cannot be in the future');
    }

    return { startAt, endAt, windowDays };
  }

  private createGmailClient() {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      throw new Error('Missing Google OAuth environment variables');
    }

    return new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI,
    );
  }

  private async fetchEmails(
    userId: string,
    emailAccountId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<RawEmail[]> {
    logger.info(`Fetching emails for account ${emailAccountId} between ${startAt.toISOString()} and ${endAt.toISOString()}`);

    const { data: account, error } = await supabase
      .from('email_accounts')
      .select('id, provider, access_token, refresh_token, token_expiry, is_connected')
      .eq('id', emailAccountId)
      .eq('user_id', userId)
      .single();

    if (error || !account) {
      throw new Error('Email account not found or access denied');
    }

    const emailAccount = account as EmailAccountRecord;

    if (!emailAccount.is_connected) {
      throw new Error('Email account is disconnected');
    }

    switch (emailAccount.provider) {
      case 'gmail':
        return this.fetchGmailEmails(emailAccount, startAt, endAt);
      case 'outlook':
        return this.fetchOutlookEmails(emailAccount, startAt, endAt);
      default:
        throw new Error(`Unsupported email provider: ${emailAccount.provider}`);
    }
  }

  private async fetchGmailEmails(
    account: EmailAccountRecord,
    startAt: Date,
    endAt: Date,
  ): Promise<RawEmail[]> {
    if (!account.access_token) {
      throw new Error('Connected Gmail account is missing an access token');
    }

    const oauth2Client = this.createGmailClient();
    oauth2Client.setCredentials({
      access_token: account.access_token,
      refresh_token: account.refresh_token ?? undefined,
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const keywordQuery = PROVIDER_KEYWORDS.map((keyword) => `"${keyword}"`).join(' OR ');
    const query = `(${keywordQuery}) after:${Math.floor(startAt.getTime() / 1000)} before:${Math.ceil(endAt.getTime() / 1000)}`;

    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: MAX_PROVIDER_MESSAGES,
    });

    const emails: RawEmail[] = [];

    for (const message of listResponse.data.messages ?? []) {
      if (!message.id) {
        continue;
      }

      const details = await gmail.users.messages.get({
        userId: 'me',
        id: message.id,
        format: 'full',
      });

      const payload = details.data.payload;
      const subject = this.findGmailHeader(payload?.headers, 'Subject') ?? '';
      const from = this.findGmailHeader(payload?.headers, 'From');
      const internalDate = Number(details.data.internalDate || Date.now());
      const receivedAt = new Date(internalDate);

      if (receivedAt < startAt || receivedAt > endAt) {
        continue;
      }

      emails.push({
        id: details.data.id ?? message.id,
        from,
        subject,
        bodyText: this.extractGmailText(payload),
        date: receivedAt.toISOString(),
      });
    }

    return emails;
  }

  private async fetchOutlookEmails(
    account: EmailAccountRecord,
    startAt: Date,
    endAt: Date,
  ): Promise<RawEmail[]> {
    if (!account.access_token) {
      throw new Error('Connected Outlook account is missing an access token');
    }

    let accessToken = account.access_token;

    if (account.token_expiry && account.refresh_token && new Date(account.token_expiry) <= new Date()) {
      const refreshed = await refreshOutlookToken(account.refresh_token);
      accessToken = refreshed.access_token;
    }

    const url = new URL('https://graph.microsoft.com/v1.0/me/messages');
    url.searchParams.set('$top', String(MAX_PROVIDER_MESSAGES));
    url.searchParams.set('$select', 'id,subject,from,receivedDateTime,body');
    url.searchParams.set(
      '$filter',
      `receivedDateTime ge ${startAt.toISOString()} and receivedDateTime le ${endAt.toISOString()}`,
    );

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'outlook.body-content-type="text"',
      },
    });

    if (!response.ok) {
      throw new Error(`Outlook message scan failed: ${await response.text()}`);
    }

    const data = (await response.json()) as {
      value?: Array<{
        id?: string;
        subject?: string;
        from?: { emailAddress?: { name?: string; address?: string } };
        receivedDateTime?: string;
        body?: { content?: string };
      }>;
    };

    return (data.value ?? [])
      .filter((message) => this.matchesSubscriptionKeywords(message.subject, message.body?.content))
      .map((message) => ({
        id: message.id ?? crypto.randomUUID(),
        from: message.from?.emailAddress?.name ?? message.from?.emailAddress?.address ?? null,
        subject: message.subject ?? '',
        bodyText: message.body?.content ?? '',
        date: message.receivedDateTime ?? startAt.toISOString(),
      }));
  }

  private findGmailHeader(
    headers: Array<{ name?: string | null; value?: string | null }> | undefined,
    headerName: string,
  ): string | null {
    const match = headers?.find((header) => header.name?.toLowerCase() === headerName.toLowerCase());
    return match?.value ?? null;
  }

  private extractGmailText(
    payload: {
      mimeType?: string;
      headers?: Array<{ name?: string | null; value?: string | null }>;
      body?: { data?: string | null };
      parts?: Array<any>;
    } | undefined,
  ): string {
    const parts = this.collectGmailParts(payload);
    const plainParts = parts.filter((part) => part.mimeType === 'text/plain');
    const htmlParts = parts.filter((part) => part.mimeType === 'text/html');
    const sources = plainParts.length > 0 ? plainParts : htmlParts;
    const combined = sources
      .map((part) => this.decodeGmailBody(part.body?.data))
      .filter(Boolean)
      .join('\n');

    return plainParts.length > 0 ? combined : combined.replace(/<[^>]+>/g, ' ');
  }

  private collectGmailParts(payload: any): any[] {
    if (!payload) {
      return [];
    }

    const parts: any[] = [];

    if (payload.mimeType && payload.body?.data) {
      parts.push(payload);
    }

    if (Array.isArray(payload.parts)) {
      for (const part of payload.parts) {
        parts.push(...this.collectGmailParts(part));
      }
    }

    return parts;
  }

  private decodeGmailBody(data?: string | null): string {
    if (!data) {
      return '';
    }

    return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  }

  private matchesSubscriptionKeywords(subject?: string, body?: string): boolean {
    const haystack = `${subject ?? ''}\n${body ?? ''}`.toLowerCase();
    return PROVIDER_KEYWORDS.some((keyword) => haystack.includes(keyword));
  }

  async triggerRescan(options: RescanOptions): Promise<RescanResult> {
    const { userId, emailAccountId, startDate, endDate, operatorId, ipAddress, userAgent } = options;
    const { startAt, endAt, windowDays } = this.validateOptions(options);
    const actorId = operatorId || userId;

    logger.info(`Starting email re-scan for user ${userId}, account ${emailAccountId}`);

    // Create a job tracking record
    const { data: job, error: jobError } = await supabase
      .from('rescan_jobs')
      .insert({
        user_id: userId,
        email_account_id: emailAccountId,
        start_date: startAt.toISOString(),
        end_date: endAt.toISOString(),
        status: 'in_progress',
        initiated_by: actorId
      })
      .select()
      .single();

    if (jobError) {
      logger.error('Failed to create rescan job:', jobError);
      throw new Error(`Failed to initialize rescan job: ${jobError.message}`);
    }

    try {
      await auditService.insertEntry({
        userId: actorId,
        action: 'email_rescan_requested',
        resourceType: 'rescan_job',
        resourceId: job.id,
        metadata: {
          targetUserId: userId,
          emailAccountId,
          startDate: startAt.toISOString(),
          endDate: endAt.toISOString(),
          replayWindowDays: windowDays,
        },
        ipAddress,
        userAgent,
      });

      // 1. Fetch bounded time range emails
      const emails = await this.fetchEmails(userId, emailAccountId, startAt, endAt);
      
      let processedCount = 0;
      let subscriptionsCreated = 0;
      let duplicatesSkipped = 0;

      for (const email of emails) {
        processedCount++;
        
        // 2. Re-parse the email using the current parser stack
        const candidate = await parseSubscriptionEmailWithFallback({
          subject: email.subject,
          from: email.from,
          body: email.bodyText,
        });
        
        // Only process high-confidence subscriptions parsed correctly
        if (!candidate || candidate.confidence < 0.8 || !candidate.name || candidate.amount == null || !candidate.interval) {
          continue;
        }

        // 3. Duplicate subscription creation is prevented
        const { duplicates } = await idempotencyService.findPotentialDuplicates(userId, {
          name: candidate.name,
          price: candidate.amount,
          billing_cycle: candidate.interval
        });

        if (duplicates && duplicates.length > 0) {
          duplicatesSkipped++;
          continue;
        }

        // 4. Create subscription
        const { error: insertError } = await supabase
          .from('subscriptions')
          .insert({
            user_id: userId,
            email_account_id: emailAccountId,
            name: candidate.name,
            price: candidate.amount,
            currency: candidate.currency || 'USD',
            billing_cycle: candidate.interval,
            status: 'active',
            source: 'email_rescan',
            date_added: new Date().toISOString()
          });

        if (insertError) {
          logger.error('Failed to create subscription during rescan:', insertError);
        } else {
          subscriptionsCreated++;
        }
      }

      // 5. Update job status
      await supabase.from('rescan_jobs').update({
        status: 'completed',
        processed_count: processedCount,
        subscriptions_created: subscriptionsCreated,
        duplicates_skipped: duplicatesSkipped,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', job.id);

      // 6. Audit logs record replay actions
      await auditService.insertEntry({
        userId: actorId,
        action: 'email_rescan_completed',
        resourceType: 'rescan_job',
        resourceId: job.id,
        metadata: {
          targetUserId: userId,
          emailAccountId,
          startDate: startAt.toISOString(),
          endDate: endAt.toISOString(),
          replayWindowDays: windowDays,
          processedCount,
          subscriptionsCreated,
          duplicatesSkipped,
        },
        ipAddress,
        userAgent,
      });

      return { jobId: job.id, status: 'completed', processedCount, subscriptionsCreated, duplicatesSkipped };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      await supabase.from('rescan_jobs').update({
        status: 'failed',
        error_message: errorMessage,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', job.id);
      await auditService.insertEntry({
        userId: actorId,
        action: 'email_rescan_failed',
        resourceType: 'rescan_job',
        resourceId: job.id,
        metadata: {
          targetUserId: userId,
          emailAccountId,
          startDate: startAt.toISOString(),
          endDate: endAt.toISOString(),
          replayWindowDays: windowDays,
          error: errorMessage,
        },
        ipAddress,
        userAgent,
      });

      return { jobId: job.id, status: 'failed', processedCount: 0, subscriptionsCreated: 0, duplicatesSkipped: 0, error: errorMessage };
    }
  }
}

export const emailRescanService = new EmailRescanService();
