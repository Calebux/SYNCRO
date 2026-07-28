/**
 * E2E: email → parse → (LLM fallback mocked) → subscription create payload
 * Fixtures: Gmail, Outlook, iCloud, Yahoo
 */

import * as fs from 'fs';
import * as path from 'path';
import { runEmailToSubscriptionPipeline } from '../src/services/email-to-subscription-pipeline';
import { llmParser } from '../src/services/llm-parser';

jest.mock('../src/config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../src/services/llm-parser', () => ({
  llmParser: {
    isAvailable: true,
    parse: jest.fn(),
  },
}));

type Fixture = {
  provider: 'gmail' | 'outlook' | 'icloud' | 'yahoo';
  messageId: string;
  subject: string;
  from: string;
  body: string;
  receivedAt?: string;
  expected: {
    name?: string;
    nameContains?: string;
    amount: number;
    currency: string;
    interval: string;
  };
};

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'emails');

function loadFixture(file: string): Fixture {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8')) as Fixture;
}

const FIXTURE_FILES = [
  'gmail-netflix.json',
  'outlook-spotify.json',
  'icloud-apple.json',
  'yahoo-disney.json',
];

describe('email → parse → subscription pipeline (e2e fixtures)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: LLM unused (regex path succeeds with high confidence)
    (llmParser.parse as jest.Mock).mockResolvedValue(null);
  });

  it.each(FIXTURE_FILES)('parses %s into a deterministic subscription create body', async (file) => {
    const fixture = loadFixture(file);

    const result = await runEmailToSubscriptionPipeline({
      provider: fixture.provider,
      messageId: fixture.messageId,
      subject: fixture.subject,
      from: fixture.from,
      body: fixture.body,
      receivedAt: fixture.receivedAt,
    });

    expect(result).not.toBeNull();
    expect(result!.metadata.bodyExcluded).toBe(true);
    expect(result!.metadata.provider).toBe(fixture.provider);
    expect(result!.metadata.messageId).toBe(fixture.messageId);
    // Body must never appear on persisted metadata
    expect(JSON.stringify(result!.metadata)).not.toContain(fixture.body.slice(0, 40));

    expect(result!.createBody.price).toBe(fixture.expected.amount);
    expect(result!.createBody.currency).toBe(fixture.expected.currency);
    expect(result!.createBody.billing_cycle).toBe(fixture.expected.interval);
    expect(result!.createBody.provider).toBe(fixture.provider);
    expect(result!.createBody.email_message_id).toBe(fixture.messageId);
    expect(result!.createBody.status).toBe('active');

    if (fixture.expected.name) {
      expect(result!.createBody.name).toBe(fixture.expected.name);
    }
    if (fixture.expected.nameContains) {
      expect(result!.createBody.name.toLowerCase()).toContain(
        fixture.expected.nameContains.toLowerCase(),
      );
    }
  });

  it('uses mocked LLM fallback when regex confidence is low', async () => {
    (llmParser.parse as jest.Mock).mockResolvedValue({
      name: 'Notion',
      amount: 10,
      currency: 'USD',
      interval: 'monthly',
      confidence: 0.95,
    });

    const result = await runEmailToSubscriptionPipeline({
      provider: 'gmail',
      messageId: 'gmail-llm-fallback-001',
      subject: 'Invoice',
      from: 'hello@example.com',
      // Weak signals so regex confidence stays low / null-ish
      body: 'Thanks for your purchase today.',
    });

    // Either null (no subscription signals) or LLM-enriched result
    if (result) {
      expect(llmParser.parse).toHaveBeenCalled();
      expect(result.createBody.name).toBe('Notion');
      expect(result.createBody.price).toBe(10);
      expect(result.usedLlmFallback).toBe(true);
    } else {
      // Parser returned null before LLM — force LLM path via subject with weak keyword
      const forced = await runEmailToSubscriptionPipeline({
        provider: 'gmail',
        messageId: 'gmail-llm-fallback-002',
        subject: 'Your billing notice',
        from: 'billing@notion.so',
        body: 'A charge may apply. See portal.',
      });
      expect(llmParser.parse).toHaveBeenCalled();
      if (forced) {
        expect(forced.createBody.name).toBe('Notion');
      }
    }
  });

  it('does not call LLM when regex confidence is high', async () => {
    const fixture = loadFixture('gmail-netflix.json');
    await runEmailToSubscriptionPipeline({
      provider: fixture.provider,
      messageId: fixture.messageId,
      subject: fixture.subject,
      from: fixture.from,
      body: fixture.body,
    });
    expect(llmParser.parse).not.toHaveBeenCalled();
  });
});
