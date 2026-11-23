/**
 * Provider manifest client (issue #1828).
 *
 * Fetches and caches the SyncroProviderManifest from a provider endpoint so
 * the consumer SDK can discover prices and receipt-signing keys before making
 * any paid call.
 *
 * Usage
 * -----
 * ```ts
 * import { ManifestClient, createPaidFetch } from '@syncro/sdk/v3';
 *
 * const manifestClient = new ManifestClient();
 * const manifest = await manifestClient.fetch('https://api.example.com', 'provider-uuid');
 *
 * // Use the manifest's receipt key for verification
 * const currentKey = manifest.receiptKeys.find(k => k.status === 'current');
 *
 * // Use the manifest's gateway URL for paid calls
 * const fetch = createPaidFetch({
 *   spendingKey: '...',
 *   gatewayPublicKey: currentKey?.publicKeyPem,
 * });
 * const res = await fetch(`${manifest.gatewayUrl}/api/v3/gateway/paid`);
 * ```
 */

// ── Types (re-exported for consumers) ───────────────────────────────────────

export interface ManifestAssetDescriptor {
  asset: string;
  network: string;
  scheme: string;
  contract?: string;
}

export interface ManifestRouteDescriptor {
  routeId?: string;
  pathPattern: string;
  method: string;
  unit: string;
  priceStroops?: number;
  price?: number;
  currency?: string;
  maxBillableUnits?: number;
  rateCardVersion?: string;
  effectiveFrom?: string;
}

export interface ManifestReceiptKeyEntry {
  keyId: string;
  /**
   * 'current'  — the active signing key; use this for new receipt verification.
   * 'previous' — rotated out but still valid during the dispute window (#1702).
   */
  status: 'current' | 'previous';
  publicKeyPem: string;
  /** ISO 8601 timestamp when this key was rotated out. Present on 'previous' entries. */
  rotatedAt?: string;
}

/**
 * SyncroProviderManifest v1.0 — the wire shape returned by
 * `GET /api/v3/providers/:providerId/manifest` and
 * `GET /.well-known/syncro/:providerId`.
 *
 * JSON Schema: packages/shared/src/schemas/provider-manifest.schema.json
 */
export interface SyncroProviderManifest {
  manifestVersion: '1.0';
  providerId?: string;
  identity?: string;
  gatewayUrl: string;
  mode: 'staging' | 'production';
  acceptedAssets: ManifestAssetDescriptor[];
  routes: ManifestRouteDescriptor[];
  receiptKeys: ManifestReceiptKeyEntry[];
  termsUrl: string;
  generatedAt: string;
}

// ── Cache entry ──────────────────────────────────────────────────────────────

interface CacheEntry {
  manifest: SyncroProviderManifest;
  fetchedAt: number;
}

// ── ManifestClient ───────────────────────────────────────────────────────────

export interface ManifestClientOptions {
  /**
   * How long a fetched manifest may be served from the in-process cache
   * before a revalidation fetch is triggered (milliseconds).
   *
   * Default: 300_000 (5 minutes) — matches the server's Cache-Control max-age.
   */
  cacheTtlMs?: number;
  /** Custom fetch implementation (defaults to global fetch). */
  fetchImpl?: typeof fetch;
}

/**
 * ManifestClient fetches and caches `SyncroProviderManifest` objects.
 *
 * A single instance is safe to share across concurrent requests because the
 * cache is keyed by `{baseUrl}:{providerId}` and reads/writes never mutate
 * the stored manifest object (they store and return plain object references).
 */
export class ManifestClient {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ManifestClientOptions = {}) {
    this.cacheTtlMs = options.cacheTtlMs ?? 300_000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  /**
   * Fetch the manifest for a provider, using the in-process cache when the
   * previously fetched copy is still fresh.
   *
   * @param baseUrl   Base URL of the provider (e.g. `https://api.example.com`).
   *                  Trailing slashes are stripped automatically.
   * @param providerId  Provider UUID. When omitted the well-known path is tried
   *                  without an ID suffix and the manifest's own `providerId`
   *                  field is used as the cache key.
   */
  async fetch(
    baseUrl: string,
    providerId?: string,
  ): Promise<SyncroProviderManifest> {
    const cacheKey = `${baseUrl.replace(/\/$/, '')}:${providerId ?? '_unknown'}`;

    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < this.cacheTtlMs) {
      return cached.manifest;
    }

    const manifest = await this.fetchFresh(baseUrl, providerId);

