import { createClient } from '../supabase/client';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

export type RenewalEventType =
  | 'renewed'
  | 'failed'
  | 'reminder_sent'
  | 'cancelled'
  | 'paused'
  | 'resumed'
  | 'trial_started'
  | 'trial_ended';

export type RenewalStatus = 'success' | 'failed' | 'pending' | 'skipped';

export interface RenewalEvent {
  id: string;
  date: string;
  type: RenewalEventType;
  status?: RenewalStatus;
  amount?: number;
  currency?: string;
  paymentMethod?: string;
  transactionHash?: string;
  blockchainLedger?: number;
  blockchainVerified?: boolean;
  explorerUrl?: string;
  channel?: string;
  notes?: string;
  /** Id of an invoice PDF stored in Supabase Storage, if one is available. */
  invoiceId?: string;
}

export interface RenewalHistoryResponse {
  subscriptionId: string;
  history: RenewalEvent[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

async function getAuthHeader(): Promise<Record<string, string>> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token
    ? { Authorization: `Bearer ${session.access_token}` }
    : {};
}

export const renewalHistoryApi = {
  getHistory: async (
    subscriptionId: string,
    params: { page?: number; limit?: number } = {},
  ): Promise<RenewalHistoryResponse> => {
    const headers = await getAuthHeader();
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    const url = `${BACKEND_URL}/api/subscriptions/${subscriptionId}/history${qs.toString() ? `?${qs}` : ''}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Failed to load history (${res.status})`);
    return res.json();
  },
};
