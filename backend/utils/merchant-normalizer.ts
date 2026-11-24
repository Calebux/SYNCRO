export interface MerchantMatch {
  canonicalName: string;
  confidence: number;
}

type MerchantPattern = {
  patterns: RegExp[];
  canonical: string;
  priority?: number;
};

const MERCHANT_PATTERNS: MerchantPattern[] = [
  // ── Specific Domain & Service Patterns (priority 1) ────────────────────────────
  { patterns: [/netflix\.com$/], canonical: 'Netflix', priority: 1 },
  { patterns: [/spotify\.com$/], canonical: 'Spotify', priority: 1 },
  { patterns: [/disneyplus\.com$/], canonical: 'Disney+', priority: 1 },
  { patterns: [/hulu\.com$/], canonical: 'Hulu', priority: 1 },
  { patterns: [/hbomax\.com$/], canonical: 'HBO Max', priority: 1 },
  { patterns: [/paramountplus\.com$/], canonical: 'Paramount+', priority: 1 },
  { patterns: [/primevideo\.com$/], canonical: 'Prime Video', priority: 1 },
  { patterns: [/developer\.amazon\.com$/], canonical: 'AWS', priority: 1 },
  { patterns: [/openai\.com$/], canonical: 'OpenAI', priority: 1 },
  { patterns: [/chat\.openai\.com$/], canonical: 'OpenAI', priority: 1 },
  { patterns: [/anthropic\.com$/], canonical: 'Claude', priority: 1 },
  { patterns: [/cursor\.sh$/], canonical: 'Cursor', priority: 1 },
  { patterns: [/github-copilot\.com$/], canonical: 'GitHub Copilot', priority: 1 },
  { patterns: [/notion\.so$/], canonical: 'Notion', priority: 1 },
  { patterns: [/figma\.com$/], canonical: 'Figma', priority: 1 },
  { patterns: [/linear\.app$/], canonical: 'Linear', priority: 1 },
  { patterns: [/slack\.com$/], canonical: 'Slack', priority: 1 },
  { patterns: [/zoom\.us$/], canonical: 'Zoom', priority: 1 },
  { patterns: [/coursera\.org$/], canonical: 'Coursera', priority: 1 },
  { patterns: [/udemy\.com$/], canonical: 'Udemy', priority: 1 },
  { patterns: [/duolingo\.com$/], canonical: 'Duolingo', priority: 1 },
  { patterns: [/audible\.com$/], canonical: 'Audible', priority: 1 },
  { patterns: [/scribd\.com$/], canonical: 'Scribd', priority: 1 },
  { patterns: [/1password\.com$/], canonical: '1Password', priority: 1 },
  { patterns: [/nordvpn\.com$/], canonical: 'NordVPN', priority: 1 },
  { patterns: [/quickbooks\.com$/], canonical: 'QuickBooks', priority: 1 },
  { patterns: [/turbotax\.com$/], canonical: 'TurboTax', priority: 1 },
  { patterns: [/vercel\.com$/], canonical: 'Vercel', priority: 1 },
  { patterns: [/digitalocean\.com$/], canonical: 'DigitalOcean', priority: 1 },
  { patterns: [/cloudflare\.com$/], canonical: 'Cloudflare', priority: 1 },
  { patterns: [/supabase\.co$/], canonical: 'Supabase', priority: 1 },
  { patterns: [/fubo\.tv$/], canonical: 'Fubo', priority: 1 },
  { patterns: [/peacock\.com$/], canonical: 'Peacock', priority: 1 },
  { patterns: [/playstation\.com$/], canonical: 'PlayStation Plus', priority: 1 },
  { patterns: [/xbox\.com$/], canonical: 'Xbox Game Pass', priority: 1 },
  { patterns: [/linkedin\.com$/], canonical: 'LinkedIn Learning', priority: 1 },
  { patterns: [/youtube\.com$/], canonical: 'YouTube Premium', priority: 1 },

  // ── Name-based Patterns (priority 1) ────────────────────────────────────────
  { patterns: [/microsoft\s*365|office\s*365/i], canonical: 'Microsoft 365', priority: 1 },
  { patterns: [/amazon\s*prime/i], canonical: 'Amazon Prime', priority: 1 },
  { patterns: [/youtube\s*premium/i], canonical: 'YouTube Premium', priority: 1 },
  { patterns: [/xbox\s*game\s*pass/i], canonical: 'Xbox Game Pass', priority: 1 },
  { patterns: [/playstation\s*plus|ps\s*plus/i], canonical: 'PlayStation Plus', priority: 1 },
  { patterns: [/apple\s*fitness\+?/i], canonical: 'Apple Fitness+', priority: 1 },

  // ── Partial Match Patterns (priority 2) ─────────────────────────────────────
  { patterns: [/netflix/i], canonical: 'Netflix', priority: 2 },
  { patterns: [/spotify/i], canonical: 'Spotify', priority: 2 },
  { patterns: [/disney/i], canonical: 'Disney+', priority: 2 },
  { patterns: [/hulu/i], canonical: 'Hulu', priority: 2 },
  { patterns: [/paramount/i], canonical: 'Paramount+', priority: 2 },
  { patterns: [/prime\s*video/i], canonical: 'Prime Video', priority: 2 },
  { patterns: [/aws|amazon\s*web\s*services/i], canonical: 'AWS', priority: 2 },
  { patterns: [/gcp|google\s*cloud/i], canonical: 'Google Cloud', priority: 2 },
  { patterns: [/azure|microsoft\s*azure/i], canonical: 'Azure', priority: 2 },
  { patterns: [/netlify/i], canonical: 'Netlify', priority: 2 },
  { patterns: [/heroku/i], canonical: 'Heroku', priority: 2 },
  { patterns: [/linkedin/i], canonical: 'LinkedIn Learning', priority: 2 },
  { patterns: [/pluralsight/i], canonical: 'Pluralsight', priority: 2 },
  { patterns: [/skillshare/i], canonical: 'Skillshare', priority: 2 },
  { patterns: [/masterclass/i], canonical: 'MasterClass', priority: 2 },
  { patterns: [/google\s*workspace|google\s*one/i], canonical: 'Google Workspace', priority: 2 },
  { patterns: [/dropbox/i], canonical: 'Dropbox', priority: 2 },
  { patterns: [/airtable/i], canonical: 'Airtable', priority: 2 },
  { patterns: [/asana/i], canonical: 'Asana', priority: 2 },
  { patterns: [/monday/i], canonical: 'Monday', priority: 2 },
  { patterns: [/trello/i], canonical: 'Trello', priority: 2 },
  { patterns: [/clickup/i], canonical: 'ClickUp', priority: 2 },
  { patterns: [/todoist/i], canonical: 'Todoist', priority: 2 },
  { patterns: [/headspace/i], canonical: 'Headspace', priority: 2 },
  { patterns: [/calm/i], canonical: 'Calm', priority: 2 },
  { patterns: [/strava/i], canonical: 'Strava', priority: 2 },
  { patterns: [/peloton/i], canonical: 'Peloton', priority: 2 },
  { patterns: [/uber\s*eats/i], canonical: 'Uber Eats', priority: 2 },
  { patterns: [/doordash/i], canonical: 'DoorDash', priority: 2 },
  { patterns: [/grubhub/i], canonical: 'Grubhub', priority: 2 },
  { patterns: [/instacart/i], canonical: 'Instacart', priority: 2 },
  { patterns: [/hellofresh/i], canonical: 'HelloFresh', priority: 2 },
  { patterns: [/blue\s*apron/i], canonical: 'Blue Apron', priority: 2 },
  { patterns: [/openai|chatgpt|chat\.openai/i], canonical: 'OpenAI', priority: 2 },
  { patterns: [/github\s*copilot|github-copilot/i], canonical: 'GitHub Copilot', priority: 2 },
  { patterns: [/midjourney/i], canonical: 'Midjourney', priority: 2 },
  { patterns: [/stable\s*diffusion/i], canonical: 'Stable Diffusion', priority: 2 },
  { patterns: [/kindle\s*unlimited/i], canonical: 'Kindle Unlimited', priority: 2 },
  { patterns: [/nyt|new\s*york\s*times/i], canonical: 'NYTimes', priority: 2 },
  { patterns: [/washington\s*post/i], canonical: 'Washington Post', priority: 2 },
  { patterns: [/wsj|wall\s*street\s*journal/i], canonical: 'WSJ', priority: 2 },
  { patterns: [/freshbooks/i], canonical: 'FreshBooks', priority: 2 },
  { patterns: [/xero/i], canonical: 'Xero', priority: 2 },
  { patterns: [/ynab|you\s*need\s*a\s*budget/i], canonical: 'YNAB', priority: 2 },
  { patterns: [/mint$/i], canonical: 'Mint', priority: 2 },

  // ── Generic Domain Patterns (fallback, priority 3) ───────────────────────────
  { patterns: [/adobe/i], canonical: 'Adobe', priority: 3 },
  { patterns: [/github/i], canonical: 'GitHub', priority: 3 },
];

