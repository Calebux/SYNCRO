export type Currency = "USD" | "EUR" | "GBP" | "JPY" | "CAD" | "AUD"

export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CAD: "C$",
  AUD: "A$",
}

export const CURRENCY_NAMES: Record<Currency, string> = {
  USD: "US Dollar",
  EUR: "Euro",
  GBP: "British Pound",
  JPY: "Japanese Yen",
  CAD: "Canadian Dollar",
  AUD: "Australian Dollar",
}

// Exchange rates (relative to USD)
const EXCHANGE_RATES: Record<Currency, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 149.5,
  CAD: 1.36,
  AUD: 1.53,
}

export function convertCurrency(amount: number, from: Currency, to: Currency): number {
  if (from === to) return amount

  // Convert to USD first, then to target currency
  const usdAmount = amount / EXCHANGE_RATES[from]
  return usdAmount * EXCHANGE_RATES[to]
}

export function formatCurrency(amount: number, currency: Currency, locale?: string): string {
  const formatter = new Intl.NumberFormat(locale || "en-US", {
    style: "currency",
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  return formatter.format(amount)
}

export function getCurrencySymbol(currency: Currency): string {
  return CURRENCY_SYMBOLS[currency] || "$"
}
