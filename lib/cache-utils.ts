"use client"

import React from "react"

// Client-side caching utilities

interface CacheEntry<T> {
  data: T
  timestamp: number
  expiresAt: number
}

class Cache {
  private cache = new Map<string, CacheEntry<any>>()
  private defaultTTL = 5 * 60 * 1000 // 5 minutes

  set<T>(key: string, data: T, ttl?: number): void {
    const now = Date.now()
    this.cache.set(key, {
      data,
      timestamp: now,
      expiresAt: now + (ttl || this.defaultTTL),
    })
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key)
    if (!entry) return null

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }

    return entry.data as T
  }

  has(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return false
    }

    return true
  }

  delete(key: string): void {
    this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  // Clean up expired entries
  cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key)
      }
    }
  }
}

export const cache = new Cache()

// Run cleanup every 5 minutes
if (typeof window !== "undefined") {
  setInterval(() => cache.cleanup(), 5 * 60 * 1000)
}

// SWR-like hook for data fetching with caching
export function useCachedData<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: { ttl?: number; revalidateOnFocus?: boolean } = {},
) {
  const [data, setData] = React.useState<T | null>(cache.get(key))
  const [isLoading, setIsLoading] = React.useState(!cache.has(key))
  const [error, setError] = React.useState<Error | null>(null)

  const fetchData = React.useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const result = await fetcher()
      cache.set(key, result, options.ttl)
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown error"))
    } finally {
      setIsLoading(false)
    }
  }, [key, fetcher, options.ttl])

  React.useEffect(() => {
    if (!cache.has(key)) {
      fetchData()
    }
  }, [key, fetchData])

  // Revalidate on focus
  React.useEffect(() => {
    if (!options.revalidateOnFocus) return

    const handleFocus = () => {
      if (!cache.has(key)) {
        fetchData()
      }
    }

    window.addEventListener("focus", handleFocus)
    return () => window.removeEventListener("focus", handleFocus)
  }, [key, fetchData, options.revalidateOnFocus])

  return { data, isLoading, error, refetch: fetchData }
}
