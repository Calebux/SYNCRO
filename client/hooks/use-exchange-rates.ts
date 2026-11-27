"use client"

/**
 * Issue #972 – useExchangeRates hook
 *
 * Fetches and caches the exchange rate matrix, exposing a `convert` helper
 * that can be called synchronously in render loops.
 */

import { useState, useEffect, useCallback } from "react"
import {
  fetchExchangeRates,
  getCachedRates,
  convertAmount,
  type ExchangeRateMap,
} from "@/lib/exchange-rates"

export interface UseExchangeRatesReturn {
  rates: ExchangeRateMap
  isLoading: boolean
  /** Convert `amount` from one currency to another using the latest rates. */
  convert: (amount: number, from: string, to: string) => number
}

/**
 * useExchangeRates
 *
 * Initialises from the sessionStorage cache immediately (synchronous), then
 * re-fetches in the background. Components will re-render once fresh rates
 * arrive.
 */
export function useExchangeRates(): UseExchangeRatesReturn {
  const [rates, setRates] = useState<ExchangeRateMap>(getCachedRates)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetchExchangeRates()
      .then((freshRates) => {
        if (!cancelled) setRates(freshRates)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const convert = useCallback(
    (amount: number, from: string, to: string): number =>
      convertAmount(amount, from, to, rates),
    [rates],
  )

  return { rates, isLoading, convert }
}
