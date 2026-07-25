/**
 * Issue #961 – Subscription category auto-detection with ML classification
 *
 * Architecture:
 *  1. Primary:  Lightweight client-side ML classifier interface (ready for
 *               TensorFlow.js or ONNX Runtime plug-in — see loadMLModel()).
 *  2. Fallback: Rule-based regex matcher covering 12 standard categories.
 *
 * The classifier is intentionally designed without a hard runtime dependency
 * on tfjs/onnx so the bundle stays lean. A consumer that wants ML inference
 * should call `registerMLModel()` at boot time with their own loaded model.
 */

// ── Category definitions ───────────────────────────────────────────────────────

export const SUBSCRIPTION_CATEGORIES = [
  "entertainment",
  "productivity",
  "finance",
  "health & fitness",
  "education",
  "gaming",
  "news & media",
  "cloud & storage",
  "developer tools",
  "communication",
  "security",
  "other",
] as const

export type SubscriptionCategory = (typeof SUBSCRIPTION_CATEGORIES)[number]

// ── ML model interface ─────────────────────────────────────────────────────────

/**
 * Minimal interface that a plugged-in ML model must satisfy.
 * TensorFlow.js `LayersModel` and ONNX `InferenceSession` both fit this
 * shape when wrapped in a thin adapter.
 */
export interface CategoryMLModel {
  /**
   * Run inference on a normalised service name string.
   * Must return a confidence map keyed by SubscriptionCategory.
   */
  predict(input: string): Promise<Partial<Record<SubscriptionCategory, number>>>
}

let activeMLModel: CategoryMLModel | null = null

/**
 * Register a loaded ML model. Call this once at application startup after the
 * model has been downloaded / compiled.
 *
 * @example
 * ```ts
 * import * as tf from "@tensorflow/tfjs"
 * const model = await tf.loadLayersModel("/models/category-classifier/model.json")
 * registerMLModel(wrapTfjsModel(model))
 * ```
 */
export function registerMLModel(model: CategoryMLModel): void {
  activeMLModel = model
}

// ── Rule-based regex fallback ──────────────────────────────────────────────────

type CategoryRule = {
  category: SubscriptionCategory
  patterns: RegExp[]
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    category: "entertainment",
    patterns: [
      /netflix|hulu|disney\+?|hbo|prime\s*video|apple\s*tv|paramount|peacock|crunchyroll|spotify|apple\s*music|tidal|deezer|youtube\s*premium|twitch/i,
    ],
  },
  {
    category: "productivity",
    patterns: [
      /notion|monday|asana|trello|clickup|todoist|airtable|zapier|make\.com|integromat|calendar|basecamp|jira|confluence|linear/i,
    ],
  },
  {
    category: "finance",
    patterns: [
      /quickbooks|xero|wave|freshbooks|mint|ynab|personal\s*capital|robinhood|coinbase|kraken|payroll|accounti|bookkeep/i,
    ],
  },
  {
    category: "health & fitness",
    patterns: [
      /peloton|strava|myfitnesspal|noom|headspace|calm|whoop|apple\s*fitness|beachbody|yoga|meditation|fitbit/i,
    ],
  },
  {
    category: "education",
    patterns: [
      /coursera|udemy|linkedin\s*learning|skillshare|masterclass|duolingo|pluralsight|pluralsight|brilliant|khan\s*academy|edx|codecademy/i,
    ],
  },
  {
    category: "gaming",
    patterns: [
      /xbox|playstation|nintendo|steam|ea\s*play|ubisoft|humble|xbox\s*game\s*pass|geforce|shadow\s*pc|gaming/i,
    ],
  },
  {
    category: "news & media",
    patterns: [
      /new\s*york\s*times|washington\s*post|wall\s*street\s*journal|wsj|nyt|guardian|substack|medium|economist|bloomberg|reuters|ap\s*news/i,
    ],
  },
  {
    category: "cloud & storage",
    patterns: [
      /dropbox|google\s*(one|drive)|icloud|onedrive|box\.com|backblaze|wasabi|s3|aws|azure|google\s*cloud|digitalocean|linode|vultr|heroku|railway/i,
    ],
  },
  {
    category: "developer tools",
    patterns: [
      /github|gitlab|bitbucket|vercel|netlify|figma|sketch|invision|zeplin|postman|insomnia|datadog|sentry|logrocket|new\s*relic|pagerduty|copilot|openai|midjourney|anthropic/i,
    ],
  },
  {
    category: "communication",
    patterns: [
      /slack|zoom|teams|discord|telegram|whatsapp\s*business|google\s*workspace|gsuite|microsoft\s*365|m365|loom|notion|intercom|crisp|hubspot/i,
    ],
  },
  {
    category: "security",
    patterns: [
      /1password|lastpass|bitwarden|dashlane|nordvpn|expressvpn|surfshark|mullvad|norton|bitdefender|kaspersky|malwarebytes|authy|yubikey/i,
    ],
  },
]

