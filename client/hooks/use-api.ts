/**
 * useApi Hook
 * 
 * Provides methods to make authenticated API requests.
 * Used by the offline queue processor to replay mutations through the normal API.
 */

'use client'

import { useCallback } from 'react'

interface ApiResponse {
  status: number
  data?: unknown
  error?: string
}

export interface UseApiResult {
  post: (path: string, data: Record<string, unknown>) => Promise<ApiResponse>
  put: (path: string, data: Record<string, unknown>) => Promise<ApiResponse>
  patch: (path: string, data: Record<string, unknown>) => Promise<ApiResponse>
  delete: (path: string) => Promise<ApiResponse>
  get: (path: string) => Promise<ApiResponse>
}

export function useApi(): UseApiResult {
  const makeRequest = useCallback(
    async (
      method: string,
      path: string,
      body?: Record<string, unknown>
    ): Promise<ApiResponse> => {
      try {
        const url = new URL(path, window.location.origin)
        const options: RequestInit = {
          method,
          headers: {
            'Content-Type': 'application/json',
          },
        }

        if (body) {
          options.body = JSON.stringify(body)
        }

        const response = await fetch(url.toString(), options)
        const data = await response.json().catch(() => ({}))

        return {
          status: response.status,
          data,
          error: !response.ok ? data?.error?.message || `HTTP ${response.status}` : undefined,
        }
      } catch (error) {
        return {
          status: 0,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      }
    },
    []
  )

  return {
    post: useCallback(
      (path: string, data: Record<string, unknown>) => makeRequest('POST', path, data),
      [makeRequest]
    ),
    put: useCallback(
      (path: string, data: Record<string, unknown>) => makeRequest('PUT', path, data),
      [makeRequest]
    ),
    patch: useCallback(
      (path: string, data: Record<string, unknown>) => makeRequest('PATCH', path, data),
      [makeRequest]
    ),
    delete: useCallback(
      (path: string) => makeRequest('DELETE', path),
      [makeRequest]
    ),
    get: useCallback(
      (path: string) => makeRequest('GET', path),
      [makeRequest]
    ),
  }
}