    this.cache.set(cacheKey, { manifest, fetchedAt: Date.now() });
    return manifest;
  }

  /**
   * Invalidate the cached manifest for a provider, forcing the next `fetch`
   * call to hit the network. Use after a known key rotation or price change.
   */
  invalidate(baseUrl: string, providerId?: string): void {
    const cacheKey = `${baseUrl.replace(/\/$/, '')}:${providerId ?? '_unknown'}`;
    this.cache.delete(cacheKey);
  }

  /** Drop every cached manifest. */
  invalidateAll(): void {
    this.cache.clear();
  }

  /**
   * Return the current active receipt-signing public key from a manifest.
   *
   * Consumers use this key to verify `PaidReceipt.signature` values returned
   * by the gateway. When a rotation is in progress the manifest will carry
   * both a `'current'` and a `'previous'` entry; this helper returns only
   * the current one.
   *
   * Returns `undefined` when the manifest carries no keys (should not happen
   * with a conforming provider, but guard defensively).
   */
  static currentReceiptKey(manifest: SyncroProviderManifest): ManifestReceiptKeyEntry | undefined {
    return manifest.receiptKeys.find((k) => k.status === 'current');
  }

  /**
   * Return all valid receipt-signing public keys from a manifest.
   *
   * Both `'current'` and `'previous'` keys are valid; use all of them when
   * verifying receipts during a rotation window (issue #1702).
   */
  static allValidReceiptKeys(manifest: SyncroProviderManifest): ManifestReceiptKeyEntry[] {
    return manifest.receiptKeys.filter(
      (k) => k.status === 'current' || k.status === 'previous',
    );
  }

  /**
   * Find the best matching route descriptor for a method + path combination.
   *
   * Returns the first route whose `pathPattern` matches the given path, using
   * the same simple wildcard semantics the backend uses (`*` matches any
   * suffix). Returns `undefined` when no route matches.
   *
   * Consumers can use this to get the expected price before making a paid
   * call without sending any HTTP request to the provider.
   */
  static matchRoute(
    manifest: SyncroProviderManifest,
    method: string,
    path: string,
  ): ManifestRouteDescriptor | undefined {
    const upperMethod = method.toUpperCase();
    // Most-specific-first: longer patterns before shorter ones.
    const sorted = [...manifest.routes].sort((a, b) => b.pathPattern.length - a.pathPattern.length);
    return sorted.find(
      (r) =>
        r.method.toUpperCase() === upperMethod &&
        matchPattern(r.pathPattern, path),
    );
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async fetchFresh(
    baseUrl: string,
    providerId?: string,
  ): Promise<SyncroProviderManifest> {
    const base = baseUrl.replace(/\/$/, '');

    // Try the canonical REST path first; fall back to the well-known path.
    const urls = providerId
      ? [
          `${base}/api/v3/providers/${providerId}/manifest`,
          `${base}/.well-known/syncro/${providerId}`,
        ]
      : [`${base}/__syncro/manifest`];

    let lastError: unknown;

    for (const url of urls) {
      try {
        const response = await this.fetchImpl(url, {
          headers: { Accept: 'application/json' },
        });

        if (response.status === 404 && urls.indexOf(url) < urls.length - 1) {
          // Try the next URL in the list.
          continue;
        }

        if (!response.ok) {
          throw new ManifestFetchError(
            `Manifest fetch failed with status ${response.status}`,
            response.status,
            url,
          );
        }

        const body = (await response.json()) as { data?: unknown } | unknown;
        // Backend wraps the manifest in `{ data: ... }`; SDK provider
        // middleware does the same. Accept both wrapped and bare forms.
        const raw =
          body !== null &&
          typeof body === 'object' &&
          'data' in (body as Record<string, unknown>)
            ? (body as Record<string, unknown>).data
            : body;

        validateManifest(raw);
        return raw as SyncroProviderManifest;
      } catch (err) {
        if (err instanceof ManifestFetchError) throw err;
        lastError = err;
      }
    }

    throw new ManifestFetchError(
      `Could not fetch manifest from ${base}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      0,
      base,
    );
  }
}

// ── Errors ───────────────────────────────────────────────────────────────────

export class ManifestFetchError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(message: string, status: number, url: string) {
    super(message);
    this.name = 'ManifestFetchError';
    this.status = status;
    this.url = url;
  }
}

export class ManifestValidationError extends Error {
  constructor(reason: string) {
    super(`Invalid provider manifest: ${reason}`);
    this.name = 'ManifestValidationError';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function matchPattern(pattern: string, path: string): boolean {
  if (pattern === path) return true;
  if (pattern.endsWith('*')) {
    return path.startsWith(pattern.slice(0, -1));
  }
  return false;
}

/**
 * Minimal structural validation — rejects obviously malformed manifests
 * before the caller tries to use them. We do not validate every field;
 * unknown fields are tolerated for forward compatibility.
 */
function validateManifest(raw: unknown): asserts raw is SyncroProviderManifest {
  if (!raw || typeof raw !== 'object') {
    throw new ManifestValidationError('manifest is not an object');
  }
  const m = raw as Record<string, unknown>;

  if (m.manifestVersion !== '1.0') {
    throw new ManifestValidationError(
      `unsupported manifestVersion "${m.manifestVersion}" (only "1.0" is supported)`,
    );
  }
  if (typeof m.gatewayUrl !== 'string' || !m.gatewayUrl) {
    throw new ManifestValidationError('missing or invalid gatewayUrl');
  }
  if (m.mode !== 'staging' && m.mode !== 'production') {
    throw new ManifestValidationError(`invalid mode "${m.mode}"`);
  }
  if (!Array.isArray(m.acceptedAssets) || m.acceptedAssets.length === 0) {
    throw new ManifestValidationError('acceptedAssets must be a non-empty array');
  }
  if (!Array.isArray(m.receiptKeys) || m.receiptKeys.length === 0) {
    throw new ManifestValidationError('receiptKeys must be a non-empty array');
  }
  if (typeof m.termsUrl !== 'string' || !m.termsUrl) {
    throw new ManifestValidationError('missing or invalid termsUrl');
  }
  if (typeof m.generatedAt !== 'string') {
    throw new ManifestValidationError('missing generatedAt');
  }
}

// ── Module-level default instance ────────────────────────────────────────────

/**
 * Shared default `ManifestClient` instance. Import and use directly when you
 * do not need a custom cache TTL or fetch implementation.
 *
 * ```ts
 * import { manifestClient } from '@syncro/sdk/v3';
 * const manifest = await manifestClient.fetch('https://api.example.com', providerId);
 * ```
 */
export const manifestClient = new ManifestClient();
