import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getInitialData } from './page-data'
import { createClient } from '@/lib/supabase/server'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

type SupabaseQuery = {
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  order: ReturnType<typeof vi.fn>
}

function makeQuery(result: any) {
  const resolved = Promise.resolve(result)
  const query: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    then: resolved.then.bind(resolved),
    catch: resolved.catch.bind(resolved),
    finally: resolved.finally.bind(resolved),
  }
  return query as unknown as SupabaseQuery
}

describe('getInitialData — unauthenticated', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('returns isDemo=true with empty datasets for unauthenticated users', async () => {
    const mockSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    }
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any)

    const result = await getInitialData()

    expect(result.isDemo).toBe(true)
    expect(result.warnings).toHaveLength(0)
    expect(result.subscriptions).toEqual([])
    expect(result.emailAccounts).toEqual([])
  })

  it('returns isDemo=true when auth throws', async () => {
    vi.mocked(createClient).mockRejectedValue(new Error('connection refused'))

    const result = await getInitialData()

    expect(result.isDemo).toBe(true)
    expect(result.warnings).toHaveLength(0)
  })
})

describe('getInitialData — partial failures', () => {
  const mockUser = { id: 'user-123' }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('adds a warning and returns empty array when subscriptions query fails', async () => {
    const failedQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: { message: 'timeout', code: 'PGRST_TIMEOUT' } }),
    }
    const okQuery = makeQuery({ data: [], error: null })
    const priceHistoryQuery = makeQuery({ data: [], error: null })

    const fromMock = vi.fn((table: string) => {
      if (table === 'subscriptions') return failedQuery
      if (table === 'subscription_price_history') return priceHistoryQuery
      return okQuery
    })

    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }) },
      from: fromMock,
    } as any)

    const result = await getInitialData()

    expect(result.isDemo).toBe(false)
    expect(result.subscriptions).toEqual([])
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ query: 'subscriptions' }),
      ]),
    )
  })

  it('adds a warning and returns empty array when email_accounts query fails', async () => {
    const okQuery = makeQuery({ data: [], error: null })
    const failedQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: { message: 'forbidden', status: 403 } }),
    }

    const fromMock = vi.fn((table: string) => {
      if (table === 'email_accounts') return failedQuery
      return okQuery
    })

    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }) },
      from: fromMock,
    } as any)

    const result = await getInitialData()

    expect(result.emailAccounts).toEqual([])
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ query: 'email_accounts' }),
      ]),
    )
  })

  it('surfaces warnings for all failed queries independently (partial load)', async () => {
    const failedQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: { message: 'error', code: '500' } }),
    }

    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }) },
      from: vi.fn().mockReturnValue(failedQuery),
    } as any)

    const result = await getInitialData()

    const queryNames = result.warnings.map((w) => w.query)
    expect(queryNames).toContain('subscriptions')
    expect(queryNames).toContain('email_accounts')
    expect(queryNames).toContain('payments')
  })

  it('loads and normalizes historical price changes for authenticated users', async () => {
    const subscriptionsResult = {
      data: [
        {
          id: 1,
          name: 'ChatGPT Plus',
          category: 'AI Tools',
          price: 20,
          icon: '🤖',
          renews_in: 30,
          status: 'active',
          color: '#000000',
          renewal_url: 'https://chat.openai.com',
          tags: [],
          date_added: '2024-01-01T00:00:00Z',
          email_account_id: 1,
          last_used_at: null,
          has_api_key: false,
          is_trial: false,
          trial_ends_at: null,
          price_after_trial: null,
          source: 'manual',
          manually_edited: false,
          edited_fields: [],
          pricing_type: 'fixed',
          billing_cycle: 'monthly',
          cancelled_at: null,
          active_until: null,
          paused_at: null,
          resumes_at: null,
          price_range: null,
          price_history: [],
        },
      ],
      error: null,
    }

    const priceHistoryResult = {
      data: [
        {
          id: 'history-uuid',
          subscription_id: 1,
          old_price: '10',
          new_price: '15',
          changed_at: '2024-02-01T12:00:00Z',
        },
      ],
      error: null,
    }

    const fromMock = vi.fn((table: string) => {
      if (table === 'subscriptions') return makeQuery(subscriptionsResult)
      if (table === 'subscription_price_history') return makeQuery(priceHistoryResult)
      return makeQuery({ data: [], error: null })
    })

    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }) },
      from: fromMock,
    } as any)

    const result = await getInitialData()

    expect(result.warnings).toHaveLength(0)
    expect(result.priceChanges).toHaveLength(1)
    expect(result.priceChanges[0]).toMatchObject({
      id: 'history-uuid',
      subscriptionId: 1,
      name: 'ChatGPT Plus',
      oldPrice: 10,
      newPrice: 15,
      changeType: 'increase',
      annualImpact: 60,
      percentChange: 50,
      changeDate: '2024-02-01T12:00:00Z',
    })
  })

  it('returns real consolidation suggestions when subscriptions share a flaggable category', async () => {
    const subscriptionsResult = {
      data: [
        {
          id: 1, name: 'ChatGPT Plus', category: 'ai_tools', price: 20,
          icon: '🤖', renews_in: 30, status: 'active', color: '#000000',
          renewal_url: null, tags: [], date_added: '2024-01-01T00:00:00Z',
          email_account_id: null, last_used_at: null, has_api_key: false,
          is_trial: false, trial_ends_at: null, price_after_trial: null,
          source: 'manual', manually_edited: false, edited_fields: [],
          pricing_type: 'fixed', billing_cycle: 'monthly', cancelled_at: null,
          active_until: null, paused_at: null, resumes_at: null,
          price_range: null, price_history: [],
        },
        {
          id: 2, name: 'Gemini Advanced', category: 'ai_tools', price: 20,
          icon: '✨', renews_in: 15, status: 'active', color: '#000000',
          renewal_url: null, tags: [], date_added: '2024-01-01T00:00:00Z',
          email_account_id: null, last_used_at: null, has_api_key: false,
          is_trial: false, trial_ends_at: null, price_after_trial: null,
          source: 'manual', manually_edited: false, edited_fields: [],
          pricing_type: 'fixed', billing_cycle: 'monthly', cancelled_at: null,
          active_until: null, paused_at: null, resumes_at: null,
          price_range: null, price_history: [],
        },
      ],
      error: null,
    }

    const fromMock = vi.fn((table: string) => {
      if (table === 'subscriptions') return makeQuery(subscriptionsResult)
      return makeQuery({ data: [], error: null })
    })

    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }) },
      from: fromMock,
    } as any)

    const result = await getInitialData()

    expect(result.consolidationSuggestions).toHaveLength(1)
    expect(result.consolidationSuggestions[0]).toMatchObject({
      id: 'consolidation_ai_tools',
      category: 'ai tools',
      services: expect.arrayContaining(['ChatGPT Plus', 'Gemini Advanced']),
      suggestedBundle: 'one AI subscription',
    })
  })
})
