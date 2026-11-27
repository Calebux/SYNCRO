/**
 * Idempotency Service
 * Provides request deduplication and replay protection.
 */

import { createClient } from '@/lib/supabase/server'
import crypto from 'crypto'

export interface IdempotencyRecord<TResponse = unknown> {
  id: string
  key: string
  user_id: string
  request_hash: string
  response_status: number
  response_body: TResponse
  created_at: string
  expires_at: string
}

export class IdempotencyService {
  private readonly ttlHours = 24

  /**
   * Hash request payload for idempotency checking
   */
  hashRequest(payload: any): string {
    const serialized = JSON.stringify(payload || {})
    return crypto
      .createHash('sha256')
      .update(serialized)
      .digest('hex')
  }

  /**
   * Check if request is idempotent and return cached response if exists
   */
  async checkIdempotency(
    key: string,
    userId: string,
    requestHash: string
  ): Promise<{ isDuplicate: boolean; cachedResponse?: { status: number; body: any } }> {
    try {
      const supabase = await createClient()
      const { data: existing, error } = await supabase
        .from('idempotency_keys')
        .select('*')
        .eq('key', key)
        .eq('user_id', userId)
        .eq('request_hash', requestHash)
        .gt('expires_at', new Date().toISOString())
        .single()

      if (error) {
        if (error.code !== 'PGRST116') {
          console.error('[Idempotency] check error:', error)
        }
        return { isDuplicate: false }
      }

      if (existing) {
        return {
          isDuplicate: true,
          cachedResponse: {
            status: existing.response_status,
            body: existing.response_body,
          },
        }
      }

      return { isDuplicate: false }
    } catch (error) {
      console.error('[Idempotency] check failed:', error)
      return { isDuplicate: false }
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
    responseBody: any
  ): Promise<void> {
    try {
      const expiresAt = new Date()
      expiresAt.setHours(expiresAt.getHours() + this.ttlHours)

      const supabase = await createClient()
      const { error } = await supabase.from('idempotency_keys').insert({
        key,
        user_id: userId,
        request_hash: requestHash,
        response_status: responseStatus,
        response_body: responseBody,
        expires_at: expiresAt.toISOString(),
      })

      if (error) {
        console.warn('[Idempotency] store failed:', error)
      }
    } catch (error) {
      console.error('[Idempotency] storage failed:', error)
    }
  }
}

export const idempotencyService = new IdempotencyService()
