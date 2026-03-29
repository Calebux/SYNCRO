export type WebhookEventType =
  | 'subscription.renewal_due'
  | 'subscription.renewed'
  | 'subscription.renewal_failed'
  | 'subscription.cancelled'
  | 'subscription.risk_score_changed'
  | 'reminder.sent';

export interface Webhook {
  id: string;
  user_id: string;
  url: string;
  secret: string;
  events: WebhookEventType[];
  enabled: boolean;
  failure_count: number;
  created_at: string;
  updated_at: string;
}

export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  event_type: WebhookEventType;
  payload: any;
  response_code: number | null;
  response_body: string | null;
  status: 'pending' | 'success' | 'failed' | 'retrying';
  retry_count: number;
  scheduled_at: string;
  delivered_at: string | null;
  created_at: string;
}

export interface WebhookCreateInput {
  url: string;
  events: WebhookEventType[];
}

export interface WebhookUpdateInput {
  url?: string;
  events?: WebhookEventType[];
  enabled?: boolean;
}
