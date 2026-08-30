import { describe, it, expect } from 'vitest'
import { formatCurrency } from '../currency-utils'
import { formatDate, formatDateTime, getDaysDifference } from '../timezone-utils'

describe('Currency Formatting', () => {
  it('formats standard currencies correctly', () => {
    expect(formatCurrency(1234.56, 'USD')).toBe('$1,234.56')
    expect(formatCurrency(1234.56, 'EUR')).toContain('1,234.56') 
  })

  it('handles crypto currencies (XLM, USDC)', () => {
    expect(formatCurrency(123.456, 'XLM')).toBe('123.46 XLM')
    expect(formatCurrency(100, 'USDC')).toBe('100.00 USDC')
  })

  it('handles invalid currencies gracefully', () => {
    expect(formatCurrency(100, 'INVALID')).toContain('100.00')
    expect(formatCurrency(100, 'INVALID')).toContain('INVALID')
  })

  it('respects provided locale', () => {
    // In many locales, EUR symbol comes after
    const formatted = formatCurrency(100, 'EUR', 'de-DE')
    expect(formatted).toContain('100,00')
  })
})

describe('Date Formatting', () => {
  const testDate = new Date('2026-05-27T10:00:00Z')

  it('formats dates in medium style by default', () => {
    expect(formatDate(testDate, { timeZone: 'UTC' })).toBe('May 27, 2026')
  })

  it('formats date and time', () => {
    expect(formatDateTime(testDate, { timeZone: 'UTC' })).toBe('May 27, 2026, 10:00 AM')
  })

  it('respects different timezones', () => {
    expect(formatDateTime(testDate, { timeZone: 'America/New_York' })).toBe('May 27, 2026, 6:00 AM')
  })

  it('calculates days difference correctly', () => {
    const today = new Date('2026-05-27T10:00:00Z')
    const tomorrow = new Date('2026-05-28T10:00:00Z')
    const yesterday = new Date('2026-05-26T10:00:00Z')

    expect(getDaysDifference(tomorrow, today)).toBe(1)
    expect(getDaysDifference(yesterday, today)).toBe(-1)
    expect(getDaysDifference(today, today)).toBe(0)
  })
})
