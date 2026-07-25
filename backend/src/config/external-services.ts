import { RetryOptions } from '../utils/retry';

export interface ServicePolicy {
  timeoutMs: number;
  retryPolicy: RetryOptions;
}

/**
 * Centralized policies for external service dependencies.
 * Each service has a specific timeout and retry policy based on its 
 * typical latency and failure modes.
 */
export const EXTERNAL_SERVICE_POLICIES: Record<string, ServicePolicy> = {
  // Gmail API (Google OAuth/Mail)
  gmail: {
    timeoutMs: 15000,
    retryPolicy: {
      maxAttempts: 3,
      initialDelay: 1000,
      maxDelay: 5000,
      multiplier: 2,
      jitter: true,
    },
  },
  
  // Outlook API (Microsoft Graph)
  outlook: {
    timeoutMs: 15000,
    retryPolicy: {
      maxAttempts: 3,
      initialDelay: 1000,
      maxDelay: 5000,
      multiplier: 2,
      jitter: true,
    },
  },

  // Yahoo Mail (IMAP)
  yahoo: {
    timeoutMs: 30000,
    retryPolicy: {
      maxAttempts: 3,
      initialDelay: 1000,
      maxDelay: 5000,
      multiplier: 2,
      jitter: true,
    },
  },

  // iCloud Mail (IMAP)
  icloud: {
    timeoutMs: 30000,
    retryPolicy: {
      maxAttempts: 3,
      initialDelay: 1000,
      maxDelay: 5000,
      multiplier: 2,
      jitter: true,
    },
  },
  
  // Stellar / Soroban RPC
  stellar_rpc: {
    timeoutMs: 15000,
    retryPolicy: {
      maxAttempts: 5,
      initialDelay: 1000,
      maxDelay: 16000,
      multiplier: 2,
      jitter: true,
    },
  },
  
  // Stripe API
  stripe: {
    timeoutMs: 10000,
    retryPolicy: {
      maxAttempts: 2,
      initialDelay: 1000,
      maxDelay: 4000,
      multiplier: 2,
      jitter: true,
    },
  },
  
  // Paystack API
  paystack: {
    timeoutMs: 10000,
    retryPolicy: {
      maxAttempts: 2,
      initialDelay: 1000,
      maxDelay: 4000,
      multiplier: 2,
      jitter: true,
    },
  },
  
  // Fiat Exchange Rate APIs (ExchangeRate-API, Frankfurter)
  exchange_rates: {
    timeoutMs: 5000,
    retryPolicy: {
      maxAttempts: 3,
      initialDelay: 1000,
      maxDelay: 3000,
      multiplier: 2,
      jitter: true,
    },
  },
  
  // LLM Services (Gemini)
  llm: {
    timeoutMs: 30000,
    retryPolicy: {
      maxAttempts: 2,
      initialDelay: 2000,
      maxDelay: 10000,
      multiplier: 2,
      jitter: true,
    },
  },

  // Outbound Webhooks (user-defined)
  outbound_webhooks: {
    timeoutMs: 10000,
    retryPolicy: {
      maxAttempts: 5,
      initialDelay: 2000,
      maxDelay: 60000,
      multiplier: 2,
      jitter: true,
    },
  },

  // Slack Notifications
  slack: {
    timeoutMs: 5000,
    retryPolicy: {
      maxAttempts: 3,
      initialDelay: 1000,
      maxDelay: 5000,
      multiplier: 2,
      jitter: true,
    },
  },

  // Telegram Bot API
  telegram: {
    timeoutMs: 10000,
    retryPolicy: {
      maxAttempts: 3,
      initialDelay: 1000,
      maxDelay: 5000,
      multiplier: 2,
      jitter: true,
    },
  },

  // Default policy for unspecified services
  default: {
    timeoutMs: 10000,
    retryPolicy: {
      maxAttempts: 3,
      initialDelay: 1000,
      maxDelay: 30000,
      multiplier: 2,
      jitter: true,
    },
  },
};

export type ServiceName = keyof typeof EXTERNAL_SERVICE_POLICIES;

/**
 * Gets the policy for a given service name, falling back to the default policy if not found.
 */
export function getServicePolicy(serviceName: string): ServicePolicy {
  return EXTERNAL_SERVICE_POLICIES[serviceName] || EXTERNAL_SERVICE_POLICIES.default;
}
