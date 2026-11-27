import { supabase } from '../lib/supabase';
import { getLogger } from '../utils/logger';

const logger = getLogger('archival-index');

/**
 * Archival metadata status.
 */
export enum ArchivalStatus {
  Archived = 'archived',
  Retained = 'retained',
  Purged = 'purged',
}

/**
 * Archival metadata record.
 */
export interface ArchivalRecord {
  id: string;
  entryKey: string;
  entryType: string;
  snapshotPath: string;
  snapshotHash: string;
  txHash: string;
  txSequence: number;
  archivalTimestamp: string;
  expiryTimestamp: string;
  operatorId: string;
  status: ArchivalStatus;
  retentionExpiresAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Archival Index manages metadata for archived entries.
 * Stores archival records in the database for persistence and auditing.
 */
export class ArchivalIndex {
  private tableName = 'archival_index';

  /**
   * Insert a new archival record.
   */
  async insertArchival(
    entryKey: string,
    entryType: string,
    snapshotPath: string,
    snapshotHash: string,
    txHash: string,
    txSequence: number,
    expiryTimestamp: string,
    operatorId: string,
    retentionExpiresAt: string,
  ): Promise<ArchivalRecord> {
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from(this.tableName)
      .insert([
        {
          entry_key: entryKey,
          entry_type: entryType,
          snapshot_path: snapshotPath,
          snapshot_hash: snapshotHash,
          tx_hash: txHash,
          tx_sequence: txSequence,
          archival_timestamp: now,
          expiry_timestamp: expiryTimestamp,
          operator_id: operatorId,
          status: ArchivalStatus.Archived,
          retention_expires_at: retentionExpiresAt,
        },
      ])
      .select()
      .single();

    if (error) {
      logger.error('Failed to insert archival record', { error, entryKey });
      throw new Error(`Failed to insert archival record: ${error.message}`);
    }

    logger.info('Archival record inserted', {
      id: data.id,
      entryKey,
      entryType,
      snapshotHash,
    });

    return this.mapRowToRecord(data);
  }

  /**
   * Retrieve an archival record by entry key.
   */
  async getArchivalByEntryKey(entryKey: string): Promise<ArchivalRecord | null> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select()
      .eq('entry_key', entryKey)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows found
      logger.error('Failed to retrieve archival record', { error, entryKey });
      throw new Error(`Failed to retrieve archival record: ${error.message}`);
    }

    return data ? this.mapRowToRecord(data) : null;
  }

  /**
   * Retrieve archival records by status.
   */
  async getArchivalsByStatus(status: ArchivalStatus, limit: number = 100): Promise<ArchivalRecord[]> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select()
      .eq('status', status)
      .limit(limit)
      .order('archival_timestamp', { ascending: true });

    if (error) {
      logger.error('Failed to retrieve archival records by status', { error, status });
      throw new Error(`Failed to retrieve archival records: ${error.message}`);
    }

    return data?.map((row) => this.mapRowToRecord(row)) || [];
  }

  /**
   * Get all archived entries ready for purge (retention expired).
   */
  async getArchivedReadyForPurge(): Promise<ArchivalRecord[]> {
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from(this.tableName)
      .select()
      .eq('status', ArchivalStatus.Archived)
      .lte('retention_expires_at', now)
      .order('retention_expires_at', { ascending: true });

    if (error) {
      logger.error('Failed to retrieve archived entries ready for purge', { error });
      throw new Error(`Failed to retrieve archived entries: ${error.message}`);
    }

    return data?.map((row) => this.mapRowToRecord(row)) || [];
  }

  /**
   * Update archival record status.
   */
  async updateArchivalStatus(entryKey: string, status: ArchivalStatus): Promise<ArchivalRecord> {
    const { data, error } = await supabase
      .from(this.tableName)
      .update({ status, updated_at: new Date().toISOString() })
      .eq('entry_key', entryKey)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update archival status', { error, entryKey, status });
      throw new Error(`Failed to update archival status: ${error.message}`);
    }

    logger.info('Archival status updated', { entryKey, status });
    return this.mapRowToRecord(data);
  }

  /**
   * Delete an archival record (after retention window and admin approval).
   */
  async deleteArchival(entryKey: string): Promise<void> {
    const { error } = await supabase
      .from(this.tableName)
      .delete()
      .eq('entry_key', entryKey);

    if (error) {
      logger.error('Failed to delete archival record', { error, entryKey });
      throw new Error(`Failed to delete archival record: ${error.message}`);
    }

    logger.info('Archival record deleted', { entryKey });
  }

  /**
   * Get count of archived entries by type.
   */
  async getArchivalCountByType(): Promise<Record<string, number>> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('entry_type, count', { count: 'exact' })
      .groupBy('entry_type');

    if (error) {
      logger.error('Failed to count archived entries by type', { error });
      throw new Error(`Failed to count archived entries: ${error.message}`);
    }

    const counts: Record<string, number> = {};
    for (const row of data || []) {
      counts[row.entry_type] = row.count;
    }
    return counts;
  }

  /**
   * Check if an entry is already archived.
   */
  async isArchived(entryKey: string): Promise<boolean> {
    const record = await this.getArchivalByEntryKey(entryKey);
    return record !== null && record.status === ArchivalStatus.Archived;
  }

  /**
   * Map database row to ArchivalRecord interface.
   */
  private mapRowToRecord(row: any): ArchivalRecord {
    return {
      id: row.id,
      entryKey: row.entry_key,
      entryType: row.entry_type,
      snapshotPath: row.snapshot_path,
      snapshotHash: row.snapshot_hash,
      txHash: row.tx_hash,
      txSequence: row.tx_sequence,
      archivalTimestamp: row.archival_timestamp,
      expiryTimestamp: row.expiry_timestamp,
      operatorId: row.operator_id,
      status: row.status as ArchivalStatus,
      retentionExpiresAt: row.retention_expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

/**
 * Get the ArchivalIndex singleton.
 */
let cachedIndex: ArchivalIndex | null = null;

export function getArchivalIndex(): ArchivalIndex {
  if (!cachedIndex) {
    cachedIndex = new ArchivalIndex();
  }
  return cachedIndex;
}

/**
 * Reset the ArchivalIndex cache (for testing).
 */
export function resetArchivalIndex(): void {
  cachedIndex = null;
}
