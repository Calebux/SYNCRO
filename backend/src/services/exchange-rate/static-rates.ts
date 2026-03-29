// Last-resort fallback rates relative to USD.
// These are approximate and only used when both live APIs and cache are unavailable.
export const STATIC_RATES_USD: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  CAD: 1.36,
  AUD: 1.53,
  JPY: 149.5,
  NGN: 1520,
  GHS: 15.4,
  KES: 129,
  ZAR: 18.2,
  XLM: 8.5,
  USDC: 1,
};
