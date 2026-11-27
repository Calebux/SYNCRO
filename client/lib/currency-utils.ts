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

export const DEFAULT_CURRENCY: Currency = "USD"

export function formatCurrency(
  amount: number,
  currency: Currency | string = DEFAULT_CURRENCY,
  locale?: string
): string {
  // Normalize currency to uppercase
  const normalizedCurrency = currency.toUpperCase()

  // XLM and USDC are not ISO 4217, so handle manually
  if (normalizedCurrency === "XLM" || normalizedCurrency === "USDC") {
    return `${amount.toLocaleString(locale || "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} ${normalizedCurrency}`
  }

  try {
    const formatter = new Intl.NumberFormat(locale || "en-US", {
      style: "currency",
      currency: normalizedCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })

    return formatter.format(amount)
  } catch (error) {
    // Fallback if currency code is invalid or not supported
    return `${amount.toLocaleString(locale || "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} ${normalizedCurrency}`
  }
}

export function getCurrencySymbol(currency: Currency | string): string {
  const normalizedCurrency = currency.toUpperCase()
  return CURRENCY_SYMBOLS[normalizedCurrency as Currency] || normalizedCurrency
}
