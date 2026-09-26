/**
 * Provider console client.
 *
 * Talks to the v3 provider API and owns the pure helpers the console uses
 * to preview a call's cost and to describe which rate-card version applies.
 */

export type ProviderMode = 'staging' | 'production';
export type SettlementStatus = 'settled' | 'unsettled' | 'in_dispute';

export interface ProviderRegistration {
  providerId: string;
  identity: string;
  payoutAddress: string;
  upstreamBaseUrl: string;
  agreementTerms: string;
  mode: ProviderMode;
  payoutVerified: boolean;
  payoutChallenge: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RateCardVersion {
  versionId: string;
  providerId: string;
  routeId: string;
  sequence: number;
  label: string;
  price: number;
  unit: string;
  quantityExtractor: string;
  pathPattern: string;
  method: string;
  effectiveFrom: string;
  createdAt: string;
}

export interface ProviderRoute {
  routeId: string;
  providerId: string;
  pathPattern: string;
  method: string;
  unit: string;
  price: number;
  quantityExtractor: string;
  scopeKey: string;
  createdAt: string;
  applicableVersion: RateCardVersion | null;
}

export interface ProviderSettlement {
  settlementId: string;
  providerId: string;
  routeId: string;
  receiptId: string;
  method: string;
  pathPattern: string;
  unit: string;
  quantity: number;
  price: number;
  amount: number;
  rateCardVersion: string;
  rateCardEffectiveFrom: string;
  status: SettlementStatus;
  meteredAt: string;
  channelId: string;
}

export interface ProviderRevenue {
  settled: number;
  unsettled: number;
  inDispute: number;
}

export interface ProviderConsoleSnapshot {
  provider: ProviderRegistration;
  routes: ProviderRoute[];
  rateCards: RateCardVersion[];
  settlements: ProviderSettlement[];
  revenue: ProviderRevenue;
}

export interface RegisterProviderInput {
  identity: string;
  payoutAddress: string;
  upstreamBaseUrl: string;
  agreementTerms: string;
  mode: ProviderMode;
}

export interface RouteDraft {
  pathPattern: string;
  method: string;
  unit: string;
  price: number;
  quantityExtractor: string;
}

export const PROVIDER_SESSION_KEY = 'syncro.providerConsole.providerId';

export const RATE_CARD_NON_RETROACTIVE_NOTICE =
  'Price changes are not retroactive. Each version applies only to calls metered on or after its effective time. Calls already metered keep the version that was in force then.';

export const SEPARATE_REVENUE_NOTICE =
  'Settled, unsettled, and in-dispute amounts are shown separately and are not combined into one figure.';

export class ProviderConsoleError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ProviderConsoleError';
    this.status = status;
  }
}

export type CallCostPreview =
  | {
      ok: true;
      quantity: number;
      unitPrice: number;
      cost: number;
    }
  | {
      ok: false;
      message: string;
    };

function apiBase(): string {
  return (
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_API_BASE ||
    'http://localhost:3001'
  );
}

function errorMessage(body: unknown): string {
  if (!body || typeof body !== 'object') return 'Request failed';
  const error = (body as { error?: unknown }).error;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const formErrors = (error as { formErrors?: unknown }).formErrors;
    if (Array.isArray(formErrors) && typeof formErrors[0] === 'string') {
      return formErrors[0];
    }
    const fieldErrors = (error as { fieldErrors?: Record<string, unknown> }).fieldErrors;
    if (fieldErrors) {
      for (const value of Object.values(fieldErrors)) {
        if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
      }
    }
  }
  return 'Request failed';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ProviderConsoleError(errorMessage(body), response.status);
  }
  return (body as { data: T }).data;
}

export interface ProviderConsoleClient {
  registerProvider(input: RegisterProviderInput): Promise<ProviderRegistration>;
  updatePayoutAddress(providerId: string, payoutAddress: string): Promise<ProviderRegistration>;
  createPayoutChallenge(providerId: string): Promise<{ challenge: string }>;
  verifyPayout(providerId: string, signature: string): Promise<ProviderRegistration>;
  registerRoute(providerId: string, input: RouteDraft): Promise<ProviderRoute>;
  reviseRoute(providerId: string, routeId: string, input: Partial<RouteDraft>): Promise<{ route: ProviderRoute; version: RateCardVersion }>;
  loadConsole(providerId: string): Promise<ProviderConsoleSnapshot>;
}

