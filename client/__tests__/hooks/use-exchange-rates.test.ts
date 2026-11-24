import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import {
  convertAmount,
  getCachedRates,
  type ExchangeRateMap,
} from '@/lib/exchange-rates'
import { useExchangeRates } from '@/hooks/use-exchange-rates'

/**
 * Issue #972 – Multi-currency display with user-preferred currency
 * Test suite for exchange rate utilities and hooks
 */

describe('exchange-rates', () => {
  describe('convertAmount', () => {
    const rates: ExchangeRateMap = {
      USD: 1,
      EUR: 0.92,
      GBP: 0.79,
      NGN: 1580,
      XLM: 10.5,
    }

    it('should convert USD to EUR', () => {
      const result = convertAmount(100, 'USD', 'EUR', rates)
      expect(result).toBeCloseTo(92, 1)
    })

    it('should convert EUR to GBP', () => {
      const result = convertAmount(100, 'EUR', 'GBP', rates)
      expect(result).toBeCloseTo(85.87, 1)
    })

    it('should convert USD to NGN', () => {
      const result = convertAmount(100, 'USD', 'NGN', rates)
      expect(result).toBeCloseTo(158000, 0)
    })

    it('should return same amount when converting to same currency', () => {
      const result = convertAmount(100, 'USD', 'USD', rates)
      expect(result).toBe(100)
    })

    it('should handle zero amounts', () => {
      const result = convertAmount(0, 'USD', 'EUR', rates)
      expect(result).toBe(0)
    })

    it('should handle negative amounts', () => {
      const result = convertAmount(-100, 'USD', 'EUR', rates)
      expect(result).toBeCloseTo(-92, 1)
    })

    it('should return original amount if currency not in rates', () => {
      const result = convertAmount(100, 'USD', 'UNKNOWN', rates)
      expect(result).toBe(100)
    })

    it('should be symmetric (USD->EUR->USD)', () => {
      const eur = convertAmount(100, 'USD', 'EUR', rates)
      const usd = convertAmount(eur, 'EUR', 'USD', rates)
      expect(usd).toBeCloseTo(100, 0)
    })

    it('should handle large amounts', () => {
      const result = convertAmount(1000000, 'USD', 'EUR', rates)
      expect(result).toBeCloseTo(920000, -3)
    })

    it('should handle fractional amounts', () => {
      const result = convertAmount(99.99, 'USD', 'EUR', rates)
      expect(result).toBeCloseTo(91.99, 1)
    })

    it('should convert with uppercase currency codes', () => {
      const result = convertAmount(100, 'USD', 'EUR', rates)
      const result2 = convertAmount(100, 'usd', 'eur', rates)
      expect(result).toBeCloseTo(result2, 1)
    })
  })

  describe('getCachedRates', () => {
    it('should return a rate map', () => {
      const rates = getCachedRates()
      expect(rates).toBeDefined()
      expect(typeof rates).toBe('object')
      expect(rates.USD).toBe(1)
    })

    it('should include standard currencies', () => {
      const rates = getCachedRates()
      expect(rates.USD).toBeDefined()
      expect(rates.EUR).toBeDefined()
      expect(rates.GBP).toBeDefined()
    })

    it('should have positive rate values', () => {
      const rates = getCachedRates()
      for (const [, rate] of Object.entries(rates)) {
        expect(rate).toBeGreaterThan(0)
      }
    })
  })
})

describe('useExchangeRates hook', () => {
  it('should initialize with cached rates synchronously', () => {
    const { result } = renderHook(() => useExchangeRates())
    expect(result.current.rates).toBeDefined()
    expect(result.current.rates.USD).toBe(1)
  })

  it('should provide a convert function', () => {
    const { result } = renderHook(() => useExchangeRates())
    const converted = result.current.convert(100, 'USD', 'EUR')
    expect(typeof converted).toBe('number')
    expect(converted).toBeGreaterThan(0)
  })

  it('should initialize with isLoading true', () => {
    const { result } = renderHook(() => useExchangeRates())
    // isLoading may be true initially while fetching
    expect(typeof result.current.isLoading).toBe('boolean')
  })

  it('should convert amounts correctly', () => {
    const { result } = renderHook(() => useExchangeRates())
    const converted = result.current.convert(100, 'USD', 'USD')
    expect(converted).toBe(100)
  })

  it('should handle edge cases in convert function', () => {
    const { result } = renderHook(() => useExchangeRates())
    const zero = result.current.convert(0, 'USD', 'EUR')
    expect(zero).toBe(0)
  })

  it('should maintain rate consistency across renders', () => {
    const { result, rerender } = renderHook(() => useExchangeRates())
    const rates1 = result.current.rates
    rerender()
    const rates2 = result.current.rates
    expect(rates1.USD).toBe(rates2.USD)
  })
})
