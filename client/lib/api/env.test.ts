import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getEnv, isProduction, isDevelopment, isMaintenanceMode, getApiConfig } from './env'

beforeEach(() => {
  vi.resetModules()
  delete (globalThis as any).__env
  // Clear cached validated env by re-importing fresh each test
})

describe('getEnv', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...OLD_ENV }
    // The module-level cache is cleared by vi.resetModules(); each test
    // re-imports './env' fresh via dynamic import().
  })

  afterAll(() => {
    process.env = OLD_ENV
  })

  it('parses anon-key vars but rejects SUPABASE_SERVICE_ROLE_KEY (not in schema)', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'should-not-be-accessible'

    const { getEnv: get } = await import('./env')
    const env = get()

    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('https://test.supabase.co')
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('test-anon-key')
    // service-role key is not in the schema so must be undefined in returned env
    expect((env as any).SUPABASE_SERVICE_ROLE_KEY).toBeUndefined()
  })

  it('does not expose SUPABASE_SERVICE_ROLE_KEY in type definition', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'

    const { getEnv: get } = await import('./env')
    const env = get()

    // TypeScript prevents access to non-existent keys at compile time;
    // at runtime the property must not appear on the object.
    const keys = Object.keys(env)
    expect(keys).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
  })

  it('returns anon key when properly configured', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
    process.env.NODE_ENV = 'test'

    const { getEnv: get } = await import('./env')
    const env = get()

    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('test-anon-key')
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('https://test.supabase.co')
  })

  it('does not throw in development when vars are missing', async () => {
    process.env.NODE_ENV = 'development'
    delete process.env.NEXT_PUBLIC_SUPABASE_URL

    const { getEnv: get } = await import('./env')
    const env = get()

    // The client schema is intentionally all-optional, so getEnv() never throws
    // on a *missing* var — it just leaves it undefined. Required-var enforcement
    // is delegated to client/scripts/validate-env.js (see docs/ENVIRONMENT.md).
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBeUndefined()
  })

  it('does not throw in production for missing vars (enforcement is in validate-env.js)', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    const { getEnv: get } = await import('./env')
    // Missing (vs. malformed) values are tolerated; the build-time
    // validate-env.js gate is what fails fast on missing required vars.
    expect(() => get()).not.toThrow()
  })
})

describe('isProduction / isDevelopment / isMaintenanceMode', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('detects production environment', async () => {
    process.env.NODE_ENV = 'production'
    const { isProduction: isProd } = await import('./env')
    expect(isProd()).toBe(true)
  })

  it('detects development environment', async () => {
    process.env.NODE_ENV = 'development'
    const { isDevelopment: isDev } = await import('./env')
    expect(isDev()).toBe(true)
  })

  it('detects maintenance mode', async () => {
    process.env.MAINTENANCE_MODE = 'true'
    process.env.NODE_ENV = 'development'
    const { isMaintenanceMode: isMM } = await import('./env')
    expect(isMM()).toBe(true)
  })

  it('returns false when maintenance mode is off', async () => {
    process.env.MAINTENANCE_MODE = 'false'
    process.env.NODE_ENV = 'development'
    const { isMaintenanceMode: isMM } = await import('./env')
    expect(isMM()).toBe(false)
  })
})

describe('getApiConfig', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.NEXT_PUBLIC_API_URL
    delete process.env.NEXT_PUBLIC_API_BASE
  })

  it('returns API config from the deprecated NEXT_PUBLIC_API_BASE fallback', async () => {
    process.env.NEXT_PUBLIC_API_BASE = 'https://api.example.com'
    const { getApiConfig: getCfg } = await import('./env')
    const config = getCfg()
    expect(config.baseUrl).toBe('https://api.example.com')
  })

  it('prefers the canonical NEXT_PUBLIC_API_URL over NEXT_PUBLIC_API_BASE', async () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://canonical.example.com'
    process.env.NEXT_PUBLIC_API_BASE = 'https://legacy.example.com'
    const { getApiConfig: getCfg } = await import('./env')
    const config = getCfg()
    expect(config.baseUrl).toBe('https://canonical.example.com')
  })
})
