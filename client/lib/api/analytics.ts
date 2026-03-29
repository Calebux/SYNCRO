import { createClient } from '../supabase/client';
const supabase = createClient();
import axios from 'axios';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

export interface MonthlySpend {
  month: string;
  total_spend: number;
  count: number;
}

export interface CategorySpend {
  category: string;
  total_spend: number;
  percentage: number;
  count: number;
}

export interface AnalyticsSummary {
  total_monthly_spend: number;
  active_subscriptions: number;
  upcoming_renewals_count: number;
  monthly_trend: MonthlySpend[];
  category_breakdown: CategorySpend[];
  top_subscriptions: any[];
  budget_status: {
    overall_limit: number | null;
    current_spend: number;
    percentage: number;
  };
}

export const analyticsApi = {
  getSummary: async (): Promise<AnalyticsSummary> => {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await axios.get(`${BACKEND_URL}/api/analytics/summary`, {
      headers: {
        Authorization: `Bearer ${session?.access_token}`
      }
    });
    return response.data.data;
  },

  getBudgets: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await axios.get(`${BACKEND_URL}/api/analytics/budgets`, {
      headers: {
        Authorization: `Bearer ${session?.access_token}`
      }
    });
    return response.data.data;
  },

  upsertBudget: async (budget: { overall_limit: number, category?: string | null }) => {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await axios.post(`${BACKEND_URL}/api/analytics/budgets`, {
      limit: budget.overall_limit,
      category: budget.category || null
    }, {
      headers: {
        Authorization: `Bearer ${session?.access_token}`
      }
    });
    return response.data.data;
  }
};
