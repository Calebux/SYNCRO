/**
 * LLM parser cost controls, caching and prompt versioning (issue #1281).
 */

const mockRequest = jest.fn();

jest.mock('../src/utils/external-service-client', () => ({
  ExternalServiceClient: jest.fn().mockImplementation(() => ({ request: mockRequest })),
}));

jest.mock('../src/config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../src/config/database', () => ({
  supabase: { from: jest.fn(() => ({ insert: jest.fn().mockResolvedValue({ error: null }) })) },
}));

import logger from '../src/config/logger';
import { LLMParser } from '../src/services/llm-parser';
import { llmBudgetService, estimateCostUsd } from '../src/services/llm-budget-service';
import { templateFingerprint, TemplateCache } from '../src/services/llm-template-cache';
import { ACTIVE_PROMPT_VERSION, getPrompt, SUBSCRIPTION_PARSER_PROMPTS } from '../src/services/llm-prompts';

const ENV_KEYS = [
  'GEMINI_API_KEY',
  'LLM_BUDGET_USER_DAILY_USD',
  'LLM_BUDGET_GLOBAL_DAILY_USD',
  'LLM_BUDGET_ALERT_THRESHOLD',
] as const;

const savedEnv: Record<string, string | undefined> = {};

/** A Gemini reply for a Netflix-style receipt, with usage metadata. */
function geminiReply(
  fields: Partial<{ name: string; amount: number; currency: string; interval: string; confidence: number }> = {},
  usage = { promptTokenCount: 1000, candidatesTokenCount: 100, totalTokenCount: 1100 },
) {
  const payload = {
    name: 'Netflix',
    amount: 15.99,
    currency: 'USD',
    interval: 'monthly',
    confidence: 0.95,
    ...fields,
  };
  return {
    candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    usageMetadata: usage,
  };
}

function makeParser() {
  return new LLMParser();
}

