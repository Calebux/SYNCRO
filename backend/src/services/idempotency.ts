import { supabase } from '../config/database';
import logger from '../config/logger';
import crypto from 'crypto';

export interface IdempotencyRecord<TResponse = unknown> {
  id: string;
  key: string;
  user_id: string;
  route: string;
  request_hash: string;
  response_status: number;
  response_body: TResponse;
  created_at: string;
  expires_at: string;
}

/**
 * Default `route` value for callers that predate route-scoping (e.g. the
 * internal renewal orchestrator, which uses this table as a generic
 * dedup store rather than for an HTTP route). Keeping this distinct from
 * any real "METHOD /path" string means it can never collide with a route
 * looked up by the idempotency middleware.
 */
const UNSCOPED_ROUTE = '*';

export interface TypedIdempotentResponse<TResponse = unknown> {
  status: number;
  body: TResponse;
  idempotencyKey: string;
}

export interface SerializablePayload {
  toJSON(): string;
}

export type SerializableInput = string | number | boolean | null | undefined | 
  SerializableObject | SerializableArray;

interface SerializableObject {
  [key: string]: SerializableInput;
}

interface SerializableArray extends Array<SerializableInput> {}

/**
 * Idempotency service to prevent duplicate operations
 * Uses request hashing and key-based deduplication
 */
export class IdempotencyService<TPayload extends SerializableInput = SerializableInput, TResponse = unknown> {
  private readonly ttlHours = 24; 

  /**
   * Generate idempotency key from request
   */
  generateKey(userId: string, operation: string, payload: TPayload): string {
    const payloadHash = crypto
      .createHash('sha256')
      .update(this.serializePayload(payload))
      .digest('hex')
      .substring(0, 16);

    return `${userId}:${operation}:${payloadHash}`;
  }

  /**
   * Look up an idempotency record by (key, user, route) alone — regardless
   * of whether the stored request_hash matches the caller's current
   * request. Callers (the idempotency middleware) compare the hash
   * themselves so they can distinguish a safe replay from a reused key
   * with a different body (409).
   */
  async checkKey(
    key: string,
    userId: string,
    route: string
  ): Promise<{ record: IdempotencyRecord<TResponse> | null }> {
    try {
      const { data: existing, error } = await supabase
        .from('idempotency_keys')
        .select('*')
        .eq('key', key)
        .eq('user_id', userId)
        .eq('route', route)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (error) {
        // Log but don't throw - idempotency is best-effort and must never
        // be the reason a legitimate request fails.
        logger.error('Idempotency key lookup error:', error);
        return { record: null };
      }

      return { record: (existing as IdempotencyRecord<TResponse>) ?? null };
    } catch (error) {
      logger.error('Idempotency key lookup failed:', error);
      return { record: null };
    }
  }

  /**
   * Check if request is idempotent and return cached response if exists
   *
   * @deprecated kept for backward compatibility with the hash-scoped
   * lookup path. New callers should use {@link checkKey}, which is
   * route-scoped and lets the caller decide replay vs. conflict.
   */
  async checkIdempotency(
    key: string,
    userId: string,
    requestHash: string
  ): Promise<{ isDuplicate: boolean; cachedResponse?: TypedIdempotentResponse<TResponse> }> {
    try {
      // Check for existing idempotency record
      const { data: existing, error } = await supabase
        .from('idempotency_keys')
        .select('*')
        .eq('key', key)
        .eq('user_id', userId)
        .eq('request_hash', requestHash)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (error && error.code !== 'PGRST116') {
        // Log but don't throw - idempotency is best-effort
        logger.error('Idempotency check error:', error);
        // Continue on error - don't block the request
        return { isDuplicate: false };
      }

      if (existing) {
        logger.info('Idempotent request detected', { key, userId });
        return {
          isDuplicate: true,
          cachedResponse: {
            status: existing.response_status,
            body: existing.response_body,
            idempotencyKey: key,
          },
        };
      }

      return { isDuplicate: false };
    } catch (error) {
      logger.error('Idempotency check failed:', error);
      return { isDuplicate: false };
    }
  }

