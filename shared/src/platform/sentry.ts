/**
 * Shared Sentry configuration for client and backend.
 *
 * Provides unified release naming, environment tagging, and PII scrubbing
 * so that both stacks produce consistent events in Sentry.
 *
 * This module is framework-agnostic: it does not import any Sentry SDK.
 * Each consumer passes Sentry event objects through the helpers below.
 */

// ---------------------------------------------------------------------------
// Release & environment
// ---------------------------------------------------------------------------

/**
 * Build a deterministic release string.
 *
 * Convention: `syncro@<pkg-version>+<short-sha>`
 * Falls back to `syncro@<pkg-version>` when no SHA is available (local dev).
 *
 * Both client and backend should set SENTRY_RELEASE at build / deploy time.
 * If the env var is already set it takes precedence (CI may inject it).
 */
export function buildRelease(packageVersion: string, gitSha?: string): string {
  const base = `syncro@${packageVersion}`;
  return gitSha ? `${base}+${gitSha.slice(0, 7)}` : base;
}

/**
 * Resolve the Sentry release string from the environment.
 *
 * Priority:
 *  1. SENTRY_RELEASE env var (set by CI / deploy pipeline)
 *  2. Constructed from npm_package_version + COMMIT_SHA
 */
export function resolveRelease(): string | undefined {
  if (process.env.SENTRY_RELEASE) {
    return process.env.SENTRY_RELEASE;
  }
  const version = process.env.npm_package_version;
  if (version) {
    return buildRelease(version, process.env.COMMIT_SHA);
  }
  return undefined;
}

/**
 * Canonical environment value.
 *
 * Maps NODE_ENV to a Sentry-friendly label and supports an explicit
 * SENTRY_ENVIRONMENT override (useful for staging / preview deploys).
 */
export function resolveEnvironment(): string {
  return (
    process.env.SENTRY_ENVIRONMENT ||
    process.env.NODE_ENV ||
    'development'
  );
}

// ---------------------------------------------------------------------------
// Consistent tag keys
// ---------------------------------------------------------------------------

/** Tag keys shared across client and backend for consistent filtering. */
export const SENTRY_TAG_KEYS = {
  /** "client" | "backend" — identifies which stack sent the event */
  service: 'service',
  /** Error taxonomy used by the client telemetry layer */
  category: 'category',
  /** React component or Express route that originated the event */
  component: 'component',
  /** CSP directive involved in a violation report */
  cspDirective: 'csp_directive',
} as const;

// ---------------------------------------------------------------------------
// PII scrubbing
// ---------------------------------------------------------------------------

/**
 * Header names whose values MUST be redacted before sending to Sentry.
 * Comparison is case-insensitive.
 */
const REDACTED_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-forwarded-for',
  'x-real-ip',
]);

/**
 * Body / extra field names whose values MUST be redacted.
 * Comparison is case-insensitive.
 */
const REDACTED_BODY_FIELDS: ReadonlySet<string> = new Set([
  'password',
  'new_password',
  'newpassword',
  'confirm_password',
  'confirmpassword',
  'token',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'secret',
  'api_key',
  'apikey',
  'credit_card',
  'creditcard',
  'card_number',
  'cardnumber',
  'cvv',
  'ssn',
  'mnemonic',
  'stellar_secret_key',
  'encryption_key',
]);

const REDACTED = '[Redacted]';

/** Deep-clone a plain object, redacting sensitive keys. */
function scrubObject(
  obj: Record<string, unknown> | undefined,
  sensitiveKeys: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  if (!obj || typeof obj !== 'object') return obj;

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (sensitiveKeys.has(key.toLowerCase())) {
      cleaned[key] = REDACTED;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      cleaned[key] = scrubObject(
        value as Record<string, unknown>,
        sensitiveKeys,
      );
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

/**
 * Sentry `beforeSend` hook that redacts PII from events.
 *
 * Works with both `@sentry/nextjs` and `@sentry/node` event shapes since
 * they share the same base `Event` interface.
 *
 * Usage:
 * ```ts
 * Sentry.init({
 *   beforeSend: scrubEvent,
 *   // ...
 * });
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scrubEvent(event: any): any {
  // --- request headers ---
  if (event.request?.headers) {
    event.request.headers = scrubObject(
      event.request.headers as Record<string, unknown>,
      REDACTED_HEADERS,
    ) as Record<string, string>;
  }

  // --- request cookies ---
  if (event.request?.cookies) {
    event.request.cookies = REDACTED;
  }

  // --- request body / data ---
  if (event.request?.data) {
    if (typeof event.request.data === 'string') {
      try {
        const parsed = JSON.parse(event.request.data);
        event.request.data = JSON.stringify(
          scrubObject(parsed, REDACTED_BODY_FIELDS),
        );
      } catch {
        // Not JSON — leave as-is
      }
    } else if (typeof event.request.data === 'object') {
      event.request.data = scrubObject(
        event.request.data,
        REDACTED_BODY_FIELDS,
      );
    }
  }

  // --- extras / contexts (catch-all) ---
  if (event.extra) {
    event.extra = scrubObject(event.extra, REDACTED_BODY_FIELDS);
  }

  // --- breadcrumbs with data payloads ---
  if (Array.isArray(event.breadcrumbs)) {
    for (const crumb of event.breadcrumbs) {
      if (crumb.data && typeof crumb.data === 'object') {
        crumb.data = scrubObject(crumb.data, REDACTED_BODY_FIELDS);
      }
    }
  }

  // --- user context: keep id, strip everything else ---
  if (event.user) {
    event.user = { id: event.user.id };
  }

  return event;
}
