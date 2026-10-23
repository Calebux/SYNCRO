/**
 * Redaction scan for the golden email corpus (issue #1280).
 *
 * The corpus is committed to the repository, so it must contain no real
 * personal data. This is the scanning check that enforces that: it runs in CI
 * alongside the accuracy gate and fails on anything that looks like a real
 * mailbox, card number, phone number, address or credential.
 *
 * Fixtures are synthetic. Sender addresses are role accounts on either a real
 * merchant domain (billing@netflix.com — a public, non-personal address) or a
 * reserved `.example` domain, which can never be registered.
 */

import { loadCorpus, type CorpusCase } from './helpers/email-corpus';

/** Public merchant domains whose role addresses are safe to commit. */
const ALLOWED_MERCHANT_DOMAINS = [
  'netflix.com',
  'spotify.com',
  'amazon.com',
  'audible.com',
  'youtube.com',
  'steampowered.com',
  'email.apple.com',
  'disneyplus.com',
];

/** Consumer mailbox providers — a hit here means a real person's address. */
const PERSONAL_MAIL_PROVIDERS = [
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'ymail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'mail.ru',
  'yandex.ru',
];

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** 12+ consecutive digits: card numbers, IBANs, long account numbers. */
const LONG_DIGIT_RUN_RE = /\d[\d\s-]{11,}\d/;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;
/** Long opaque strings that look like keys, tokens or session ids. */
const TOKEN_RE = /\b(?:[A-Za-z0-9_-]{32,}|[A-Za-z0-9+/]{40,}={0,2})\b/;
const STREET_ADDRESS_RE = /\b\d{1,5}\s+[A-Z][a-z]+\s+(Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Boulevard|Blvd)\b/;

function isAllowedAddress(address: string): boolean {
  const domain = address.split('@')[1]?.toLowerCase() ?? '';
  if (domain === 'example.com' || domain === 'example.org' || domain === 'example.net') return true;
  if (domain.endsWith('.example')) return true;
  return ALLOWED_MERCHANT_DOMAINS.includes(domain);
}

/** Every piece of free text in a case that could carry personal data. */
function textOf(testCase: CorpusCase): string {
  return [
    testCase.email.subject,
    testCase.email.from,
    testCase.email.body,
    testCase.notes,
  ].join('\n');
}

describe('golden email corpus redaction', () => {
  const corpus = loadCorpus();

  it('is not empty', () => {
    expect(corpus.length).toBeGreaterThan(0);
  });

  it.each(corpus.map((c) => [c.id, c] as const))(
    '%s contains only allowlisted email addresses',
    (_id, testCase) => {
      const addresses = textOf(testCase).match(EMAIL_RE) ?? [];
      const disallowed = addresses.filter((a) => !isAllowedAddress(a));
      expect(disallowed).toEqual([]);
    },
  );

  it.each(corpus.map((c) => [c.id, c] as const))(
    '%s uses no consumer mailbox provider',
    (_id, testCase) => {
      const text = textOf(testCase).toLowerCase();
      const hits = PERSONAL_MAIL_PROVIDERS.filter((provider) => text.includes(`@${provider}`));
      expect(hits).toEqual([]);
    },
  );

  it.each(corpus.map((c) => [c.id, c] as const))(
    '%s carries no card, IBAN or long account number',
    (_id, testCase) => {
      expect(textOf(testCase)).not.toMatch(LONG_DIGIT_RUN_RE);
    },
  );

  it.each(corpus.map((c) => [c.id, c] as const))(
    '%s carries no phone number, IP address or street address',
    (_id, testCase) => {
      const text = textOf(testCase);
      expect(text).not.toMatch(PHONE_RE);
      expect(text).not.toMatch(IPV4_RE);
      expect(text).not.toMatch(STREET_ADDRESS_RE);
    },
  );

  it.each(corpus.map((c) => [c.id, c] as const))(
    '%s carries no token, key or session identifier',
    (_id, testCase) => {
      expect(textOf(testCase)).not.toMatch(TOKEN_RE);
    },
  );

  it.each(corpus.map((c) => [c.id, c] as const))(
    '%s documents why it is in the corpus',
    (_id, testCase) => {
      expect(testCase.notes.trim().length).toBeGreaterThan(0);
    },
  );
});
