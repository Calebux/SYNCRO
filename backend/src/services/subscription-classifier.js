'use strict';

/**
 * subscription-classifier.js
 *
 * Hybrid classification pipeline:
 *   1. Rule-based lookup  → instant, zero-cost
 *   2. DB cache           → free, avoids repeat LLM calls
 *   3. LLM (Claude Haiku) → flexible fallback for unknown services
 */

const SERVICE_CATEGORIES = require('./service-categories');

// ─── Constants ───────────────────────────────────────────────────────────────

const VALID_CATEGORIES = [
  'entertainment',
  'productivity',
  'ai_tools',
  'infrastructure',
  'education',
  'health',
  'finance',
  'other',
];

const LLM_MODEL   = 'claude-haiku-4-5-20251001';
const LLM_API_URL = 'https://api.anthropic.com/v1/messages';

// ─── Normalisation helper ─────────────────────────────────────────────────────

/**
 * Normalise a service name for consistent lookups.
 * Strips punctuation that is unlikely to be meaningful, collapses whitespace.
 *
 * @param {string} name
 * @returns {string}
 */
function normaliseServiceName(name) {
  if (typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')          // collapse internal whitespace
    .replace(/[™®©]/g, '')         // strip trademark symbols
    .replace(/\s*[-–—]\s*plan$/i, '') // drop "- Plan" suffix
    .trim();
}

// ─── Rule-based lookup ────────────────────────────────────────────────────────

/**
 * Look up a service in the static lookup table.
 *
 * @param {string} serviceName
 * @returns {{ category: string, confidence: string, source: string } | null}
 */
function ruleBasedLookup(serviceName) {
  const key = normaliseServiceName(serviceName);
  const category = SERVICE_CATEGORIES[key];
  if (!category) return null;
  return { category, confidence: 'high', source: 'rule_lookup' };
}

// ─── DB cache helpers ─────────────────────────────────────────────────────────

/**
 * Check whether a classification exists in the DB cache.
 *
 * @param {object} supabase   - Supabase client (or any compatible DB client)
 * @param {string} serviceName  - Already normalised
 * @returns {Promise<{ category: string, confidence: string, source: string } | null>}
 */
async function checkDbCache(supabase, serviceName) {
  try {
    const { data, error } = await supabase
      .from('subscription_classifications')
      .select('category')
      .eq('service_name', serviceName)
      .single();

    if (error || !data) return null;
    return { category: data.category, confidence: 'medium', source: 'cache' };
  } catch {
    return null;
  }
}

/**
 * Persist an LLM classification result to the DB cache.
 *
 * @param {object} supabase
 * @param {string} serviceName - Already normalised
 * @param {string} category
 */
async function saveToDbCache(supabase, serviceName, category) {
  try {
    await supabase
      .from('subscription_classifications')
      .upsert(
        { service_name: serviceName, category, created_at: new Date().toISOString() },
        { onConflict: 'service_name' },
      );
  } catch (err) {
    // Non-fatal — log but do not bubble
    console.error('[classifier] Failed to cache classification:', err.message);
  }
}

// ─── LLM classification ───────────────────────────────────────────────────────

/**
 * Classify an unknown service using Claude Haiku.
 *
 * @param {string} serviceName
 * @param {string} [serviceUrl]
 * @returns {Promise<{ category: string, confidence: string, source: string }>}
 */
async function llmClassify(serviceName, serviceUrl = '') {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[classifier] ANTHROPIC_API_KEY not set — falling back to "other"');
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

    const data = await response.json();
    const raw  = (data?.content?.[0]?.text ?? '').trim().toLowerCase();

    // Validate the returned category
    const category = VALID_CATEGORIES.includes(raw) ? raw : 'other';
    const confidence = category === 'other' ? 'low' : 'medium';

    return { category, confidence, source: 'llm' };
  } catch (err) {
    console.error('[classifier] LLM classification failed:', err.message);
    return { category: 'other', confidence: 'low', source: 'llm' };
  }
}

// ─── Main classify function ───────────────────────────────────────────────────

/**
 * Classify a subscription service through the full pipeline:
 *   rule lookup → DB cache → LLM
 *
 * @param {object} options
 * @param {string}  options.serviceName
 * @param {string}  [options.serviceUrl]
 * @param {object}  options.supabase     - Supabase client
 * @param {boolean} [options.skipCache]  - Force LLM call (used for reclassify)
 * @returns {Promise<{ category: string, confidence: string, source: string }>}
 */
async function classifyService({ serviceName, serviceUrl = '', supabase, skipCache = false }) {
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
    saveToDbCache(supabase, normalised, llmResult.category);
  }

  return llmResult;
}

// ─── Convenience: suggest category (for frontend chips) ──────────────────────

/**
 * Lightweight lookup for frontend suggestion chips.
 * Only uses the static table — no DB or LLM call.
 *
 * @param {string} partialName
 * @returns {{ suggestedCategory: string | null, source: string }}
 */
function suggestCategory(partialName) {
  if (!partialName) return { suggestedCategory: null, source: 'rule_lookup' };
  const result = ruleBasedLookup(partialName);
  return {
    suggestedCategory: result ? result.category : null,
    source: 'rule_lookup',
  };
}

module.exports = {
  classifyService,
  suggestCategory,
  ruleBasedLookup,
  normaliseServiceName,
  VALID_CATEGORIES,
};