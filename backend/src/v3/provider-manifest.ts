/**
 * Provider Manifest builder (issue #1828).
 *
 * Assembles the publicly-readable manifest for a registered provider so that
 * a consumer agent can discover, without any paid call:
 *   - which gateway URL to target
 *   - which assets and payment schemes are accepted
 *   - every route with its current price and billing unit
 *   - the receipt-signing public keys (current + previous after rotation — #1702)
 *   - the provider's terms URL
 *
 * The manifest is intentionally narrow: it carries only information a consumer
 * needs for pre-call discovery and receipt verification. Secret material
 * (providerSecret, payout address, rate-limit internals) is never included.
 */

import { InMemoryProviderStore } from './provider-store';
import { ReceiptService } from './receipt-service';

// ── Public manifest types ────────────────────────────────────────────────────

export interface AssetDescriptor {
  asset: string;
  network: string;
  scheme: string;
  /** On-chain contract / asset-issuer address, when applicable. */
  contract?: string;
}

export interface RouteDescriptor {
  routeId: string;
  pathPattern: string;
  method: string;
  unit: string;
  /** Integer XLM stroops per billable unit. */
  priceStroops: number;
  maxBillableUnits: number;
  /** Rate-card version currently in effect for this route. */
  rateCardVersion?: string;
  /** ISO 8601 timestamp from which the current rate card applies. */
  effectiveFrom?: string;
}

export interface ReceiptKeyEntry {
  keyId: string;
  /** 'current' = active signing key; 'previous' = valid during dispute window (#1702). */
  status: 'current' | 'previous';
  publicKeyPem: string;
  /** ISO 8601 timestamp when this key was rotated out of the active position. */
  rotatedAt?: string;
}

/**
 * SyncroProviderManifest v1.0 — the wire shape returned to consumers.
 *
 * Shape is validated against packages/shared/src/schemas/provider-manifest.schema.json.
 * Any field added here must be added to the schema too.
 */
export interface SyncroProviderManifest {
  manifestVersion: '1.0';
  providerId: string;
  identity: string;
  gatewayUrl: string;
  mode: 'staging' | 'production';
  acceptedAssets: AssetDescriptor[];
  routes: RouteDescriptor[];
  receiptKeys: ReceiptKeyEntry[];
  termsUrl: string;
  generatedAt: string;
}

// ── Default accepted assets ─────────────────────────────────────────────────

/**
 * Assets the gateway accepts for payment. The list is derived from the runtime
 * environment so staging and production never cross-contaminate.
 *
 * Staging defaults to XLM on testnet; production requires USDC on mainnet with
 * the contract address configured via SOROBAN_CONTRACT_ADDRESS. If neither
 * environment is explicitly set the list falls back to the testnet default so
 * the manifest is always non-empty and the consumer can still discover.
 */
function buildAcceptedAssets(mode: 'staging' | 'production'): AssetDescriptor[] {
  const contract = process.env.SOROBAN_CONTRACT_ADDRESS;
  const network =
    mode === 'production'
      ? `stellar:${process.env.STELLAR_NETWORK ?? 'mainnet'}`
      : `stellar:${process.env.STELLAR_NETWORK ?? 'testnet'}`;

  if (mode === 'production') {
    const assets: AssetDescriptor[] = [
      {
        asset: 'USDC',
        network,
        scheme: 'channel',
        ...(contract ? { contract } : {}),
      },
      {
        asset: 'XLM',
        network,
        scheme: 'channel',
      },
    ];
    return assets;
  }

  // staging / testnet
  return [
    {
      asset: 'XLM',
      network,
      scheme: 'channel',
      ...(contract ? { contract } : {}),
    },
  ];
}

// ── Manifest gateway URL ─────────────────────────────────────────────────────

function resolveGatewayUrl(): string {
  // The gateway URL is configured via SYNCRO_GATEWAY_URL in production.
  // Fall back to a relative path token that callers can expand if needed.
  return (
    process.env.SYNCRO_GATEWAY_URL ??
    process.env.BACKEND_URL ??
    'https://api.syncro.dev'
  );
}

// ── Manifest builder ─────────────────────────────────────────────────────────

/**
 * Build a SyncroProviderManifest for the given provider.
 *
 * Returns `null` when the providerId is unknown so the route handler can
 * respond with 404 without coupling the HTTP layer to the store internals.
 *
 * The manifest is **not** cached here: the route handler is responsible for
 * caching behaviour (e.g. max-age HTTP headers). Generating a manifest is
 * cheap (in-memory reads only).
 */
export function buildProviderManifest(
  providerId: string,
  providerStore: InMemoryProviderStore,
  receiptService: ReceiptService,
): SyncroProviderManifest | null {
  const provider = providerStore.getProvider(providerId);
  if (!provider) return null;

  const now = new Date().toISOString();
  const routes = providerStore.listRoutes(providerId, now);

  const routeDescriptors: RouteDescriptor[] = routes.map((r) => ({
    routeId: r.routeId,
    pathPattern: r.pathPattern,
    method: r.method,
    unit: r.unit,
    priceStroops: r.applicableVersion?.priceStroops ?? r.priceStroops,
    maxBillableUnits: r.applicableVersion?.maxBillableUnits ?? r.maxBillableUnits,
    ...(r.applicableVersion
      ? {
          rateCardVersion: r.applicableVersion.versionId,
          effectiveFrom: r.applicableVersion.effectiveFrom,
        }
      : {}),
  }));

  // Receipt keys: current + previous (rotation safety window — issue #1702).
  const rawKeys = receiptService.getReceiptPublicKeys();
  const receiptKeys: ReceiptKeyEntry[] = rawKeys.map((k) => ({
    keyId: k.keyId,
    status: k.status,
    publicKeyPem: k.publicKeyPem,
  }));

  // Determine terms URL: use provider's agreementTerms if it looks like a URL,
  // otherwise fall back to the platform-level terms configured via env.
  const termsUrl = resolveTermsUrl(provider.agreementTerms);

  return {
    manifestVersion: '1.0',
    providerId: provider.providerId,
    identity: provider.identity,
    gatewayUrl: resolveGatewayUrl(),
    mode: provider.mode,
    acceptedAssets: buildAcceptedAssets(provider.mode),
    routes: routeDescriptors,
    receiptKeys,
    termsUrl,
    generatedAt: now,
  };
}

function resolveTermsUrl(agreementTerms: string): string {
  try {
    new URL(agreementTerms);
    return agreementTerms;
  } catch {
    // agreementTerms is not a URL — it's a prose agreement string.
    // Surface the platform-level terms URL or a stable fallback.
    return (
      process.env.SYNCRO_TERMS_URL ??
      'https://syncro.dev/terms'
    );
  }
}
