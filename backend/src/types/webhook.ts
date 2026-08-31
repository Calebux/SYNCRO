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

export interface WebhookEventPayloadMap {
  'subscription.renewal_due': {
    subscription_id: string;
    subscription_name: string;
    renewal_date: string;
    amount: number;
    currency: string;
  };
  'subscription.renewed': {
    subscription_id: string;
    subscription_name: string;
    renewed_at: string;
    amount: number;
    currency: string;
  };
  'subscription.renewal_failed': {
    subscription_id: string;
    subscription_name: string;
    failed_at: string;
    reason: string;
  };
  'subscription.cancelled': {
    subscription_id: string;
    subscription_name: string;
    cancelled_at: string;
  };
  'subscription.risk_score_changed': {
    subscription_id: string;
    subscription_name: string;
    previous_score: number;
    new_score: number;
  };
  'reminder.sent': {
    subscription_id: string;
    subscription_name: string;
    reminder_type: string;
    sent_at: string;
  };
}

export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  event_type: WebhookEventType;
  payload: WebhookEventPayloadMap[WebhookEventType];
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