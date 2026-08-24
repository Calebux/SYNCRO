/**
 * Unit tests for the hybrid subscription classifier (issue #1265).
 *
 * Covers the decision boundaries between the three pipeline stages —
 * rule lookup, DB cache and LLM fallback — plus name normalisation and
 * the validation applied to whatever the model returns.
 */

jest.mock('../src/config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  classifyService,
  normaliseServiceName,
  ruleBasedLookup,
  suggestCategory,
  VALID_CATEGORIES,
} from '../src/services/subscription-classifier';

// ─── Supabase test double ────────────────────────────────────────────────────

interface CacheStub {
  /** Row returned by the cache lookup, or null for a miss. */
  row: { category: string } | null;
  error?: { message: string } | null;
}

function makeSupabase(cache: CacheStub) {
  const upsert = jest.fn().mockResolvedValue({ error: null });
  const single = jest.fn().mockResolvedValue({
    data: cache.row,
    error: cache.error ?? (cache.row ? null : { message: 'not found' }),
  });
  const eq = jest.fn().mockReturnValue({ single });
  const select = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ select, upsert });

  return {
    client: { from } as unknown as SupabaseClient,
    spies: { from, select, eq, single, upsert },
  };
}

/** Queue a single Anthropic Messages API response. */
function mockLlmResponse(text: string) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ content: [{ text }] }),
  });
}

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn() as unknown as typeof fetch;
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
});

afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
});

// ─── normaliseServiceName ────────────────────────────────────────────────────

describe('normaliseServiceName', () => {
  it('lowercases and trims', () => {
    expect(normaliseServiceName('  NETFLIX  ')).toBe('netflix');
  });

  it('collapses internal whitespace', () => {
    expect(normaliseServiceName('Apple    Music')).toBe('apple music');
  });

  it('strips trademark symbols', () => {
    expect(normaliseServiceName('Notion™')).toBe('notion');
    expect(normaliseServiceName('Figma®')).toBe('figma');
  });

  it('drops a trailing "- Plan" suffix', () => {
    expect(normaliseServiceName('Spotify - Plan')).toBe('spotify');
    expect(normaliseServiceName('Spotify — plan')).toBe('spotify');
  });

  it('returns an empty string for non-string input', () => {
    expect(normaliseServiceName(null)).toBe('');
    expect(normaliseServiceName(undefined)).toBe('');
    expect(normaliseServiceName(42)).toBe('');
  });
});

// ─── ruleBasedLookup ─────────────────────────────────────────────────────────

describe('ruleBasedLookup', () => {
  it.each([
    ['Netflix', 'entertainment'],
    ['Spotify', 'entertainment'],
    ['Notion', 'productivity'],
    ['ChatGPT Plus', 'ai_tools'],
    ['GitHub Copilot', 'ai_tools'],
  ])('maps %s to %s with high confidence', (name, expected) => {
    const result = ruleBasedLookup(name);
    expect(result).toEqual({
      category: expected,
      confidence: 'high',
      source: 'rule_lookup',
    });
  });

  it('returns null for a service that is not in the table', () => {
    expect(ruleBasedLookup('Totally Unknown SaaS')).toBeNull();
  });

  it('returns null for an empty name', () => {
    expect(ruleBasedLookup('')).toBeNull();
  });

  it('only ever returns a category from VALID_CATEGORIES', () => {
    const result = ruleBasedLookup('Netflix');
    expect(VALID_CATEGORIES).toContain(result!.category);
  });
});

// ─── classifyService: stage selection ────────────────────────────────────────