/**
 * Rule-based regex classification. Returns the best-matching category or
 * "other" if nothing matches.
 */
export function classifyByRules(serviceName: string): SubscriptionCategory {
  for (const rule of CATEGORY_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(serviceName)) {
        return rule.category
      }
    }
  }
  return "other"
}

// ── Primary classify function ──────────────────────────────────────────────────

export interface ClassificationResult {
  category: SubscriptionCategory
  /** Confidence score in [0, 1]. Rule-based results use 1.0. */
  confidence: number
  /** Whether the result came from the ML model (`true`) or regex rules (`false`). */
  fromML: boolean
}

/**
 * Classify a subscription service name into one of the standard categories.
 *
 * Strategy:
 *  1. If an ML model is registered, attempt ML inference first.
 *  2. Fall back to the rule-based engine if ML is unavailable or throws.
 */
export async function classifySubscription(
  serviceName: string,
): Promise<ClassificationResult> {
  if (activeMLModel) {
    try {
      const scores = await activeMLModel.predict(serviceName.toLowerCase().trim())
      // Find the category with the highest confidence.
      let bestCategory: SubscriptionCategory = "other"
      let bestScore = 0
      for (const [cat, score] of Object.entries(scores) as [SubscriptionCategory, number][]) {
        if (score > bestScore) {
          bestScore = score
          bestCategory = cat
        }
      }
      if (bestScore > 0.5) {
        return { category: bestCategory, confidence: bestScore, fromML: true }
      }
    } catch {
      // ML inference failed — fall through to rule-based.
    }
  }

  const category = classifyByRules(serviceName)
  return { category, confidence: 1.0, fromML: false }
}

// ── Manual override helpers ────────────────────────────────────────────────────

const OVERRIDE_STORAGE_KEY = "syncro:category_overrides"

export type CategoryOverrideMap = Record<string, SubscriptionCategory>

/**
 * Persist a user-supplied category override for a service name.
 * Corrections are stored in localStorage so they survive page reloads and
 * can later be shipped to a training pipeline.
 */
export function saveCategoryOverride(
  serviceName: string,
  category: SubscriptionCategory,
): void {
  if (typeof window === "undefined") return
  try {
    const raw = localStorage.getItem(OVERRIDE_STORAGE_KEY)
    const overrides: CategoryOverrideMap = raw ? (JSON.parse(raw) as CategoryOverrideMap) : {}
    overrides[serviceName.toLowerCase().trim()] = category
    localStorage.setItem(OVERRIDE_STORAGE_KEY, JSON.stringify(overrides))
  } catch {
    // localStorage unavailable (SSR, private mode) — silently ignore.
  }
}

/**
 * Retrieve all persisted manual overrides.
 */
export function loadCategoryOverrides(): CategoryOverrideMap {
  if (typeof window === "undefined") return {}
  try {
    const raw = localStorage.getItem(OVERRIDE_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as CategoryOverrideMap) : {}
  } catch {
    return {}
  }
}

/**
 * Get the manually overridden category for a service name, or `undefined` if
 * no override has been set.
 */
export function getManualOverride(serviceName: string): SubscriptionCategory | undefined {
  const overrides = loadCategoryOverrides()
  return overrides[serviceName.toLowerCase().trim()]
}