beforeAll(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.LLM_BUDGET_USER_DAILY_USD = '1';
  process.env.LLM_BUDGET_GLOBAL_DAILY_USD = '50';
  process.env.LLM_BUDGET_ALERT_THRESHOLD = '0.8';
  llmBudgetService.reset();
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

// ─── Prompt versioning ───────────────────────────────────────────────────────

describe('prompt versioning', () => {
  it('exposes the active version in the registry', () => {
    expect(SUBSCRIPTION_PARSER_PROMPTS[ACTIVE_PROMPT_VERSION]).toBeDefined();
  });

  it('throws on an unknown version rather than silently substituting one', () => {
    expect(() => getPrompt('does-not-exist')).toThrow(/Unknown subscription parser prompt version/);
  });

  it('records the prompt version on every parse result', async () => {
    mockRequest.mockResolvedValueOnce(geminiReply());
    const result = await makeParser().parse('Your Netflix receipt for $15.99/month');

    expect(result?.promptVersion).toBe(ACTIVE_PROMPT_VERSION);
  });

  it('sends the registered prompt text and generation config', async () => {
    mockRequest.mockResolvedValueOnce(geminiReply());
    await makeParser().parse('Your Netflix receipt for $15.99/month');

    const body = JSON.parse(mockRequest.mock.calls[0][1].body);
    const prompt = getPrompt();
    expect(body.contents[0].parts[0].text).toBe(prompt.text);
    expect(body.generationConfig).toEqual({
      temperature: prompt.temperature,
      maxOutputTokens: prompt.maxOutputTokens,
    });
  });
});

// ─── Token accounting ────────────────────────────────────────────────────────

describe('token usage accounting', () => {
  it('records the token usage reported by the model', async () => {
    mockRequest.mockResolvedValueOnce(geminiReply());
    const result = await makeParser().parse('Your Netflix receipt for $15.99/month');

    expect(result?.tokenUsage).toEqual({
      promptTokens: 1000,
      completionTokens: 100,
      totalTokens: 1100,
    });
    expect(result?.cached).toBe(false);
  });

  it('derives a total when the model omits one', async () => {
    mockRequest.mockResolvedValueOnce(
      geminiReply({}, { promptTokenCount: 800, candidatesTokenCount: 50 } as never),
    );
    const result = await makeParser().parse('Your Netflix receipt for $15.99/month');

    expect(result?.tokenUsage.totalTokens).toBe(850);
  });

  it('treats missing usage metadata as zero rather than throwing', async () => {
    mockRequest.mockResolvedValueOnce({
      candidates: [{ content: { parts: [{ text: '{"name":"Netflix","amount":1,"currency":"USD","interval":"monthly","confidence":0.9}' }] } }],
    });
    const result = await makeParser().parse('Your Netflix receipt');

    expect(result?.tokenUsage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });

  it('prices a known model from its rate card', () => {
    const cost = estimateCostUsd('gemini-1.5-flash', {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      totalTokens: 2_000_000,
    });
    expect(cost).toBeCloseTo(0.375, 6);
  });

  it('prices an unknown model pessimistically rather than as free', () => {
    const cost = estimateCostUsd('some-future-model', {
      promptTokens: 1_000_000,
      completionTokens: 0,
      totalTokens: 1_000_000,
    });
    expect(cost).toBeGreaterThan(0);
  });
});

// ─── Template fingerprint cache ──────────────────────────────────────────────

describe('template fingerprinting', () => {
  it('collapses two deliveries of the same template that differ only by date and id', () => {
    const may = 'Your receipt. Invoice INV-2026-0512. Renewed on 2026-05-01. Charged $15.99/month.';
    const june = 'Your receipt. Invoice INV-2026-0613. Renewed on 2026-06-01. Charged $15.99/month.';

    expect(templateFingerprint(may)).toBe(templateFingerprint(june));
  });

  it('keeps amounts significant so a price change is not served a stale parse', () => {
    const cheap = 'Your receipt. Renewed on 2026-05-01. Charged $15.99/month.';
    const dear = 'Your receipt. Renewed on 2026-05-01. Charged $17.99/month.';

    expect(templateFingerprint(cheap)).not.toBe(templateFingerprint(dear));
  });

  it('ignores whitespace and casing differences', () => {
    expect(templateFingerprint('Your   RECEIPT\n\nCharged $9.99')).toBe(
      templateFingerprint('your receipt charged $9.99'),
    );
  });

  it('normalises per-recipient URLs and email addresses away', () => {
    const a = 'Manage at https://example.com/a/abc123 or mail billing@merchant.example. $9.99/month';
    const b = 'Manage at https://example.com/a/zzz999 or mail support@merchant.example. $9.99/month';

    expect(templateFingerprint(a)).toBe(templateFingerprint(b));
  });
});

describe('TemplateCache', () => {
  it('evicts the least recently used entry past its bound', () => {
    const cache = new TemplateCache<string>(2, 60_000);
    cache.set('a', 'A');
    cache.set('b', 'B');
    cache.get('a');            // 'a' is now the most recent
    cache.set('c', 'C');       // evicts 'b'

    expect(cache.get('a')).toBe('A');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe('C');
  });

  it('expires entries once the TTL has passed', () => {
    const cache = new TemplateCache<string>(10, 5);
    cache.set('a', 'A');
    const later = Date.now() + 50;
    const spy = jest.spyOn(Date, 'now').mockReturnValue(later);

    expect(cache.get('a')).toBeUndefined();
    spy.mockRestore();
  });

  it('reports a hit rate', () => {
    const cache = new TemplateCache<string>(10, 60_000);
    cache.set('a', 'A');
    cache.get('a');
    cache.get('missing');

    expect(cache.stats).toMatchObject({ hits: 1, misses: 1, hitRate: 0.5 });
  });
});

describe('parse caching', () => {
  it('does not re-invoke the model for a repeat merchant template', async () => {
    const parser = makeParser();
    mockRequest.mockResolvedValueOnce(geminiReply());

    const first = await parser.parse('Netflix receipt. Invoice INV-2026-0512. Renewed 2026-05-01. $15.99/month');
    const second = await parser.parse('Netflix receipt. Invoice INV-2026-0613. Renewed 2026-06-01. $15.99/month');

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(second?.name).toBe(first?.name);
    expect(second?.amount).toBe(first?.amount);
  });

  it('reports a cache hit with zero token usage so cost is not double-counted', async () => {
    const parser = makeParser();
    mockRequest.mockResolvedValueOnce(geminiReply());

    await parser.parse('Netflix receipt. Renewed 2026-05-01. $15.99/month');
    const second = await parser.parse('Netflix receipt. Renewed 2026-06-01. $15.99/month');

    expect(second?.cached).toBe(true);
    expect(second?.tokenUsage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });

  it('calls the model again when the amount changes', async () => {
    const parser = makeParser();
    mockRequest.mockResolvedValueOnce(geminiReply()).mockResolvedValueOnce(geminiReply({ amount: 17.99 }));

    await parser.parse('Netflix receipt. Renewed 2026-05-01. $15.99/month');
    const second = await parser.parse('Netflix receipt. Renewed 2026-06-01. $17.99/month');

    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(second?.amount).toBe(17.99);
  });

  it('collapses duplicate templates inside a single batch to one call', async () => {
    const parser = makeParser();
    mockRequest.mockResolvedValue(geminiReply());

    const emails = Array.from(
      { length: 25 },
      (_, i) => `Netflix receipt. Invoice INV-2026-05${String(i).padStart(2, '0')}. $15.99/month`,
    );
    const results = await parser.parseMany(emails);

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(25);
    expect(results.every((r) => r?.name === 'Netflix')).toBe(true);
  });
});

// ─── Budgets ─────────────────────────────────────────────────────────────────

describe('spend budgets', () => {
  it('allows a call while the user is under budget', () => {
    expect(llmBudgetService.canSpend('user-1').allowed).toBe(true);
  });

  it('enforces a hard per-user cutoff', async () => {
    process.env.LLM_BUDGET_USER_DAILY_USD = '0.0001';
    const parser = makeParser();
    mockRequest.mockResolvedValue(geminiReply());

    // One call is enough to exceed a $0.0001 budget (a call costs ~$0.000105).
    await parser.parse('Merchant A receipt. $1.00/month', { userId: 'user-1' });
    expect(llmBudgetService.canSpend('user-1').allowed).toBe(false);

    const blocked = await parser.parse('Merchant B receipt. $2.00/month', { userId: 'user-1' });
    expect(blocked).toBeNull();
    expect(parser.skipReason).toBe('user_budget_exhausted');
  });

  it('does not let one user spend block another', async () => {
    process.env.LLM_BUDGET_USER_DAILY_USD = '0.0001';
    const parser = makeParser();
    mockRequest.mockResolvedValue(geminiReply());

    await parser.parse('Merchant A receipt. $1.00/month', { userId: 'user-1' });

    expect(llmBudgetService.canSpend('user-1').allowed).toBe(false);
    expect(llmBudgetService.canSpend('user-2').allowed).toBe(true);
  });

  it('enforces a hard global cutoff regardless of user', async () => {
    process.env.LLM_BUDGET_GLOBAL_DAILY_USD = '0.0001';
    const parser = makeParser();
    mockRequest.mockResolvedValue(geminiReply());

    await parser.parse('Merchant A receipt. $1.00/month', { userId: 'user-1' });

    const decision = llmBudgetService.canSpend('user-2');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('global_budget_exhausted');
  });

  it('warns once when spend crosses the alert threshold, before the cutoff', async () => {
    // Budget of $0.0002 with an 80% alert fires at $0.00016; one call is ~$0.000105,
    // so the second call crosses the alert while still under the cutoff.
    process.env.LLM_BUDGET_USER_DAILY_USD = '0.0002';
    process.env.LLM_BUDGET_ALERT_THRESHOLD = '0.8';
    const parser = makeParser();
    mockRequest.mockResolvedValue(geminiReply());

    await parser.parse('Merchant A receipt. $1.00/month', { userId: 'user-1' });
    await parser.parse('Merchant B receipt. $2.00/month', { userId: 'user-1' });
    await parser.parse('Merchant C receipt. $3.00/month', { userId: 'user-1' });

    const alerts = (logger.warn as jest.Mock).mock.calls.filter(
      ([message]) => message === '[llm-budget] Spend crossed alert threshold',
    );
    const userAlerts = alerts.filter(([, meta]) => meta?.budget === 'user:user-1');
    expect(userAlerts).toHaveLength(1);
  });

  it('reports remaining spend in the binding budget', () => {
    process.env.LLM_BUDGET_USER_DAILY_USD = '0.5';
    process.env.LLM_BUDGET_GLOBAL_DAILY_USD = '0.1';

    expect(llmBudgetService.canSpend('user-1').remainingUsd).toBeCloseTo(0.1, 6);
  });

  it('exposes a snapshot for dashboards', async () => {
    const parser = makeParser();
    mockRequest.mockResolvedValueOnce(geminiReply());
    await parser.parse('Merchant A receipt. $1.00/month', { userId: 'user-1' });

    const snapshot = llmBudgetService.snapshot('user-1');
    expect(snapshot.userSpendUsd).toBeGreaterThan(0);
    expect(snapshot.globalSpendUsd).toBeGreaterThan(0);
    expect(snapshot.userLimitUsd).toBe(1);
  });
});

// ─── Load test: large mailbox scan ───────────────────────────────────────────

describe('large mailbox scan stays within budget', () => {
  it('degrades to no-LLM parsing instead of failing or overspending', async () => {
    const userBudget = 0.001;
    process.env.LLM_BUDGET_USER_DAILY_USD = String(userBudget);
    const parser = makeParser();
    mockRequest.mockResolvedValue(geminiReply());

    // 2,000 distinct emails — the "user connects a mailbox with thousands of
    // messages" case the issue describes.
    const emails = Array.from(
      { length: 2000 },
      (_, i) => `Merchant ${i} receipt. Charged $${(i % 90) + 1}.99 per month. Ref R-${i}-XYZ`,
    );

    const results = await parser.parseMany(emails, { userId: 'heavy-user' }, 8);

    expect(results).toHaveLength(2000);

    const snapshot = llmBudgetService.snapshot('heavy-user');
    const callCost = estimateCostUsd('gemini-1.5-flash', {
      promptTokens: 1000,
      completionTokens: 100,
      totalTokens: 1100,
    });

    // The budget is checked before each call, so the worst case is bounded by
    // the concurrency limit's worth of in-flight overshoot.
    expect(snapshot.userSpendUsd).toBeLessThanOrEqual(userBudget + callCost * 8);

    // Most emails were never sent to the model.
    expect(mockRequest.mock.calls.length).toBeLessThan(emails.length / 10);

    // And the scan produced a result array rather than throwing.
    const degraded = results.filter((r) => r === null);
    expect(degraded.length).toBeGreaterThan(0);
    expect(parser.skipReason).toBe('user_budget_exhausted');
  });

  it('never throws when the budget runs out mid-scan', async () => {
    process.env.LLM_BUDGET_USER_DAILY_USD = '0.0001';
    const parser = makeParser();
    mockRequest.mockResolvedValue(geminiReply());

    const emails = Array.from({ length: 200 }, (_, i) => `Merchant ${i}. $${i % 50}.99 per month`);

    await expect(parser.parseMany(emails, { userId: 'user-1' })).resolves.toHaveLength(200);
  });
});

// ─── Failure handling ────────────────────────────────────────────────────────

describe('failure handling', () => {
  it('returns null and records a reason when the API call throws', async () => {
    const parser = makeParser();
    mockRequest.mockRejectedValueOnce(new Error('ECONNRESET'));

    expect(await parser.parse('Netflix receipt $15.99/month')).toBeNull();
    expect(parser.skipReason).toBe('parse_failed');
  });

  it('returns null when the model returns unparseable text', async () => {
    const parser = makeParser();
    mockRequest.mockResolvedValueOnce({
      candidates: [{ content: { parts: [{ text: 'sorry, I cannot help with that' }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    });

    expect(await parser.parse('Netflix receipt $15.99/month')).toBeNull();
    expect(parser.skipReason).toBe('parse_failed');
  });

  it('is unavailable and skips cleanly with no API key', async () => {
    delete process.env.GEMINI_API_KEY;
    const parser = makeParser();

    expect(parser.isAvailable).toBe(false);
    expect(await parser.parse('Netflix receipt $15.99/month')).toBeNull();
    expect(parser.skipReason).toBe('disabled');
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
