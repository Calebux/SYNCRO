import { supabase } from '../config/database';
import logger from '../config/logger';

export const USAGE_RETENTION_POLICY = {
  receipts: { years: 2, reason: 'Preserves signed evidence beyond the standard dispute window.' },
  usageEvents: { years: 2, reason: 'Supports reconciliation and accounting after request metadata is redacted.' },
  settledPayments: { years: 7, reason: 'Supports long-term financial reporting and statutory accounting.' },
} as const;

export type RetentionSource = 'v3_receipts' | 'meter_usage_ledger' | 'channel_payments';

export interface RetentionRecord {
  id: string;
  channelId?: string;
  data: Record<string, unknown>;
}

export interface UsageRetentionRepository {
  getOpenDisputeChannelIds(): Promise<Set<string>>;
  listExpired(source: RetentionSource, cutoff: string, limit: number, afterId?: string): Promise<RetentionRecord[]>;
  archiveAndDelete(source: RetentionSource, rows: RetentionRecord[], archivedAt: string): Promise<void>;
}

class SupabaseUsageRetentionRepository implements UsageRetentionRepository {
  async getOpenDisputeChannelIds(): Promise<Set<string>> {
    const { data, error } = await supabase
      .from('payment_channels')
      .select('id, channel_id')
      .eq('state', 'dispute');
    if (error) throw new Error(`Failed to list channels with open disputes: ${error.message}`);
    return new Set((data ?? []).flatMap((row) => [String(row.id), row.channel_id]));
  }

  async listExpired(source: RetentionSource, cutoff: string, limit: number, afterId?: string): Promise<RetentionRecord[]> {
    const idColumn = source === 'v3_receipts' ? 'receipt_id' : 'id';
    let query = source === 'v3_receipts'
      ? supabase.from(source).select('*').lt('issued_at', cutoff)
      : source === 'meter_usage_ledger'
        ? supabase.from(source).select('*').neq('status', 'reserved').lt('reserved_at', cutoff)
        : supabase.from(source).select('*').lt('created_at', cutoff);
    if (afterId) query = query.gt(idColumn, afterId);
    const result = await query.order(idColumn).limit(limit);

    if (result.error) throw new Error(`Failed to scan expired ${source} rows: ${result.error.message}`);
    return (result.data ?? []).map((row) => {
      const id = source === 'v3_receipts' ? row.receipt_id : String(row.id);
      const channelId = source === 'v3_receipts' ? row.channel_id : source === 'channel_payments' ? String(row.channel_id) : undefined;
      return { id, channelId, data: row as Record<string, unknown> };
    });
  }

  async archiveAndDelete(source: RetentionSource, rows: RetentionRecord[], archivedAt: string): Promise<void> {
    if (rows.length === 0) return;
    const archiveRows = rows.map((row) => ({
      source_table: source,
      source_id: row.id,
      archived_at: archivedAt,
      data: row.data,
    }));
    const { error: archiveError } = await supabase
      .from('usage_retention_archive')
      .upsert(archiveRows, { onConflict: 'source_table,source_id', ignoreDuplicates: true });
    if (archiveError) throw new Error(`Failed to archive ${source} rows: ${archiveError.message}`);

    const ids = rows.map((row) => row.id);
    const deleteResult = source === 'v3_receipts'
      ? await supabase.from(source).delete().in('receipt_id', ids)
      : await supabase.from(source).delete().in('id', ids);
    if (deleteResult.error) {
      throw new Error(`Failed to remove archived ${source} rows: ${deleteResult.error.message}`);
    }
  }
}

function cutoffByYears(now: Date, years: number): string {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  return cutoff.toISOString();
}

function redactUsageMetadata(data: Record<string, unknown>): Record<string, unknown> {
  return {
    ...data,
    route: '[REDACTED_AFTER_DISPUTE_WINDOW]',
    correlation_id: null,
    settlement_ref: null,
  };
}

export class UsageRetentionArchiver {
  constructor(
    private readonly repository: UsageRetentionRepository = new SupabaseUsageRetentionRepository(),
    private readonly batchSize = 500,
  ) {}

  async run(now = new Date()): Promise<Record<RetentionSource, number>> {
    const disputes = await this.repository.getOpenDisputeChannelIds();
    const archived: Record<RetentionSource, number> = {
      v3_receipts: 0,
      meter_usage_ledger: 0,
      channel_payments: 0,
    };
    const sources: Array<{ source: RetentionSource; years: number }> = [
      { source: 'v3_receipts', years: USAGE_RETENTION_POLICY.receipts.years },
      { source: 'meter_usage_ledger', years: USAGE_RETENTION_POLICY.usageEvents.years },
      { source: 'channel_payments', years: USAGE_RETENTION_POLICY.settledPayments.years },
    ];

    for (const { source, years } of sources) {
      const cutoff = cutoffByYears(now, years);
      let afterId: string | undefined;
      while (true) {
        const rows = await this.repository.listExpired(source, cutoff, this.batchSize, afterId);
        if (rows.length === 0) break;
        afterId = rows[rows.length - 1].id;
        const eligible = rows.filter((row) => !row.channelId || !disputes.has(row.channelId));
        const rowsToArchive = eligible.map((row) => source === 'meter_usage_ledger'
          ? { ...row, data: redactUsageMetadata(row.data) }
          : row);
        await this.repository.archiveAndDelete(source, rowsToArchive, now.toISOString());
        archived[source] += rowsToArchive.length;
        logger.info('Archived expired usage data', {
          source,
          archived: rowsToArchive.length,
          skippedOpenDisputes: rows.length - eligible.length,
        });
        if (rows.length < this.batchSize) break;
      }
    }

    return archived;
  }
}

export const usageRetentionArchiver = new UsageRetentionArchiver();