function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s+&.+-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMerchantName(name: string): string {
  if (!name) return '';
  return name
    .trim()
    .replace(/\s+(billing|receipts?|noreply|no-reply|notifications?|alerts?|support|help)$/i, '')
    .replace(/\s+(intl|international)$/i, '')
    .replace(/\s+inc|\s+llc|\s+ltd|\s+l\.l\.c\.|\s+pvt|\s+corp|\s+corporation/gi, '')
    .replace(/\.com|\.net|\.org/gi, '')
    .replace(/[^\p{L}\p{N}\s+&-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getDomainFromSender(sender: string): string | null {
  if (!sender) return null;
  const emailMatch = sender.match(/<([^>]+)>/);
  const email = emailMatch ? emailMatch[1] : sender;
  // Match full domain including TLD
  const domainMatch = email.match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/);
  if (domainMatch) return domainMatch[1].toLowerCase();
  return null;
}

function getDisplayNameFromSender(sender: string): string | null {
  if (!sender) return null;
  const nameMatch = sender.match(/^"([^"]+)"/);
  if (nameMatch?.[1]) return nameMatch[1];
  const nameMatch2 = sender.match(/^\s*([^<]+)</);
  if (nameMatch2?.[1]) return nameMatch2[1].replace(/"/g, '').trim();
  return null;
}

export function normalizeMerchant(sender: string): MerchantMatch | null {
  if (!sender) return null;

  const domain = getDomainFromSender(sender);
  const displayName = getDisplayNameFromSender(sender);

  // Try patterns against domain first (highest confidence)
  if (domain) {
    for (const merchant of MERCHANT_PATTERNS) {
      for (const pattern of merchant.patterns) {
        if (pattern.test(domain)) {
          return {
            canonicalName: merchant.canonical,
            confidence: merchant.priority === 1 ? 0.95 : merchant.priority === 2 ? 0.9 : 0.85,
          };
        }
      }
    }
  }

  // Try patterns against display name (medium confidence)
  if (displayName) {
    const normalizedDisplayName = normalizeText(displayName);
    for (const merchant of MERCHANT_PATTERNS) {
      for (const pattern of merchant.patterns) {
        if (pattern.test(normalizedDisplayName)) {
          return {
            canonicalName: merchant.canonical,
            confidence: merchant.priority === 1 ? 0.8 : merchant.priority === 2 ? 0.75 : 0.7,
          };
        }
      }
    }
  }

  return null;
}

export function deduplicateMerchants(names: string[]): string[] {
  const seen = new Map<string, string>();
  const result: string[] = [];

  for (const name of names) {
    if (!name) continue;

    const normalized = normalizeText(name);

    // Check if we've seen a variant of this name
    const existing = seen.get(normalized);
    if (existing) {
      continue;
    }

    // Check against all existing entries for similarity
    let foundMatch = false;
    for (const [key] of seen) {
      if (calculateSimilarity(normalized, key) >= 0.85) {
        foundMatch = true;
        break;
      }
    }

    if (!foundMatch) {
      seen.set(normalized, name);
      result.push(name);
    }
  }

  return result;
}

export function calculateSimilarity(a: string, b: string): number {
  const normalizedA = normalizeText(a);
  const normalizedB = normalizeText(b);

  if (normalizedA === normalizedB) return 1;
  if (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA)) return 0.9;

  const wordsA = new Set(normalizedA.split(/\s+/));
  const wordsB = new Set(normalizedB.split(/\s+/));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  const intersection = [...wordsA].filter(w => wordsB.has(w));
  const union = new Set([...wordsA, ...wordsB]);

  return intersection.length / union.size;
}

export function getMerchantCanonicalForm(name: string): string {
  if (!name) return '';
  const match = normalizeMerchant(name);
  return match?.canonicalName ?? normalizeMerchantName(name);
}

export function getMerchantPatterns(): Set<string> {
  return new Set(MERCHANT_PATTERNS.flatMap(m => m.patterns).map(p => p.source));
}