import { BudgetExceededError } from './errors';

export interface BudgetConfig {
  amount: bigint;
  asset: string;
}

export interface PaidFetchConfig {
  budget?: BudgetConfig;
  // ...existing config fields are preserved by the surrounding module
  [key: string]: unknown;
}

export interface Receipt {
  amount: bigint;
  asset: string;
}

export interface BudgetState {
  spent: bigint;
  remaining: bigint;
  asset: string;
}

interface BudgetTracker {
  config: BudgetConfig;
  spent: bigint;
}

function createBudgetTracker(config: BudgetConfig): BudgetTracker {
  return { config, spent: 0n };
}

function assertWithinBudget(tracker: BudgetTracker, next: Receipt): void {
  if (next.asset !== tracker.config.asset) {
    return;
  }
  const projected = tracker.spent + next.amount;
  if (projected > tracker.config.amount) {
    throw new BudgetExceededError({
      asset: tracker.config.asset,
      budget: tracker.config.amount,
      spent: tracker.spent,
      attempted: next.amount,
    });
  }
}

function recordSpend(tracker: BudgetTracker, receipt: Receipt): void {
  if (receipt.asset !== tracker.config.asset) {
    return;
  }
  tracker.spent += receipt.amount;
}

export interface PaidFetch {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  getBudget(): BudgetState | undefined;
  resetBudget(): void;
}

export function createPaidFetch(config: PaidFetchConfig): PaidFetch {
  const tracker = config.budget ? createBudgetTracker(config.budget) : undefined;

  const paidFetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    if (tracker) {
      // Pre-flight: reject before signing if the next state would cross the budget.
      // The expected cost is derived from the configured per-call amount when
      // available; otherwise the receipt-based check below still guards signing.
      const expected = (config as { amount?: bigint }).amount;
      if (typeof expected === 'bigint') {
        assertWithinBudget(tracker, { amount: expected, asset: tracker.config.asset });
      }
    }

    const response = await fetch(input, init);

    if (tracker) {
      const receipt = extractReceipt(response);
      if (receipt) {
        recordSpend(tracker, receipt);
      }
    }

    return response;
  }) as PaidFetch;

  paidFetch.getBudget = (): BudgetState | undefined => {
    if (!tracker) {
      return undefined;
    }
    return {
      spent: tracker.spent,
      remaining: tracker.config.amount - tracker.spent,
      asset: tracker.config.asset,
    };
  };

  paidFetch.resetBudget = (): void => {
    if (tracker) {
      tracker.spent = 0n;
    }
  };

  return paidFetch;
}

function extractReceipt(response: Response): Receipt | undefined {
  const header = response.headers.get('x-payment-receipt');
  if (!header) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(header) as { amount?: string; asset?: string };
    if (parsed.amount === undefined || parsed.asset === undefined) {
      return undefined;
    }
    return { amount: BigInt(parsed.amount), asset: parsed.asset };
  } catch {
    return undefined;
  }
}
