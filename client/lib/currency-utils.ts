export type Currency =
  | "USD" | "EUR" | "GBP" | "JPY" | "CAD" | "AUD"
  | "NGN" | "GHS" | "KES" | "ZAR"
  | "XLM" | "USDC"

export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  USD: "$",
  EUR: "\u20ac",
  GBP: "\u00a3",
  JPY: "\u00a5",
  CAD: "C$",
  AUD: "A$",
  NGN: "\u20a6",
  GHS: "GH\u20b5",
  KES: "KSh",
  ZAR: "R",
  XLM: "XLM",
  USDC: "USDC",
}

export const CURRENCY_NAMES: Record<Currency, string> = {
  USD: "US Dollar",
  EUR: "Euro",
  GBP: "British Pound",
  JPY: "Japanese Yen",
  CAD: "Canadian Dollar",
  AUD: "Australian Dollar",
  NGN: "Nigerian Naira",
  GHS: "Ghanaian Cedi",
  KES: "Kenyan Shilling",
  ZAR: "South African Rand",
  XLM: "Stellar Lumens",
  USDC: "USD Coin",
}

export function convertCurrency(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number>
): number {
  if (from === to) return amount

  const fromRate = from === 'USD' ? 1 : rates[from]
  const toRate = to === 'USD' ? 1 : rates[to]

  if (!fromRate || !toRate) return amount

  // Convert through USD: amount -> USD -> target
  const usdAmount = amount / fromRate
  return usdAmount * toRate
}

export function formatCurrency(amount: number, currency: Currency | string, locale?: string): string {
  // XLM and USDC are not ISO 4217, so handle manually
  if (currency === 'XLM' || currency === 'USDC') {
    return `${amount.toFixed(2)} ${currency}`
  }

  const formatter = new Intl.NumberFormat(locale || "en-US", {
    style: "currency",
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  return formatter.format(amount)
}

export function getCurrencySymbol(currency: Currency | string): string {
  return CURRENCY_SYMBOLS[currency as Currency] || currency
}
