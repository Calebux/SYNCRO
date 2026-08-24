import pLimit from 'p-limit';
import logger from '../config/logger';
import { getMerchantCanonicalForm } from '../../utils/merchant-normalizer';
import { ExternalServiceClient } from '../utils/external-service-client';
import { ACTIVE_PROMPT_VERSION, getPrompt } from './llm-prompts';
import { llmBudgetService, type TokenUsage } from './llm-budget-service';
import { TemplateCache, templateFingerprint } from './llm-template-cache';

/** The fields the model is asked to extract. */
export interface LLMParsedFields {
  name: string | null;
  amount: number | null;
  currency: string | null;
  interval: string | null;
  confidence: number;
}

/**
 * A parse result, plus the provenance needed to attribute cost and to tie an
 * accuracy change back to the prompt that caused it (issue #1281).
 */
export interface LLMParsedSubscription extends LLMParsedFields {
  /** Prompt version that produced this result. */
  promptVersion: string;
  /** Tokens billed for this result — all zero when served from cache. */
  tokenUsage: TokenUsage;
  /** True when a cached template parse was reused instead of calling the model. */
  cached: boolean;
}

/** Per-call attribution, threaded through from the caller (e.g. a rescan job). */
export interface LLMParseContext {
  userId?: string;
  /** Rescan job id, so one scan's spend can be totalled. */
  scanId?: string;
}

/** Why a parse produced no result — lets callers degrade deliberately. */
export type LLMSkipReason =
  | 'disabled'
  | 'user_budget_exhausted'
  | 'global_budget_exhausted'
  | 'parse_failed';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const ZERO_USAGE: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

/** Shape of the Gemini generateContent response we depend on. */
interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export class LLMParser {
  private apiKey: string | null;
  private client = new ExternalServiceClient('llm');
  private cache = new TemplateCache<LLMParsedFields>();
  /** Reason the most recent parse returned null, for the caller's logs. */
  private lastSkipReason: LLMSkipReason | null = null;

  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY ?? null;
    if (!this.apiKey) {
      logger.warn('LLMParser: GEMINI_API_KEY not set — LLM fallback disabled');
    }
  }

  get isAvailable(): boolean {
    return !!this.apiKey;
  }

  get skipReason(): LLMSkipReason | null {
    return this.lastSkipReason;
  }

  get cacheStats() {
    return this.cache.stats;
  }

  /** Test hook. */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Parse one email.
   *
   * Order matters: cache first (free), then the budget check (cheap, and the
   * thing that bounds spend), then the model. Returning null is the deliberate
   * degradation path — callers fall back to heuristic parsing rather than
   * failing the scan.
   */
  async parse(
    emailText: string,
    context: LLMParseContext = {},
  ): Promise<LLMParsedSubscription | null> {
    this.lastSkipReason = null;

    if (!this.apiKey) {
      this.lastSkipReason = 'disabled';
      return null;
    }

    const prompt = getPrompt(ACTIVE_PROMPT_VERSION);
    const truncated = emailText.slice(0, 8000);

    // Fingerprint covers the prompt version too: a prompt roll must not serve
    // results produced by the previous one.
    const fingerprint = templateFingerprint(`${prompt.version}\n${truncated}`);

    const cached = this.cache.get(fingerprint);
    if (cached) {
      return { ...cached, promptVersion: prompt.version, tokenUsage: { ...ZERO_USAGE }, cached: true };
    }

    const decision = llmBudgetService.canSpend(context.userId);
    if (!decision.allowed) {
      this.lastSkipReason = decision.reason ?? 'global_budget_exhausted';
      logger.warn('LLMParser: budget exhausted — falling back to heuristic parsing', {
        reason: decision.reason,
        userId: context.userId,
        scanId: context.scanId,
      });
      return null;
    }

    try {
      const url = `${GEMINI_API_BASE}/${prompt.model}:generateContent?key=${this.apiKey}`;
      const data = await this.client.request<GeminiResponse>(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt.text }, { text: `\n\nEmail text:\n${truncated}` }],
            },
          ],
          generationConfig: {
            temperature: prompt.temperature,
            maxOutputTokens: prompt.maxOutputTokens,
          },
        }),
      });

      const usage = readUsage(data);
      llmBudgetService.record(usage, {
        userId: context.userId,
        scanId: context.scanId,
        promptVersion: prompt.version,
        model: prompt.model,
      });

      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const parsed = JSON.parse(raw.trim()) as LLMParsedFields;

      // Normalize the merchant name through known patterns
      const normalizedName = parsed.name ? getMerchantCanonicalForm(parsed.name) : null;
      const fields: LLMParsedFields = { ...parsed, name: normalizedName };

      this.cache.set(fingerprint, fields);

      logger.info('LLMParser: parsed subscription', {
        name: parsed.name,
        normalizedName,
        confidence: parsed.confidence,
        promptVersion: prompt.version,
        totalTokens: usage.totalTokens,
        scanId: context.scanId,
      });

      return { ...fields, promptVersion: prompt.version, tokenUsage: usage, cached: false };
    } catch (err) {
      this.lastSkipReason = 'parse_failed';
      logger.error('LLMParser: failed to parse Gemini response', { err });
      return null;
    }
  }

  /**
   * Parse a batch of emails.
   *
   * The Gemini generateContent endpoint has no multi-prompt form, so "batching"
   * here means the two things that actually cut spend on a large mailbox:
   * identical templates within the batch collapse to a single model call, and
   * the remaining calls run under a bounded concurrency limit instead of a
   * stampede. Budget cutoffs still apply per call, so a batch degrades to
   * heuristic parsing partway through rather than blowing the budget.
   */
  async parseMany(
    emailTexts: string[],
    context: LLMParseContext = {},
    concurrency = Number(process.env.LLM_PARSE_CONCURRENCY ?? 4),
  ): Promise<Array<LLMParsedSubscription | null>> {
    const limit = pLimit(Math.max(1, concurrency));
    const inFlight = new Map<string, Promise<LLMParsedSubscription | null>>();
    const prompt = getPrompt(ACTIVE_PROMPT_VERSION);

    return Promise.all(
      emailTexts.map((text) => {
        const key = templateFingerprint(`${prompt.version}\n${text.slice(0, 8000)}`);
        // Collapse duplicates *within* the batch too, not just across batches:
        // otherwise N identical receipts all miss the cache concurrently.
        const existing = inFlight.get(key);
        if (existing) return existing;

        const task = limit(() => this.parse(text, context));
        inFlight.set(key, task);
        return task;
      }),
    );
  }
}

/** Gemini reports usage in `usageMetadata`; treat a missing field as zero. */
function readUsage(data: GeminiResponse): TokenUsage {
  const meta = data?.usageMetadata ?? {};
  const promptTokens = meta.promptTokenCount ?? 0;
  const completionTokens = meta.candidatesTokenCount ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: meta.totalTokenCount ?? promptTokens + completionTokens,
  };
}

export const llmParser = new LLMParser();
