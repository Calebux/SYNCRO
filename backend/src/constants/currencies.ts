export const SUPPORTED_FIAT = [
  'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'NGN', 'GHS', 'KES', 'ZAR',
] as const;

export const SUPPORTED_CRYPTO = ['XLM', 'USDC'] as const;

export const SUPPORTED_CURRENCIES = [...SUPPORTED_FIAT, ...SUPPORTED_CRYPTO] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export function isSupportedCurrency(code: string): code is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(code);
}
