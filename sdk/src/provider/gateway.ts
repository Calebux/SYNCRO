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
