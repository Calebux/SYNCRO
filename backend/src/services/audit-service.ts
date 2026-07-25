import { supabase } from '../config/database';
import logger from '../config/logger';
import { getRequestId } from '../middleware/requestContext';
import {
  computeEntryHash,
  verifyChainRows,
  type AuditLogRow,
  type ChainVerificationResult,
} from './audit-chain';

// ─── Structured Security Event Types ─────────────────────────────────────────

export type SecurityEventSeverity = 'low' | 'medium' | 'high' | 'critical';

export type SecurityEventType =
  | 'auth.jwt_invalid'
  | 'auth.jwt_expired'
  | 'auth.rate_limited'
  | 'auth.unauthorized_access'
  | 'mfa.recovery_code_failed'
  | 'mfa.recovery_code_generated'
  | 'mfa.disabled'
  | 'mfa.failure_threshold_reached'
  | 'webhook.auto_disabled'
  | 'webhook.dead_letter_exhausted'
  | 'webhook.anomalous_failure_rate'
  | 'api_key.created'
  | 'api_key.rotated'
  | 'api_key.revoked'
  | 'api_key.auth_failed'
  | 'api_key.suspicious_usage'
  | 'session.invalidated_all'
  | 'session.revoked';

export interface SecurityEventMeta {
  severity: SecurityEventSeverity;
  actorId?: string;
  resourceType: string;
  resourceId?: string;
  ipAddress?: string;
  userAgent?: string;
  reason?: string;
  details?: Record<string, unknown>;
}

/**
 * Emit a structured security event.
 * These events are written to the audit_logs table with a dedicated security
 * resource type prefix and structured metadata for downstream detection and
 * retention tooling.
 */
