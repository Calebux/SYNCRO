/**
 * Readiness Check Endpoint
 * Verifies that the service is ready to accept traffic
 * Checks critical dependencies (database, external services, blockchain RPC, FX rates, etc.)
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createSuccessResponse, createErrorResponse, ApiErrors } from '@/lib/api/errors'
import { HttpStatus } from '@/lib/api/types'

type DependencyStatus = {
  name: string
  status: 'healthy' | 'degraded' | 'unhealthy'
  responseTime?: number
  error?: string
}

async function checkSupabase(): Promise<DependencyStatus> {
  const start = Date.now()
  try {
    const supabase = await createClient()
    const { error } = await supabase.from('subscriptions').select('id').limit(1)
    
    const responseTime = Date.now() - start
    
    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned, which is fine
      return {
        name: 'supabase',
        status: 'unhealthy',
        responseTime,
        error: error.message,
      }
    }

    return {
      name: 'supabase',
      status: 'healthy',
      responseTime,
    }
  } catch (error) {
    return {
      name: 'supabase',
      status: 'unhealthy',
      responseTime: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

async function checkEnvironment(): Promise<DependencyStatus> {
  const requiredVars = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ]

  const missing = requiredVars.filter((varName) => !process.env[varName])

  if (missing.length > 0) {
    return {
      name: 'environment',
      status: 'unhealthy',
      error: `Missing environment variables: ${missing.join(', ')}`,
    }
  }

  return {
    name: 'environment',
    status: 'healthy',
  }
}

/**
 * Check Stellar RPC/Horizon connectivity.
 * Returns degraded if the RPC URL is not configured.
 */
async function checkRpcHorizon(): Promise<DependencyStatus> {
  const start = Date.now()
  try {
    const rpcUrl = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || process.env.SOROBAN_RPC_URL

    if (!rpcUrl) {
      return {
        name: 'rpc_horizon',
        status: 'degraded',
        responseTime: Date.now() - start,
        error: 'RPC URL not configured',
      }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    const response = await fetch(rpcUrl, {
      method: 'HEAD',
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!response.ok) {
      return {
        name: 'rpc_horizon',
        status: 'unhealthy',
        responseTime: Date.now() - start,
        error: `RPC endpoint returned status ${response.status}`,
      }
    }

    return {
      name: 'rpc_horizon',
      status: 'healthy',
      responseTime: Date.now() - start,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'RPC check failed'
    if (message.includes('abort') || message.includes('timeout')) {
      return {
        name: 'rpc_horizon',
        status: 'unhealthy',
        responseTime: Date.now() - start,
        error: 'RPC endpoint timed out',
      }
    }
    return {
      name: 'rpc_horizon',
      status: 'unhealthy',
      responseTime: Date.now() - start,
      error: message,
    }
  }
}

/**
 * Check FX (foreign exchange) provider connectivity.
 */
async function checkFxProvider(): Promise<DependencyStatus> {
  const start = Date.now()
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD', {
      method: 'HEAD',
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!response.ok) {
      return {
        name: 'fx_provider',
        status: 'unhealthy',
        responseTime: Date.now() - start,
        error: `FX provider returned status ${response.status}`,
      }
    }

    return {
      name: 'fx_provider',
      status: 'healthy',
      responseTime: Date.now() - start,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FX provider check failed'
    if (message.includes('abort') || message.includes('timeout')) {
      return {
        name: 'fx_provider',
        status: 'unhealthy',
        responseTime: Date.now() - start,
        error: 'FX provider timed out',
      }
    }
    return {
      name: 'fx_provider',
      status: 'unhealthy',
      responseTime: Date.now() - start,
      error: message,
    }
  }
}

export async function GET() {
  const checks: DependencyStatus[] = []

  // Check environment variables
  checks.push(await checkEnvironment())

  // Check database connection
  checks.push(await checkSupabase())

  // Check Stellar RPC/Horizon connectivity
  checks.push(await checkRpcHorizon())

  // Check FX provider connectivity
  checks.push(await checkFxProvider())

  // Readiness: all critical dependencies must be healthy
  // Critical deps: supabase (database), environment
  // Degraded: rpc_horizon, fx_provider (graceful when not configured)
  const critical = ['supabase', 'environment']
  const criticalUnhealthy = checks.filter(
    (c) => critical.includes(c.name) && c.status === 'unhealthy'
  )

  const allHealthy = criticalUnhealthy.length === 0
  const status = allHealthy ? 'ready' : 'not_ready'

  const response = {
    status,
    timestamp: new Date().toISOString(),
    checks,
    summary: {
      total: checks.length,
      healthy: checks.filter((c) => c.status === 'healthy').length,
      degraded: checks.filter((c) => c.status === 'degraded').length,
      unhealthy: checks.filter((c) => c.status === 'unhealthy').length,
    },
  }

  if (allHealthy) {
    return createSuccessResponse(response, HttpStatus.OK)
  } else {
    return createErrorResponse(
      ApiErrors.serviceUnavailable('Service is not ready'),
      undefined
    )
  }
}

