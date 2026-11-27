/**
 * Payment Provider Matrix
 * Single source of truth for which providers are available by region
 * and environment.
 *
 * Rule:
 *   Paystack → African markets (NG, GH, ZA, KE) — NGN
 *   PayPal   → International (non-African markets) — USD
 *   Mock     → Development and test only; never production
 *
 * Never show both Paystack and PayPal to the same user.
 */

export type PaymentProvider = 'paystack' | 'paypal' | 'stripe' | 'mock'
export type Region = 'NG' | 'GH' | 'ZA' | 'KE' | 'INTL'
export type AppEnvironment = 'development' | 'production' | 'test'

interface ProviderRule {
  provider: PaymentProvider
  regions: Region[]
  environments: AppEnvironment[]
  currency: string
  notes: string
}

export const PROVIDER_MATRIX: ProviderRule[] = [
  {
    provider: 'paystack',
    regions: ['NG', 'GH', 'ZA', 'KE'],
    environments: ['development', 'production', 'test'],
    currency: 'NGN',
    notes: 'Supports card, bank transfer, USSD. Primary provider for African markets.',
  },
  {
    provider: 'paypal',
    regions: ['INTL'],
    environments: ['development', 'production', 'test'],
    currency: 'USD',
    notes: 'International users outside Paystack-supported regions.',
  },
  {
    provider: 'mock',
    regions: ['NG', 'GH', 'ZA', 'KE', 'INTL'],
    environments: ['development', 'test'],
    currency: 'USD',
    notes: 'Development and test only. Never available in production.',
  },
]

/**
 * Returns the providers available for a given region and environment.
 */
export function getProvidersForRegion(
  region: Region,
  env: AppEnvironment = 'production'
): PaymentProvider[] {
  return PROVIDER_MATRIX
    .filter(
      (rule) =>
        rule.regions.includes(region) &&
        rule.environments.includes(env)
    )
    .map((rule) => rule.provider)
}

/**
 * Returns true if the given provider is valid for the given region.
 */
export function isProviderValidForRegion(
  provider: PaymentProvider,
  region: Region,
  env: AppEnvironment = 'production'
): boolean {
  return getProvidersForRegion(region, env).includes(provider)
}

/**
 * Returns the default currency for a region.
 */
export function getCurrencyForRegion(region: Region): string {
  const africanRegions: Region[] = ['NG', 'GH', 'ZA', 'KE']
  return africanRegions.includes(region) ? 'NGN' : 'USD'
}