export const providerConsoleClient: ProviderConsoleClient = {
  registerProvider(input) {
    return request<ProviderRegistration>('/api/v3/providers', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  updatePayoutAddress(providerId, payoutAddress) {
    return request<ProviderRegistration>(`/api/v3/providers/${providerId}/payout-address`, {
      method: 'PATCH',
      body: JSON.stringify({ payoutAddress }),
    });
  },
  createPayoutChallenge(providerId) {
    return request<{ challenge: string }>(`/api/v3/providers/${providerId}/payout-challenge`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },
  verifyPayout(providerId, signature) {
    return request<ProviderRegistration>(`/api/v3/providers/${providerId}/payout-verify`, {
      method: 'POST',
      body: JSON.stringify({ signature }),
    });
  },
  registerRoute(providerId, input) {
    return request<ProviderRoute>(`/api/v3/providers/${providerId}/routes`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  reviseRoute(providerId, routeId, input) {
    return request<{ route: ProviderRoute; version: RateCardVersion }>(
      `/api/v3/providers/${providerId}/routes/${routeId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      },
    );
  },
  async loadConsole(providerId) {
    const [provider, routes, rateCards, settlements, revenue] = await Promise.all([
      request<ProviderRegistration>(`/api/v3/providers/${providerId}`),
      request<ProviderRoute[]>(`/api/v3/providers/${providerId}/routes`),
      request<RateCardVersion[]>(`/api/v3/providers/${providerId}/rate-cards`),
      request<ProviderSettlement[]>(`/api/v3/providers/${providerId}/settlements`),
      request<ProviderRevenue>(`/api/v3/providers/${providerId}/revenue`),
    ]);
    return { provider, routes, rateCards, settlements, revenue };
  },
};

function positiveNumber(value: number, label: string): string | null {
  if (!Number.isFinite(value) || value <= 0) {
    return `${label} must be greater than zero.`;
  }
  return null;
}

function readJsonQuantity(sample: unknown, path: string): number {
  const parts = path.split('.');
  let current: unknown = sample;
  for (const part of parts) {
    if (!part) {
      throw new Error('The quantity extractor path is empty.');
    }
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      throw new Error(`No value at "${path}" in the sample.`);
    }
    if (!Object.prototype.hasOwnProperty.call(current, part)) {
      throw new Error(`No value at "${path}" in the sample.`);
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current !== 'number' || !Number.isFinite(current)) {
    throw new Error(`"${path}" must be a number.`);
  }
  const invalid = positiveNumber(current, 'Extracted quantity');
  if (invalid) throw new Error(invalid);
  return current;
}

/**
 * Preview what one call will cost from the price and quantity extractor.
 * `constant:<number>` uses that quantity. `json:<dot.path>` reads a number
 * from a sample JSON body. Anything else is left unpriced.
 */
export function previewCallCost(input: {
  price: number;
  quantityExtractor: string;
  sampleBody?: string;
}): CallCostPreview {
  const priceError = positiveNumber(input.price, 'Price');
  if (priceError) return { ok: false, message: priceError };

  const extractor = input.quantityExtractor.trim();
  let quantity: number;
  try {
    if (extractor.startsWith('constant:')) {
      quantity = Number(extractor.slice('constant:'.length).trim());
      const invalid = positiveNumber(quantity, 'Quantity');
      if (invalid) return { ok: false, message: invalid };
    } else if (extractor.startsWith('json:')) {
      const path = extractor.slice('json:'.length).trim();
      if (!path) return { ok: false, message: 'The json extractor needs a path, such as json:usage.tokens.' };
      const sampleText = input.sampleBody?.trim() ?? '';
      if (!sampleText) {
        return { ok: false, message: 'Paste a sample JSON body to preview this extractor.' };
      }
      let sample: unknown;
      try {
        sample = JSON.parse(sampleText);
      } catch {
        return { ok: false, message: 'Sample body must be JSON so the quantity extractor can be applied.' };
      }
      quantity = readJsonQuantity(sample, path);
    } else {
      return {
        ok: false,
        message: 'Use constant:<number> or json:<dot.path> to preview what a call will cost.',
      };
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not preview this call.' };
  }

  return {
    ok: true,
    quantity,
    unitPrice: input.price,
    cost: input.price * quantity,
  };
}

export function versionsForRoute(versions: RateCardVersion[], routeId: string): RateCardVersion[] {
  return versions
    .filter((version) => version.routeId === routeId)
    .sort((a, b) => a.sequence - b.sequence);
}

/**
 * Say which window a version prices. A later version does not replace it.
 */
export function describeRateCardVersion(version: RateCardVersion, allForRoute: RateCardVersion[]): string {
  const ordered = versionsForRoute(allForRoute, version.routeId);
  const next = ordered.find((candidate) => candidate.sequence > version.sequence);
  if (!next) {
    return `${version.label} applies from ${version.effectiveFrom}. Calls metered on or after that time use this price. Earlier calls are unchanged.`;
  }
  return `${version.label} applies from ${version.effectiveFrom} until ${next.effectiveFrom}. Calls metered in that window keep this price. Later versions do not replace it.`;
}

export function settlementStatusLabel(status: SettlementStatus): string {
  switch (status) {
    case 'settled':
      return 'Settled';
    case 'unsettled':
      return 'Unsettled';
    case 'in_dispute':
      return 'In dispute';
  }
}
