/**
 * email-to-subscription-pipeline.ts
 *
 * Orchestrates: email scan metadata → regex/LLM parse → subscription create payload.
 * Used by provider scanners (Gmail/Outlook/iCloud/Yahoo) and covered by e2e fixtures.
 */

import { createHash } from 'crypto';
import { parseSubscriptionEmailWithFallback } from './email-parser';
import { metadataExtractionOnly, type RawScanResult, type ReceiptMetadata } from './email-scanner';

export type EmailProvider = 'gmail' | 'outlook' | 'icloud' | 'yahoo';

export interface RawEmailFixture {
  provider: EmailProvider;
  messageId: string;
  subject: string;
  from: string;
  body: string;
  receivedAt?: string;
}

export interface SubscriptionCreateInput {
  name: string;
  price: number;
  billing_cycle: 'monthly' | 'yearly' | 'weekly' | 'quarterly';
  currency: string;
  provider: string;
  status: 'active';
  notes: string;
  email_message_id: string;
}

export interface PipelineResult {
  metadata: ReceiptMetadata;
  createBody: SubscriptionCreateInput;
  parseConfidence: number;
  usedLlmFallback: boolean;
}

function mapInterval(interval: string | null): SubscriptionCreateInput['billing_cycle'] {
  switch ((interval ?? '').toLowerCase()) {
    case 'yearly':
    case 'annual':
      return 'yearly';
    case 'weekly':
      return 'weekly';
    case 'quarterly':
      return 'quarterly';
    default:
      return 'monthly';
  }
}

/**
 * Full detection path for one email:
 * 1. Regex parse (+ LLM fallback when confidence < 0.9)
 * 2. email-scanner whitelist (body never persisted)
 * 3. Build subscription-creation body
 */
export async function runEmailToSubscriptionPipeline(
  email: RawEmailFixture,
): Promise<PipelineResult | null> {
  const parsed = await parseSubscriptionEmailWithFallback({
    subject: email.subject,
    from: email.from,
    body: email.body,
  });

  if (!parsed || !parsed.name || parsed.amount == null) {
    return null;
  }

  // Heuristic: high-confidence regex path skips LLM; low confidence may have used it.
  const usedLlmFallback = parsed.confidence < 0.9 || parsed.signals.length === 0;

  const contentHash = createHash('sha256')
    .update(`${email.subject}\n${email.body}`)
    .digest('hex');

  const raw: RawScanResult = {
    provider: email.provider,
    messageId: email.messageId,
    threadId: null,
    receivedAt: email.receivedAt ?? new Date().toISOString(),
    from: email.from,
    subject: email.subject,
    name: parsed.name,
    amount: parsed.amount,
    currency: parsed.currency,
    interval: parsed.interval,
    signals: parsed.signals,
    confidence: parsed.confidence,
    proof: {
      hash: contentHash,
      contentHash,
      algorithm: 'sha256',
    },
    // Intentionally present so scanner strips it
    body: email.body,
    rawContent: email.body,
  };

  const [metadata] = metadataExtractionOnly([raw]);
  if (!metadata) return null;

  const createBody: SubscriptionCreateInput = {
    name: parsed.name,
    price: parsed.amount,
    billing_cycle: mapInterval(parsed.interval),
    currency: (parsed.currency ?? 'USD').toUpperCase(),
    provider: email.provider,
    status: 'active',
    notes: `Detected from ${email.provider} email ${email.messageId}`,
    email_message_id: email.messageId,
  };

  return {
    metadata,
    createBody,
    parseConfidence: parsed.confidence,
    usedLlmFallback,
  };
}
