export interface SubscriptionInput {
  name: string;
  amount: number;
  billingCycle: 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'annual';
  currency: string;
}

export interface ChannelRecommendation {
  recommendedDeposit: number;
  monthlyCost: number;
  safetyMarginPercent: number;
  volatilityBufferPercent: number;
  renewalsBeforeTopUp: number;
  settlementFrequency: 'weekly' | 'biweekly' | 'monthly';
  breakdown: SubscriptionCostBreakdown[];
  currency: string;
}

export interface SubscriptionCostBreakdown {
  name: string;
  monthlyEquivalent: number;
  billingCycle: string;
  originalAmount: number;
}

const DEFAULT_SAFETY_MARGIN = 0.2;
const DEFAULT_VOLATILITY_BUFFER = 0.1;
const DEFAULT_CHANNEL_DURATION_MONTHS = 3;

function toMonthlyCost(amount: number, cycle: SubscriptionInput['billingCycle']): number {
  switch (cycle) {
    case 'weekly':
      return amount * (52 / 12);
    case 'monthly':
      return amount;
    case 'quarterly':
      return amount / 3;
    case 'yearly':
    case 'annual':
      return amount / 12;
  }
}

function renewalsPerMonth(cycle: SubscriptionInput['billingCycle']): number {
  switch (cycle) {
    case 'weekly':
      return 52 / 12;
    case 'monthly':
      return 1;
    case 'quarterly':
      return 1 / 3;
    case 'yearly':
    case 'annual':
      return 1 / 12;
  }
}

export function calculateChannelRecommendation(
  subscriptions: SubscriptionInput[],
  options: {
    safetyMarginPercent?: number;
    volatilityBufferPercent?: number;
    channelDurationMonths?: number;
    isXlmDenominated?: boolean;
  } = {}
): ChannelRecommendation {
  const safetyMargin = options.safetyMarginPercent ?? DEFAULT_SAFETY_MARGIN;
  const volatilityBuffer =
    options.isXlmDenominated ? (options.volatilityBufferPercent ?? DEFAULT_VOLATILITY_BUFFER) : 0;
  const durationMonths = options.channelDurationMonths ?? DEFAULT_CHANNEL_DURATION_MONTHS;

  const breakdown: SubscriptionCostBreakdown[] = subscriptions.map((sub) => ({
    name: sub.name,
    monthlyEquivalent: toMonthlyCost(sub.amount, sub.billingCycle),
    billingCycle: sub.billingCycle,
    originalAmount: sub.amount,
  }));

  const monthlyCost = breakdown.reduce((sum, b) => sum + b.monthlyEquivalent, 0);
  const totalForDuration = monthlyCost * durationMonths;
  const withSafety = totalForDuration * (1 + safetyMargin);
  const recommendedDeposit = withSafety * (1 + volatilityBuffer);

  const totalRenewalsPerMonth = subscriptions.reduce(
    (sum, sub) => sum + renewalsPerMonth(sub.billingCycle),
    0
  );
  const renewalsBeforeTopUp = Math.floor(totalRenewalsPerMonth * durationMonths);

  let settlementFrequency: ChannelRecommendation['settlementFrequency'];
  if (totalRenewalsPerMonth > 8) {
    settlementFrequency = 'weekly';
  } else if (totalRenewalsPerMonth > 3) {
    settlementFrequency = 'biweekly';
  } else {
    settlementFrequency = 'monthly';
  }

  const currency = subscriptions.length > 0 ? subscriptions[0].currency : 'USD';

  return {
    recommendedDeposit: Math.ceil(recommendedDeposit * 100) / 100,
    monthlyCost: Math.ceil(monthlyCost * 100) / 100,
    safetyMarginPercent: safetyMargin,
    volatilityBufferPercent: volatilityBuffer,
    renewalsBeforeTopUp,
    settlementFrequency,
    breakdown,
    currency,
  };
}