  /**
   * Store idempotency record with response
   */
  async storeResponse(
    key: string,
    userId: string,
    requestHash: string,
    responseStatus: number,
    responseBody: TResponse,
    route: string = UNSCOPED_ROUTE
  ): Promise<void> {
    try {
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + this.ttlHours);

      const { error } = await supabase.from('idempotency_keys').insert({
        key,
        user_id: userId,
        route,
        request_hash: requestHash,
        response_status: responseStatus,
        response_body: responseBody,
        expires_at: expiresAt.toISOString(),
      });

      if (error) {
        // A unique-violation here means two concurrent requests raced to
        // store the same (key, user, route) — the first writer wins and
        // the loser's response was already served to its caller, so this
        // is expected under concurrency and not an error worth failing
        // the request over.
        if (error.code === '23505') {
          logger.info('Idempotency record already stored by a concurrent request', {
            key,
            userId,
            route,
          });
        } else {
          // Log but don't throw - idempotency is best-effort
          logger.warn('Failed to store idempotency record:', error);
        }
      }
    } catch (error) {
      logger.error('Idempotency storage failed:', error);
      // Don't throw - idempotency storage failure shouldn't break the request
    }
  }

  /**
   * Type-safe serialization for hash input
   */
  private serializePayload(payload: TPayload): string {
    return JSON.stringify(payload);
  }

  /**
   * Hash request payload for idempotency checking
   */
  hashRequest(payload: TPayload): string {
    return crypto
      .createHash('sha256')
      .update(this.serializePayload(payload))
      .digest('hex');
  }

  /**
   * Find potential duplicate subscriptions for a user across all email accounts.
   * Uses fuzzy name matching + exact price/cycle matching.
   * Returns subscriptions that are likely duplicates of the candidate.
   */
  async findPotentialDuplicates(
    userId: string,
    candidate: { name: string; price: number; billing_cycle: string }
  ): Promise<{ duplicates: any[]; message: string | null }> {
    try {
      const { data: existing, error } = await supabase
        .from('subscriptions')
        .select('id, name, price, billing_cycle, email_account_id, status')
        .eq('user_id', userId)
        .neq('status', 'deleted');

      if (error) {
        logger.error('findPotentialDuplicates query error:', error);
        return { duplicates: [], message: null };
      }

      const normalize = (s: string) =>
        s.toLowerCase()
          .replace(/\s+(plus|pro|premium|basic|standard|enterprise|team|business)$/i, '')
          .replace(/[^a-z0-9]/g, '');

      const levenshtein = (a: string, b: string): number => {
        const m: number[][] = Array.from({ length: b.length + 1 }, (_, i) => [i]);
        for (let j = 0; j <= a.length; j++) m[0][j] = j;
        for (let i = 1; i <= b.length; i++)
          for (let j = 1; j <= a.length; j++)
            m[i][j] = b[i - 1] === a[j - 1]
              ? m[i - 1][j - 1]
              : Math.min(m[i - 1][j - 1], m[i][j - 1], m[i - 1][j]) + 1;
        return m[b.length][a.length];
      };

      const fuzzyMatch = (s1: string, s2: string): boolean => {
        const n1 = normalize(s1);
        const n2 = normalize(s2);
        if (n1 === n2) return true;
        const dist = levenshtein(n1, n2);
        return dist / Math.max(n1.length, n2.length) < 0.2;
      };

      const duplicates = (existing || []).filter((sub) => {
        const nameMatch = fuzzyMatch(candidate.name, sub.name);
        const priceMatch = Math.abs(sub.price - candidate.price) < 0.01;
        const cycleMatch = sub.billing_cycle === candidate.billing_cycle;
        return nameMatch && priceMatch && cycleMatch;
      });

      const message =
        duplicates.length > 0
          ? 'We found a similar subscription already registered.'
          : null;

      return { duplicates, message };
    } catch (err) {
      logger.error('findPotentialDuplicates failed:', err);
      return { duplicates: [], message: null };
    }
  }

  async cleanupExpiredKeys(): Promise<number> {
    try {
      const { data, error } = await supabase
        .from('idempotency_keys')
        .delete()
        .lt('expires_at', new Date().toISOString())
        .select('id');

      if (error) {
        logger.error('Idempotency cleanup error:', error);
        return 0;
      }

      const deletedCount = data?.length || 0;
      logger.info(`Cleaned up ${deletedCount} expired idempotency keys`);
      return deletedCount;
    } catch (error) {
      logger.error('Idempotency cleanup failed:', error);
      return 0;
    }
  }
}

// Type-safe factory function for creating typed idempotency services
export function createIdempotencyService<TPayload extends SerializableInput = SerializableInput, TResponse = unknown>(): IdempotencyService<TPayload, TResponse> {
  return new IdempotencyService<TPayload, TResponse>();
}

// Default untyped instance for backward compatibility
export const idempotencyService = new IdempotencyService();
