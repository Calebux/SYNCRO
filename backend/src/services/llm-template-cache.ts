/**
 * Template-fingerprint cache for LLM parses (issue #1281).
 *
 * Merchant receipts are generated from templates: the same Netflix email
 * arrives every month with only the date and the invoice id changing. Sending
 * each one to the model is pure waste, so a parse is cached under a fingerprint
 * of the email's *structure*.
 *
 * ## What the fingerprint deliberately keeps
 *
 * Volatile-but-meaningless tokens (dates, invoice ids, URLs, order numbers,
 * long digit runs) are normalised away so month-to-month deliveries collide.
 *
 * Monetary amounts and interval words are **kept**. That is the whole
 * correctness argument for this cache: the cached value includes the parsed
 * amount, so if the fingerprint ignored amounts, a $15.99 receipt could be
 * served the cached result of a $9.99 one. A price change is exactly the event
 * the product must not miss, so it costs one model call instead.
 */

import crypto from 'node:crypto';

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/** Fingerprint inputs that are noise, in the order they are applied. */
const NORMALISERS: Array<[RegExp, string]> = [
  // URLs and emails carry per-recipient ids.
  [/https?:\/\/\S+/g, ' <url> '],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, ' <email> '],
  // UUIDs, then long alphanumeric ids (invoice / order / transaction refs).
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ' <uuid> '],
  [/\b[A-Za-z0-9]*\d[A-Za-z0-9]*-[A-Za-z0-9-]{4,}\b/g, ' <ref> '],
  // ISO and long-form dates.
  [/\b\d{4}-\d{2}-\d{2}(?:t[\d:.]+z?)?\b/gi, ' <date> '],
  [/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, ' <date> '],
  [
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi,
    ' <date> ',
  ],
  [/\b\d{1,2}(?:st|nd|rd|th)\b/gi, ' <ordinal> '],
  // Standalone digit runs of 5+ — account, order and card fragments.
  // Shorter runs are left alone so monetary amounts survive.
  [/\b\d{5,}\b/g, ' <num> '],
];

/**
 * Reduce an email to a stable structural signature.
 *
 * Exported for testing and for logging a fingerprint alongside a parse.
 */
export function templateFingerprint(emailText: string): string {
  let normalised = emailText.toLowerCase();
  for (const [pattern, replacement] of NORMALISERS) {
    normalised = normalised.replace(pattern, replacement);
  }
  normalised = normalised.replace(/\s+/g, ' ').trim();

  return crypto.createHash('sha256').update(normalised).digest('hex');
}

/**
 * Bounded in-memory LRU with per-entry TTL.
 *
 * In-process by design: it removes the repeat-template cost inside a mailbox
 * scan, which is where the unbounded spend came from, without adding a network
 * dependency to the parse path. A shared Redis tier can be layered on later
 * behind this same interface.
 */
export class TemplateCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly maxEntries = Number(process.env.LLM_TEMPLATE_CACHE_MAX ?? 500),
    private readonly ttlMs = Number(process.env.LLM_TEMPLATE_CACHE_TTL_MS ?? 24 * 60 * 60 * 1000),
  ) {}

  get(fingerprint: string): T | undefined {
    const entry = this.entries.get(fingerprint);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(fingerprint);
      this.misses++;
      return undefined;
    }

    // Refresh recency: delete + re-insert moves the key to the end.
    this.entries.delete(fingerprint);
    this.entries.set(fingerprint, entry);
    this.hits++;
    return entry.value;
  }

  set(fingerprint: string, value: T): void {
    if (this.entries.has(fingerprint)) this.entries.delete(fingerprint);
    this.entries.set(fingerprint, { value, expiresAt: Date.now() + this.ttlMs });

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  get stats(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      size: this.entries.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }

  clear(): void {
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
  }
}
