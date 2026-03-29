export interface MonthlySpend {
  month: string; // YYYY-MM
  total_spend: number;
  count: number;
}

export interface CategorySpend {
  category: string;
  total_spend: number;
  percentage: number;
  count: number;
}

export interface SubscriptionSpend {
  id: string;
  name: string;
  price: number;
  billing_cycle: string;
  monthly_normalized_price: number;
}

export interface AnalyticsSummary {
  total_monthly_spend: number;
  active_subscriptions: number;
  upcoming_renewals_count: number;
  monthly_trend: MonthlySpend[];
  category_breakdown: CategorySpend[];
  top_subscriptions: SubscriptionSpend[];
  budget_status: {
    overall_limit: number | null;
    current_spend: number;
    percentage: number;
  };
}

export interface Budget {
  id: string;
  user_id: string;
  category: string | null;
  budget_limit: number;
  alert_threshold: number;
  created_at: string;
  updated_at: string;
}
