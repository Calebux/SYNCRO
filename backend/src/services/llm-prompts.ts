/**
 * Versioned prompt registry for the LLM subscription parser (issue #1281).
 *
 * Before this existed, a prompt change could not be attributed to an accuracy
 * change: prompts were inline string literals and results carried no record of
 * which text produced them. Every prompt now lives here under an immutable
 * version id, and every parse result records the version it used, so the
 * golden-corpus report (#1280) and the prompt that produced it can be lined up.
 *
 * Rules for changing a prompt:
 *   1. Never edit the text of a published version — results already recorded
 *      against it would silently start meaning something else.
 *   2. Add a new entry, then move ACTIVE_PROMPT_VERSION to it.
 *   3. Keep the old entry so historical results stay interpretable.
 */

export interface PromptDefinition {
  /** Immutable identifier recorded on every parse result. */
  version: string;
  /** Model this prompt was written and calibrated for. */
  model: string;
  /** Upper bound on the model's reply; the schema below is small. */
  maxOutputTokens: number;
  /** Deterministic extraction — no sampling. */
  temperature: number;
  /** The instruction text sent to the model. */
  text: string;
  /** Short note on what changed relative to the previous version. */
  changelog: string;
}

const V1: PromptDefinition = {
  version: 'v1',
  model: 'gemini-1.5-flash',
  maxOutputTokens: 256,
  temperature: 0,
  changelog: 'Initial prompt, extracted verbatim from llm-parser.ts when prompt versioning was introduced.',
  text: `You are a subscription invoice parser. Extract subscription details from the email text below and return ONLY valid JSON with this exact shape:
{
  "name": "<merchant or service name, or null>",
  "amount": <number or null>,
  "currency": "<ISO 4217 code or null>",
  "interval": "<monthly|yearly|weekly|quarterly or null>",
  "confidence": <0.0–1.0 float>
}
Rules:
- confidence >= 0.9 only when name, amount, and interval are all present and unambiguous.
- Return null for any field you cannot determine.
- Do NOT include markdown fences or extra text — raw JSON only.`,
};

/** Every prompt ever published, keyed by version. */
export const SUBSCRIPTION_PARSER_PROMPTS: Readonly<Record<string, PromptDefinition>> =
  Object.freeze({ [V1.version]: V1 });

/** The version new parses use. Move this pointer to roll a prompt forward. */
export const ACTIVE_PROMPT_VERSION = V1.version;

/**
 * Look up a prompt by version.
 *
 * @throws if the version was never published — a result recorded against an
 *         unknown version would be uninterpretable, so this fails loudly.
 */
export function getPrompt(version: string = ACTIVE_PROMPT_VERSION): PromptDefinition {
  const prompt = SUBSCRIPTION_PARSER_PROMPTS[version];
  if (!prompt) {
    throw new Error(`Unknown subscription parser prompt version: ${version}`);
  }
  return prompt;
}
