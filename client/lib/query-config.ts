/**
 * Shared query/cache configuration for TanStack React Query
 * 
 * This configuration centralizes retry, staleTime, and background refetch behavior
 * for all remote data access throughout the application.
 * 
 * Cache Key Convention:
 * - Collection queries: ['resource', 'list', filters?]
 * - Individual resources: ['resource', resourceId]
 * - Parameterized queries: ['resource', 'action', params?]
 * 
 * Examples:
 * - All email accounts: ['email-accounts', 'list']
 * - Single email account: ['email-account', accountId]
 * - Primary email account: ['email-accounts', 'primary']
 * - All subscriptions: ['subscriptions', 'list']
 * - Single subscription: ['subscription', subscriptionId]
 * - Filtered subscriptions: ['subscriptions', 'list', { status: 'active' }]
 */

import type { DefaultOptions } from "@tanstack/react-query";

/**
 * Conservative defaults based on existing hook behavior:
 * - retry: 2 attempts (preserves retryWithBackoff pattern in use-subscriptions)
 * - staleTime: 60 seconds (preserves existing QueryProvider default)
 * - refetchOnWindowFocus: false (avoids aggressive refetching during development)
 * - refetchOnReconnect: true (ensures data refresh after offline periods)
 */
export const queryConfig: DefaultOptions = {
  queries: {
    retry: 2,
    staleTime: 60_000, // 60 seconds - data considered fresh for 1 minute
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    refetchOnMount: true,
  },
  mutations: {
    retry: 1, // Mutations retry once on failure
  },
};

/**
 * Cache key factories for consistent query key generation
 */
export const queryKeys = {
  emailAccounts: {
    all: ["email-accounts"] as const,
    lists: () => ["email-accounts", "list"] as const,
    list: (filters?: Record<string, unknown>) =>
      ["email-accounts", "list", filters] as const,
    detail: (id: number) => ["email-account", id] as const,
    primary: () => ["email-accounts", "primary"] as const,
  },
  subscriptions: {
    all: ["subscriptions"] as const,
    lists: () => ["subscriptions", "list"] as const,
    list: (filters?: Record<string, unknown>) =>
      ["subscriptions", "list", filters] as const,
    detail: (id: number) => ["subscription", id] as const,
  },
  integrations: {
    all: ["integrations"] as const,
    lists: () => ["integrations", "list"] as const,
    detail: (id: number) => ["integration", id] as const,
  },
} as const;
