/**
 * API client mocks for testing
 * 
 * Provides mock implementations of external service clients (Supabase, Stripe)
 * for isolated testing without real API calls.
 * 
 * @example
 * const supabase = mockSupabaseClient();
 * supabase.from('subscriptions').select().mockResolvedValue({ data: [mockSubscription()], error: null });
 */

import { vi } from 'vitest';
import type { MockUser } from './factories';

/**
 * Mock Supabase client with chainable query methods
 */
export interface MockSupabaseClient {
  from: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  neq: ReturnType<typeof vi.fn>;
  gt: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  lt: ReturnType<typeof vi.fn>;
  lte: ReturnType<typeof vi.fn>;
  like: ReturnType<typeof vi.fn>;
  ilike: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  auth: {
    getUser: ReturnType<typeof vi.fn>;
    getSession: ReturnType<typeof vi.fn>;
    signIn: ReturnType<typeof vi.fn>;
    signOut: ReturnType<typeof vi.fn>;
    signUp: ReturnType<typeof vi.fn>;
    updateUser: ReturnType<typeof vi.fn>;
  };
  rpc: ReturnType<typeof vi.fn>;
}

/**
 * Creates a mock Supabase client with chainable methods
 * 
 * @example
 * const supabase = mockSupabaseClient();
 * supabase.from.mockReturnThis();
 * supabase.select.mockReturnThis();
 * supabase.single.mockResolvedValue({ data: mockSubscription(), error: null });
 */
export const mockSupabaseClient = (user?: MockUser): MockSupabaseClient => {
  const mockChain = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    like: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ 
        data: { user: user || null }, 
        error: null 
      }),
      getSession: vi.fn().mockResolvedValue({ 
        data: { session: user ? { user } : null }, 
        error: null 
      }),
      signIn: vi.fn().mockResolvedValue({ 
        data: { user: user || null, session: null }, 
        error: null 
      }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      signUp: vi.fn().mockResolvedValue({ 
        data: { user: user || null, session: null }, 
        error: null 
      }),
      updateUser: vi.fn().mockResolvedValue({ 
        data: { user: user || null }, 
        error: null 
      }),
    },
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  return mockChain;
};

/**
 * Mock Stripe client for payment testing
 */
export interface MockStripeClient {
  paymentIntents: {
    create: ReturnType<typeof vi.fn>;
    retrieve: ReturnType<typeof vi.fn>;
    confirm: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  customers: {
    create: ReturnType<typeof vi.fn>;
    retrieve: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
  };
  subscriptions: {
    create: ReturnType<typeof vi.fn>;
    retrieve: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  };
  webhooks: {
    constructEvent: ReturnType<typeof vi.fn>;
  };
  refunds: {
    create: ReturnType<typeof vi.fn>;
    retrieve: ReturnType<typeof vi.fn>;
  };
}

/**
 * Creates a mock Stripe client
 * 
 * @example
 * const stripe = mockStripeClient();
 * stripe.paymentIntents.create.mockResolvedValue({ id: 'pi_test', status: 'succeeded' });
 */
export const mockStripeClient = (): MockStripeClient => ({
  paymentIntents: {
    create: vi.fn().mockResolvedValue({ 
      id: `pi_${Math.random().toString(36).substr(2, 24)}`, 
      status: 'succeeded',
      amount: 1000,
      currency: 'usd',
    }),
    retrieve: vi.fn().mockResolvedValue({ 
      id: `pi_${Math.random().toString(36).substr(2, 24)}`, 
      status: 'succeeded' 
    }),
    confirm: vi.fn().mockResolvedValue({ 
      id: `pi_${Math.random().toString(36).substr(2, 24)}`, 
      status: 'succeeded' 
    }),
    cancel: vi.fn().mockResolvedValue({ 
      id: `pi_${Math.random().toString(36).substr(2, 24)}`, 
      status: 'canceled' 
    }),
    update: vi.fn().mockResolvedValue({ 
      id: `pi_${Math.random().toString(36).substr(2, 24)}`, 
      status: 'succeeded' 
    }),
  },
  customers: {
    create: vi.fn().mockResolvedValue({ 
      id: `cus_${Math.random().toString(36).substr(2, 24)}`,
      email: 'test@example.com',
    }),
    retrieve: vi.fn().mockResolvedValue({ 
      id: `cus_${Math.random().toString(36).substr(2, 24)}`,
      email: 'test@example.com',
    }),
    update: vi.fn().mockResolvedValue({ 
      id: `cus_${Math.random().toString(36).substr(2, 24)}`,
      email: 'test@example.com',
    }),
    del: vi.fn().mockResolvedValue({ 
      id: `cus_${Math.random().toString(36).substr(2, 24)}`,
      deleted: true,
    }),
  },
  subscriptions: {
    create: vi.fn().mockResolvedValue({ 
      id: `sub_${Math.random().toString(36).substr(2, 24)}`,
      status: 'active',
    }),
    retrieve: vi.fn().mockResolvedValue({ 
      id: `sub_${Math.random().toString(36).substr(2, 24)}`,
      status: 'active',
    }),
    update: vi.fn().mockResolvedValue({ 
      id: `sub_${Math.random().toString(36).substr(2, 24)}`,
      status: 'active',
    }),
    cancel: vi.fn().mockResolvedValue({ 
      id: `sub_${Math.random().toString(36).substr(2, 24)}`,
      status: 'canceled',
    }),
  },
  webhooks: {
    constructEvent: vi.fn().mockReturnValue({ 
      id: `evt_${Math.random().toString(36).substr(2, 24)}`,
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: `pi_${Math.random().toString(36).substr(2, 24)}`,
          status: 'succeeded',
        },
      },
    }),
  },
  refunds: {
    create: vi.fn().mockResolvedValue({
      id: `re_${Math.random().toString(36).substr(2, 24)}`,
      status: 'succeeded',
    }),
    retrieve: vi.fn().mockResolvedValue({
      id: `re_${Math.random().toString(36).substr(2, 24)}`,
      status: 'succeeded',
    }),
  },
});

/**
 * Mock Next.js request for API route testing
 */
export interface MockNextRequest {
  method: string;
  url: string;
  headers: Map<string, string>;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
  formData: () => Promise<FormData>;
}

/**
 * Creates a mock Next.js request
 * 
 * @example
 * const request = mockNextRequest({
 *   method: 'POST',
 *   body: { name: 'Netflix', price: 15.99 }
 * });
 */
export const mockNextRequest = (options: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
} = {}): MockNextRequest => {
  const headers = new Map(Object.entries(options.headers || {}));
  
  return {
    method: options.method || 'GET',
    url: options.url || 'http://localhost:3000/api/test',
    headers,
    json: vi.fn().mockResolvedValue(options.body || {}),
    text: vi.fn().mockResolvedValue(JSON.stringify(options.body || {})),
    formData: vi.fn().mockResolvedValue(new FormData()),
  };
};

/**
 * Mock Next.js response for API route testing
 */
export const mockNextResponse = () => ({
  json: vi.fn((data: unknown) => ({
    status: 200,
    json: async () => data,
  })),
  text: vi.fn((text: string) => ({
    status: 200,
    text: async () => text,
  })),
});

/**
 * Mock fetch for API testing
 */
export const mockFetch = (response?: unknown, status: number = 200) => {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => response,
    text: async () => JSON.stringify(response),
    headers: new Headers(),
  });
};