describe('classifyService stage boundaries', () => {
  it('returns the rule result without touching the DB or the LLM', async () => {
    const { client, spies } = makeSupabase({ row: null });

    const result = await classifyService({ serviceName: 'Netflix', supabase: client });

    expect(result).toEqual({
      category: 'entertainment',
      confidence: 'high',
      source: 'rule_lookup',
    });
    expect(spies.from).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('falls through to the DB cache for an unknown service', async () => {
    const { client, spies } = makeSupabase({ row: { category: 'finance' } });

    const result = await classifyService({
      serviceName: 'Obscure Ledger App',
      supabase: client,
    });

    expect(result).toEqual({ category: 'finance', confidence: 'medium', source: 'cache' });
    expect(spies.from).toHaveBeenCalledWith('subscription_classifications');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('looks the cache up by the normalised name, not the raw one', async () => {
    const { client, spies } = makeSupabase({ row: { category: 'finance' } });

    await classifyService({ serviceName: '  Obscure   Ledger App™ ', supabase: client });

    expect(spies.eq).toHaveBeenCalledWith('service_name', 'obscure ledger app');
  });

  it('coerces an unrecognised cached category to "other"', async () => {
    const { client } = makeSupabase({ row: { category: 'not_a_real_category' } });

    const result = await classifyService({
      serviceName: 'Obscure Ledger App',
      supabase: client,
    });

    expect(result).toEqual({ category: 'other', confidence: 'medium', source: 'cache' });
  });

  it('skips the cache and calls the LLM when skipCache is set', async () => {
    const { client, spies } = makeSupabase({ row: { category: 'finance' } });
    mockLlmResponse('education');

    const result = await classifyService({
      serviceName: 'Obscure Ledger App',
      supabase: client,
      skipCache: true,
    });

    expect(spies.select).not.toHaveBeenCalled();
    expect(result).toEqual({ category: 'education', confidence: 'medium', source: 'llm' });
  });

  it('falls through to the LLM on a cache miss', async () => {
    const { client } = makeSupabase({ row: null });
    mockLlmResponse('infrastructure');

    const result = await classifyService({
      serviceName: 'Obscure Ledger App',
      supabase: client,
    });

    expect(result).toEqual({
      category: 'infrastructure',
      confidence: 'medium',
      source: 'llm',
    });
  });

  it('works with no Supabase client at all', async () => {
    mockLlmResponse('health');

    const result = await classifyService({ serviceName: 'Obscure Ledger App' });

    expect(result).toEqual({ category: 'health', confidence: 'medium', source: 'llm' });
  });

  it('persists an LLM result back to the cache under the normalised name', async () => {
    const { client, spies } = makeSupabase({ row: null });
    mockLlmResponse('education');

    await classifyService({ serviceName: 'Obscure   Ledger App', supabase: client });

    expect(spies.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ service_name: 'obscure ledger app', category: 'education' }),
      { onConflict: 'service_name' },
    );
  });
});

// ─── classifyService: LLM output validation ──────────────────────────────────

describe('classifyService LLM output handling', () => {
  it('normalises casing and whitespace in the model reply', async () => {
    mockLlmResponse('  Finance \n');

    const result = await classifyService({ serviceName: 'Obscure Ledger App' });

    expect(result.category).toBe('finance');
  });

  it('coerces an off-list model reply to "other" with low confidence', async () => {
    mockLlmResponse('banking-and-payments');

    const result = await classifyService({ serviceName: 'Obscure Ledger App' });

    expect(result).toEqual({ category: 'other', confidence: 'low', source: 'llm' });
  });

  it('treats a literal "other" reply as low confidence', async () => {
    mockLlmResponse('other');

    const result = await classifyService({ serviceName: 'Obscure Ledger App' });

    expect(result.confidence).toBe('low');
  });

  it('falls back to "other" when the API returns a non-2xx status', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    });

    const result = await classifyService({ serviceName: 'Obscure Ledger App' });

    expect(result).toEqual({ category: 'other', confidence: 'low', source: 'llm' });
  });

  it('falls back to "other" when the request throws', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('ECONNRESET'));

    const result = await classifyService({ serviceName: 'Obscure Ledger App' });

    expect(result).toEqual({ category: 'other', confidence: 'low', source: 'llm' });
  });

  it('does not call the API when ANTHROPIC_API_KEY is unset', async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const result = await classifyService({ serviceName: 'Obscure Ledger App' });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result).toEqual({ category: 'other', confidence: 'low', source: 'llm' });
  });
});

// ─── classifyService: degenerate input ───────────────────────────────────────

describe('classifyService input guards', () => {
  it.each([[''], [null], [undefined]])(
    'returns other/low/rule_lookup for %p without calling anything',
    async (name) => {
      const result = await classifyService({ serviceName: name as unknown as string });

      expect(result).toEqual({ category: 'other', confidence: 'low', source: 'rule_lookup' });
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );
});

// ─── suggestCategory ─────────────────────────────────────────────────────────

describe('suggestCategory', () => {
  it('suggests a category for a known service', () => {
    expect(suggestCategory('Netflix')).toEqual({
      suggestedCategory: 'entertainment',
      source: 'rule_lookup',
    });
  });

  it('returns null for an unknown service rather than guessing', () => {
    expect(suggestCategory('Totally Unknown SaaS')).toEqual({
      suggestedCategory: null,
      source: 'rule_lookup',
    });
  });

  it('returns null for an empty name', () => {
    expect(suggestCategory('')).toEqual({ suggestedCategory: null, source: 'rule_lookup' });
  });

  it('never calls the LLM', () => {
    suggestCategory('Obscure Ledger App');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