export async function emitSecurityEvent(
  eventType: SecurityEventType,
  meta: SecurityEventMeta,
): Promise<void> {
  await auditService.insertEntry({
    userId: meta.actorId,
    action: eventType,
    resourceType: `security.${meta.resourceType}`,
    resourceId: meta.resourceId,
    metadata: {
      severity: meta.severity,
      correlationId: getRequestId(),
      reason: meta.reason,
      details: meta.details ?? null,
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

// ─── API Key lifecycle event types ───────────────────────────────────────────
export type ApiKeyEvent = 'api_key.created' | 'api_key.rotated' | 'api_key.revoked' | 'api_key.auth_failed';

export interface ApiKeyAuditMeta {
  keyId?: string;
  keyName?: string;
  scopes?: string[];
  ipAddress?: string;
  userAgent?: string;
  reason?: string;
}

/**
 * Log an API key lifecycle event.
 * Actor = the authenticated user performing the action (or undefined for failed auth).
 * Target = the key being acted upon.
 */
export async function auditApiKeyEvent(
  event: ApiKeyEvent,
  actorId: string | undefined,
  meta: ApiKeyAuditMeta,
): Promise<void> {
  await auditService.insertEntry({
    userId: actorId,
    action: event,
    resourceType: 'api_key',
    resourceId: meta.keyId,
    metadata: {
      keyName: meta.keyName,
      scopes: meta.scopes,
      correlationId: getRequestId(),
      reason: meta.reason,
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

export interface AuditEntry {
  userId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditEventBatch {
  events: AuditEntry[];
}

/** How many times to retry an insert that lost a race for a sequence number. */
const CHAIN_WRITE_RETRIES = 3;

/**
 * Supabase surfaces failures as plain `PostgrestError` objects rather than
 * `Error` instances, so `instanceof` alone would swallow the message.
 */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return 'Unknown error';
}

class AuditService {
  /**
   * Serializes chain writes within this process, so two concurrent requests
   * cannot read the same chain tip and claim the same sequence number. Across
   * processes the unique index on `sequence` makes the loser's insert fail, and
   * `appendChained` retries against the new tip.
   */
  private chainLock: Promise<unknown> = Promise.resolve();

  /** Queue `task` behind any in-flight chain write. */
  private withChainLock<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chainLock.then(task, task);
    // Keep the lock chain alive even when a write rejects.
    this.chainLock = run.catch(() => undefined);
    return run;
  }

  /** Read the current tip of the chain: its sequence number and hash. */
  private async readChainTip(): Promise<{ sequence: number; hash: string | null }> {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('sequence, entry_hash')
      .not('sequence', 'is', null)
      .order('sequence', { ascending: false })
      .limit(1);

    if (error) throw error;

    const tip = (data ?? [])[0] as { sequence?: number | null; entry_hash?: string | null } | undefined;
    if (!tip || tip.sequence == null) {
      return { sequence: 0, hash: null };
    }

    return { sequence: Number(tip.sequence), hash: tip.entry_hash ?? null };
  }

  /** Turn entries into chained rows starting from the given tip. */
  private buildChainedRows(
    entries: readonly AuditEntry[],
    tip: { sequence: number; hash: string | null },
  ): Record<string, unknown>[] {
    let sequence = tip.sequence;
    let prevHash = tip.hash;

    return entries.map((entry) => {
      sequence += 1;
      const createdAt = new Date().toISOString();

      const entryHash = computeEntryHash({
        sequence,
        userId:       entry.userId ?? null,
        action:       entry.action,
        resourceType: entry.resourceType,
        resourceId:   entry.resourceId ?? null,
        metadata:     entry.metadata ?? null,
        ipAddress:    entry.ipAddress ?? null,
        userAgent:    entry.userAgent ?? null,
        createdAt,
        prevHash,
      });

      const row = {
        user_id: entry.userId || null,
        action: entry.action,
        resource_type: entry.resourceType,
        resource_id: entry.resourceId || null,
        metadata: entry.metadata || null,
        ip_address: entry.ipAddress || null,
        user_agent: entry.userAgent || null,
        created_at: createdAt,
        sequence,
        prev_hash: prevHash,
        entry_hash: entryHash,
      };

      prevHash = entryHash;
      return row;
    });
  }

  /**
   * Append entries to the hash chain (issue #1081).
   *
   * Reads the chain tip, links the new rows onto it and inserts them. If
   * another process claimed the same sequence numbers first, the unique index
   * rejects the insert and we retry against the new tip.
   */
  private appendChained(
    entries: readonly AuditEntry[],
    select: boolean,
  ): Promise<{ data: unknown[] | null }> {
    return this.withChainLock(async () => {
      let lastError: unknown = null;

      for (let attempt = 0; attempt < CHAIN_WRITE_RETRIES; attempt++) {
        const tip = await this.readChainTip();
        const rows = this.buildChainedRows(entries, tip);

        const query = supabase.from('audit_logs').insert(rows);
        const { data, error } = select ? await query.select() : await query;

        if (!error) return { data: (data as unknown[] | null) ?? null };

        lastError = error;

        // 23505 = unique_violation: we lost the race for these sequence numbers.
        if ((error as { code?: string }).code !== '23505') break;

        logger.warn('Audit chain write raced with another writer, retrying', {
          attempt: attempt + 1,
        });
      }

      throw lastError;
    });
  }

  /**
   * Validate an audit entry
   */
  private validateEntry(entry: AuditEntry): { valid: boolean; error?: string } {
    if (!entry.action || typeof entry.action !== 'string') {
      return { valid: false, error: 'action is required and must be a string' };
    }

    if (!entry.resourceType || typeof entry.resourceType !== 'string') {
      return { valid: false, error: 'resourceType is required and must be a string' };
    }

    if (entry.metadata && typeof entry.metadata !== 'object') {
      return { valid: false, error: 'metadata must be an object' };
    }

    return { valid: true };
  }

  /**
   * Insert a single audit entry
   */
  async insertEntry(entry: AuditEntry): Promise<{ success: boolean; error?: string }> {
    const validation = this.validateEntry(entry);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    try {
      await this.appendChained([entry], false);
      return { success: true };
    } catch (error) {
      logger.error('Exception while inserting audit log:', error);
      return {
        success: false,
        error: errorMessage(error),
      };
    }
  }

  /**
   * Insert a batch of audit entries
   */
  async insertBatch(entries: AuditEntry[]): Promise<{ success: boolean; inserted: number; failed: number; errors: string[] }> {
    const errors: string[] = [];
    let inserted = 0;
    let failed = 0;

    // Validate all entries first
    const validEntries = entries.filter((entry) => {
      const validation = this.validateEntry(entry);
      if (!validation.valid) {
        errors.push(`${validation.error}`);
        failed++;
        return false;
      }
      return true;
    });

    if (validEntries.length === 0) {
      logger.warn('No valid entries in batch for audit logging');
      return { success: false, inserted: 0, failed, errors };
    }

    try {
      const { data } = await this.appendChained(validEntries, true);

      inserted = data?.length || validEntries.length;

      logger.info(`Batch audit logging successful: ${inserted} entries inserted`);
      return { success: true, inserted, failed, errors };
    } catch (error) {
      logger.error('Exception while inserting audit log batch:', error);
      const errorMsg = errorMessage(error);
      errors.push(errorMsg);
      return { success: false, inserted: 0, failed: entries.length, errors };
    }
  }

  /**
   * Query audit logs for a specific user
   */
  async getUserLogs(
    userId: string,
    options?: {
      action?: string;
      resourceType?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<AuditEntry[]> {
    try {
      let query = supabase
        .from('audit_logs')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (options?.action) {
        query = query.eq('action', options.action);
      }

      if (options?.resourceType) {
        query = query.eq('resource_type', options.resourceType);
      }

      const limit = options?.limit || 100;
      const offset = options?.offset || 0;

      query = query.range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) {
        logger.error('Error fetching user audit logs:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      logger.error('Exception while fetching user audit logs:', error);
      return [];
    }
  }

  /**
   * Query all audit logs (admin only)
   */
  async getAllLogs(options?: {
    action?: string;
    resourceType?: string;
    userId?: string;
    limit?: number;
    offset?: number;
    startDate?: string;
    endDate?: string;
  }): Promise<AuditEntry[]> {
    try {
      let query = supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false });

      if (options?.action) {
        query = query.eq('action', options.action);
      }

      if (options?.resourceType) {
        query = query.eq('resource_type', options.resourceType);
      }

      if (options?.userId) {
        query = query.eq('user_id', options.userId);
      }

      if (options?.startDate) {
        query = query.gte('created_at', options.startDate);
      }

      if (options?.endDate) {
        query = query.lte('created_at', options.endDate);
      }

      const limit = options?.limit || 100;
      const offset = options?.offset || 0;

      query = query.range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) {
        logger.error('Error fetching all audit logs:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      logger.error('Exception while fetching all audit logs:', error);
      return [];
    }
  }

  /**
   * Verify the audit log hash chain (issue #1081).
   *
   * Re-reads entries in sequence order, recomputes each `entry_hash` and checks
   * that every entry links to the one before it. Detects in-place edits
   * (`hash_mismatch`), deletions (`missing_entry`) and re-signed or reordered
   * entries (`broken_link`).
   *
   * When verifying a window that does not start at the genesis entry, the row
   * immediately before the window is fetched so the first link can be checked
   * too.
   */
  async verifyChain(options?: {
    startSequence?: number;
    endSequence?: number;
    limit?: number;
  }): Promise<ChainVerificationResult> {
    const limit = Math.min(options?.limit ?? 1000, 10000);

    let query = supabase
      .from('audit_logs')
      .select('*')
      .not('sequence', 'is', null)
      .order('sequence', { ascending: true })
      .limit(limit);

    if (options?.startSequence !== undefined) {
      query = query.gte('sequence', options.startSequence);
    }
    if (options?.endSequence !== undefined) {
      query = query.lte('sequence', options.endSequence);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('Error reading audit log chain:', error);
      throw error;
    }

    const rows = (data ?? []) as AuditLogRow[];

    // For a partial range, anchor the first link against the preceding entry.
    let expectedPrevHash: string | null | undefined;
    const firstSequence = rows[0]?.sequence == null ? null : Number(rows[0].sequence);

    if (firstSequence !== null && firstSequence > 1) {
      const { data: predecessor } = await supabase
        .from('audit_logs')
        .select('entry_hash')
        .eq('sequence', firstSequence - 1)
        .limit(1);

      const previousRow = (predecessor ?? [])[0] as { entry_hash?: string | null } | undefined;
      // If the predecessor is missing entirely, leave the anchor undefined —
      // the gap is reported by the caller's own range, not as a broken link.
      expectedPrevHash = previousRow ? previousRow.entry_hash ?? null : undefined;
    } else if (firstSequence === 1) {
      expectedPrevHash = null; // Genesis entry must not link to anything.
    }

    const result = verifyChainRows(rows, expectedPrevHash);

    if (!result.valid) {
      logger.error('Audit log chain verification FAILED', {
        entriesChecked: result.entriesChecked,
        issues: result.issues.length,
      });
    }

    return result;
  }

  /**
   * Get audit logs count
   */
  async getLogsCount(options?: {
    action?: string;
    resourceType?: string;
    userId?: string;
  }): Promise<number> {
    try {
      let query = supabase.from('audit_logs').select('*', { count: 'exact', head: true });

      if (options?.action) {
        query = query.eq('action', options.action);
      }

      if (options?.resourceType) {
        query = query.eq('resource_type', options.resourceType);
      }

      if (options?.userId) {
        query = query.eq('user_id', options.userId);
      }

      const { count, error } = await query;

      if (error) {
        logger.error('Error counting audit logs:', error);
        return 0;
      }

      return count || 0;
    } catch (error) {
      logger.error('Exception while counting audit logs:', error);
      return 0;
    }
  }
}

export const auditService = new AuditService();

// Re-export for convenience
export { AuditService };
