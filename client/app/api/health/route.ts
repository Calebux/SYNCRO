/**
 * Frontend Health Check Endpoint
 * Aggregates frontend status + backend dependency health for the blue-green pipeline.
 */

import { NextResponse } from 'next/server'
import { HttpStatus } from '@/lib/api/types'

interface DependencyStatus {
  name: string
  status: 'healthy' | 'degraded' | 'unhealthy'
  latency_ms?: number
  error?: string
}

interface BackendHealth {
  status: string
  dependencies?: DependencyStatus[]
  message?: string
}

async function fetchBackendHealth(): Promise<BackendHealth | null> {
  const backendUrl = process.env.NEXT_PUBLIC_API_BASE || process.env.BACKEND_URL
  if (!backendUrl) return null

  try {
    const res = await fetch(`${backendUrl}/health`, {
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(5000),
    })
    return res.ok ? res.json() : null
  } catch {
    return null
  }
}

export async function GET() {
  const backendHealth = await fetchBackendHealth()

  const isHealthy =
    !backendHealth || backendHealth.status === 'ok' || backendHealth.status === 'healthy'

  const status = isHealthy ? 'healthy' : 'degraded'
  const httpStatus = isHealthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE

  return NextResponse.json(
    {
      status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0',
      backend: backendHealth
        ? {
            status: backendHealth.status,
            message: backendHealth.message,
            dependencies: backendHealth.dependencies ?? [],
          }
        : { status: 'unknown', message: 'Backend URL not configured' },
    },
    { status: httpStatus }
  )
}
