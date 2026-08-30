/**
 * subscription-classifier.ts
 *
 * Hybrid classification pipeline:
 *   1. Rule-based lookup  → instant, zero-cost
 *   2. DB cache           → free, avoids repeat LLM calls
 *   3. LLM (Claude Haiku) → flexible fallback for unknown services
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import SERVICE_CATEGORIES from './service-categories';
import { env } from '../config/env';
import logger from '../config/logger';

// ─── Types ─────────────────────────────────────────────────────────────────

export type Category =
  | 'entertainment'
  | 'productivity'
  | 'ai_tools'
  | 'infrastructure'
  | 'education'
  | 'health'
  | 'finance'
  | 'other';

export type Confidence = 'high' | 'medium' | 'low';

export type ClassificationSource = 'rule_lookup' | 'cache' | 'llm';

export interface ClassificationResult {
  category: Category;
  confidence: Confidence;
  source: ClassificationSource;
}

export interface ClassifyServiceOptions {
  serviceName: string;
  serviceUrl?: string;
  /** Supabase client (or any compatible DB client). */
  supabase?: SupabaseClient | null;
  /** Force LLM call, bypassing the DB cache (used for reclassify). */
  skipCache?: boolean;
}

export interface CategorySuggestion {
  suggestedCategory: Category | null;
  source: 'rule_lookup';
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const VALID_CATEGORIES: readonly Category[] = [
  'entertainment',
  'productivity',
  'ai_tools',
  'infrastructure',
  'education',
  'health',
  'finance',
  'other',
];

const LLM_MODEL = 'claude-haiku-4-5-20251001';
const LLM_API_URL = 'https://api.anthropic.com/v1/messages';

function isValidCategory(value: string): value is Category {
  return (VALID_CATEGORIES as readonly string[]).includes(value);
}

// ─── Normalisation helper ─────────────────────────────────────────────────────

/**
 * Normalise a service name for consistent lookups.
 * Strips punctuation that is unlikely to be meaningful, collapses whitespace.
 */
export function normaliseServiceName(name: unknown): string {
  if (typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ') // collapse internal whitespace
    .replace(/[™®©]/g, '') // strip trademark symbols
    .replace(/\s*[-–—]\s*plan$/i, '') // drop "- Plan" suffix
    .trim();
}

// ─── Rule-based lookup ────────────────────────────────────────────────────────

/**
 * Look up a service in the static lookup table.
 */
export function ruleBasedLookup(serviceName: string): ClassificationResult | null {
  const key = normaliseServiceName(serviceName);
  const category = SERVICE_CATEGORIES[key];
  if (!category || !isValidCategory(category)) return null;
  return { category, confidence: 'high', source: 'rule_lookup' };
}

// ─── DB cache helpers ─────────────────────────────────────────────────────────

/**
 * Check whether a classification exists in the DB cache.
 *
 * @param serviceName Already normalised.
 */
async function checkDbCache(
  supabase: SupabaseClient,
  serviceName: string,
): Promise<ClassificationResult | null> {
  try {
    const { data, error } = await supabase
      .from('subscription_classifications')
      .select('category')
      .eq('service_name', serviceName)
      .single();

    if (error || !data) return null;
    const category: Category = isValidCategory(data.category) ? data.category : 'other';
    return { category, confidence: 'medium', source: 'cache' };
  } catch {
    return null;
  }
}

/**
 * Persist an LLM classification result to the DB cache.
 *
 * @param serviceName Already normalised.
 */
async function saveToDbCache(
  supabase: SupabaseClient,
  serviceName: string,
  category: Category,
): Promise<void> {
  try {
    await supabase
      .from('subscription_classifications')
      .upsert(
        { service_name: serviceName, category, created_at: new Date().toISOString() },
        { onConflict: 'service_name' },
      );
  } catch (err) {
    // Non-fatal — log but do not bubble
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[classifier] Failed to cache classification', { error: message });
  }
}

// ─── LLM classification ───────────────────────────────────────────────────────

/**
 * Classify an unknown service using Claude Haiku.
 */
async function llmClassify(
  serviceName: string,
  serviceUrl = '',
): Promise<ClassificationResult> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.warn('[classifier] ANTHROPIC_API_KEY not set — falling back to "other"');
    return { category: 'other', confidence: 'low', source: 'llm' };
  }

  const urlHint = serviceUrl ? ` (${serviceUrl})` : '';
  const prompt = `Classify this subscription service into exactly one category.

Service: ${serviceName}${urlHint}

Available categories:
entertainment
productivity
ai_tools
infrastructure
education
health
finance
other

Rules:
- Reply with ONLY the category name, nothing else.
- If unsure, reply: other`;

  try {
    const response = await fetch(LLM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        max_tokens: 10,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LLM API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as {
      content?: Array<{ text?: string }>;
    };
    const raw = (data?.content?.[0]?.text ?? '').trim().toLowerCase();

    // Validate the returned category
    const category: Category = isValidCategory(raw) ? raw : 'other';
    const confidence: Confidence = category === 'other' ? 'low' : 'medium';

    return { category, confidence, source: 'llm' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[classifier] LLM classification failed', { error: message });
    return { category: 'other', confidence: 'low', source: 'llm' };
  }
}

// ─── Main classify function ───────────────────────────────────────────────────

/**
 * Classify a subscription service through the full pipeline:
 *   rule lookup → DB cache → LLM
 */
export async function classifyService({
  serviceName,
  serviceUrl = '',
  supabase,
  skipCache = false,
}: ClassifyServiceOptions): Promise<ClassificationResult> {
  if (!serviceName || typeof serviceName !== 'string') {
    return { category: 'other', confidence: 'low', source: 'rule_lookup' };
  }

  const normalised = normaliseServiceName(serviceName);

  // ── 1. Rule-based lookup ────────────────────────────────────────────────
  const ruleResult = ruleBasedLookup(normalised);
  if (ruleResult) return ruleResult;

  // ── 2. DB cache ─────────────────────────────────────────────────────────
  if (!skipCache && supabase) {
    const cached = await checkDbCache(supabase, normalised);
    if (cached) return cached;
  }

  // ── 3. LLM fallback ─────────────────────────────────────────────────────
  const llmResult = await llmClassify(normalised, serviceUrl);

  // Persist to cache (fire-and-forget — we don't need to await)
  if (supabase) {
    void saveToDbCache(supabase, normalised, llmResult.category);
  }

  return llmResult;
}

// ─── Convenience: suggest category (for frontend chips) ──────────────────────

/**
 * Lightweight lookup for frontend suggestion chips.
 * Only uses the static table — no DB or LLM call.
 */
export function suggestCategory(partialName: string): CategorySuggestion {
  if (!partialName) return { suggestedCategory: null, source: 'rule_lookup' };
  const result = ruleBasedLookup(partialName);
  return {
    suggestedCategory: result ? result.category : null,
    source: 'rule_lookup',
  };
}
