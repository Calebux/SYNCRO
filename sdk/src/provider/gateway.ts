import { pricing, type RoutePricing, type PricingDeclarationInput } from './pricing.js';

export interface HostedGatewayConfig {
  target: string;
  pricing: PricingDeclarationInput | RoutePricing;
  apiKey?: string;
  webhookSecret?: string;
}

export function hostedGateway(config: HostedGatewayConfig): {
  target: string;
  pricing: RoutePricing;
  config: HostedGatewayConfig;
} {
  const routePricing = typeof config.pricing === 'object' && config.pricing !== null && 'match' in config.pricing
    ? (config.pricing as RoutePricing)
    : pricing(config.pricing);

  return {
    target: config.target,
    pricing: routePricing,
    config,
  };
}

export interface QuoteRequest {
  method: string;
  path: string;
  sizeHint?: number;
}

export interface SignedQuote {
  price: string;
  unit: string;
  asset: string;
  rateCardVersion: string;
  expiresAt: string;
  signature: string;
}

export interface QuoteOptions {
  apiKey?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

export async function quote(
  target: string,
  request: QuoteRequest,
  options: QuoteOptions = {},
): Promise<SignedQuote> {
  const fetchImpl = options.fetch ?? fetch;
  const url = new URL('/gateway/quote', target).toString();

  const body: Record<string, unknown> = {
    method: request.method,
    path: request.path,
  };
  if (request.sizeHint !== undefined) {
    body.sizeHint = request.sizeHint;
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (options.apiKey) {
    headers['authorization'] = `Bearer ${options.apiKey}`;
  }

  const response = await fetchImpl(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `gateway quote failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`,
    );
  }

  const data = (await response.json()) as Partial<SignedQuote>;
  if (
    typeof data.price !== 'string' ||
    typeof data.unit !== 'string' ||
    typeof data.asset !== 'string' ||
    typeof data.rateCardVersion !== 'string' ||
    typeof data.expiresAt !== 'string' ||
    typeof data.signature !== 'string'
  ) {
    throw new Error('gateway quote returned an invalid response');
  }

  return {
    price: data.price,
    unit: data.unit,
    asset: data.asset,
    rateCardVersion: data.rateCardVersion,
    expiresAt: data.expiresAt,
    signature: data.signature,
  };
}