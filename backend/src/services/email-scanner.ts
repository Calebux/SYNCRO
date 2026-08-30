/**
 * email-scanner.ts
 *
 * Privacy Contract
 * ────────────────
 * This module acts as a hard boundary between raw email content and the database.
 * Only receipt-relevant metadata (amounts, dates, sender identity, proof hashes)
 * may cross this boundary. The full email body is NEVER persisted.
 *
 * Any field that is not on the explicit whitelist in `metadataExtractionOnly` is
 * silently dropped before data is handed to the rest of the application or written
 * to storage. The `bodyExcluded: true` literal on every `ReceiptMetadata` object
 * is a machine-readable record of that intentional omission.
 */

import logger from '../config/logger'
import type { SupabaseClient } from '@supabase/supabase-js'

// ── Interfaces ────────────────────────────────────────────────────────────────

/**
 * The only shape that may be persisted to the database.
 *
 * `bodyExcluded: true` is a literal type that documents the intentional
 * omission of the email body from all persisted records. Every value that
 * carries this type has provably passed through the metadata-extraction
 * whitelist and therefore contains no raw email content.
 */
export interface ReceiptMetadata {
  provider: string
  messageId: string | null
  threadId: string | null
  receivedAt: string | null
  from: string | null
  subject: string | null
  name: string | null
  amount: number | null
  currency: string | null
  interval: string | null
  signals: string[]
  confidence: number
  proof: {
    hash: string
    contentHash: string | null
    algorithm: 'sha256'
  }
  /** Literal true — documents that the email body is intentionally not persisted. */
  bodyExcluded: true
}

/**
 * What the Gmail/Outlook services produce before filtering.
 *
 * Contains the same receipt-relevant fields as `ReceiptMetadata` (minus the
 * `bodyExcluded` sentinel) and adds an open index signature so that
 * `metadataExtractionOnly` can detect and warn on any extra/unknown fields
 * before they reach the database.
 */
export interface RawScanResult {
  provider: string
  messageId: string | null
  threadId: string | null
  receivedAt: string | null
  from: string | null
  subject: string | null
  name: string | null
  amount: number | null
  currency: string | null
  interval: string | null
  signals: string[]
  confidence: number
  proof: {
    hash: string
    contentHash: string | null
    algorithm: 'sha256'
  }
  /** Open index signature — allows catching extra/unknown fields for stripping. */
  [key: string]: unknown
}

// ── Exported functions ────────────────────────────────────────────────────────

/**
 * Applies a strict whitelist to an array of raw scan results, returning only
 * the fields that are safe to persist.
 *
 * Design decisions:
 * - Explicit destructuring names every permitted field; anything not named is
 *   automatically excluded from the returned objects.
 * - `body` and `rawContent` are explicitly bound to `_body` / `_rawContent` so
 *   that the intentional discard is visible to code reviewers and linters.
 * - Any remaining keys land in `...unknownFields` and trigger a `logger.warn`
 *   so that new upstream fields are surfaced in logs rather than silently lost.
 */
export function metadataExtractionOnly(rawResults: RawScanResult[]): ReceiptMetadata[] {
  return rawResults.map((result) => {
    // Whitelist destructure — only the named fields survive into `clean`.
    // `_body` and `_rawContent` are explicitly declared and discarded to make
    // the intentional omission of email body content impossible to overlook.
    const {
      provider,
      messageId,
      threadId,
      receivedAt,
      from,
      subject,
      name,
      amount,
      currency,
      interval,
      signals,
      confidence,
      proof,
      body: _body,
      rawContent: _rawContent,
      ...unknownFields
    } = result

    const unknownKeys = Object.keys(unknownFields)
    if (unknownKeys.length > 0) {
      logger.warn(
        '[email-scanner] metadataExtractionOnly: stripped unexpected fields from scan result',
        { unknownKeys, provider, messageId },
      )
    }

    const clean: ReceiptMetadata = {
      provider,
      messageId,
      threadId,
      receivedAt,
      from,
      subject,
      name,
      amount,
      currency,
      interval,
      signals,
      confidence,
      proof,
      bodyExcluded: true as const,
    }

    logger.info('[email-scanner] Receipt metadata extracted', {
      provider,
      messageId,
      receivedAt,
      amount,
      currency,
      interval,
      confidence,
      signalCount: signals.length,
      hasProof: !!proof?.hash,
      bodyExcluded: true,
    })

    return clean
  })
}

/**
 * Persists an array of `ReceiptMetadata` records to the `audit_logs` table
 * via the supplied Supabase client.
 *
 * Accepting a `SupabaseClient` as a parameter (rather than importing a
 * singleton) keeps this function testable and avoids a hard dependency on the
 * database configuration module.
 *
 * Only metadata that has already been filtered by `metadataExtractionOnly` is
 * accepted here — the type signature enforces this at compile time.
 */
export async function logScanMetadata(
  userId: string,
  metadata: ReceiptMetadata[],
  supabaseClient: SupabaseClient,
): Promise<void> {
  if (metadata.length === 0) return

  const rows = metadata.map((m) => ({
    user_id: userId,
    action: 'email_receipt_extracted' as const,
    resource_type: 'email_scan' as const,
    resource_id: m.messageId,
    metadata: {
      provider:    m.provider,
      receivedAt:  m.receivedAt,
      from:        m.from,
      subject:     m.subject,
      name:        m.name,
      amount:      m.amount,
      currency:    m.currency,
      interval:    m.interval,
      signals:     m.signals,
      confidence:  m.confidence,
      proof:       m.proof,
      bodyExcluded: true,
    },
  }))

  const { error } = await supabaseClient.from('audit_logs').insert(rows)

  if (error) {
    logger.error('[email-scanner] Failed to log scan metadata', { error: error.message })
    throw error
  }

  logger.info(
    `[email-scanner] Persisted ${rows.length} receipt metadata records to audit_logs`,
    { userId, count: rows.length },
  )
}
