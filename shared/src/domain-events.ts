export type DomainEventName =
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.deleted'
  | 'subscription.cancelled'
  | 'subscription.restored'
  | 'subscription.paused'
  | 'subscription.resumed'
  | 'renewal.succeeded'
  | 'renewal.failed'
  | 'payment.succeeded'
  | 'payment.failed'
  | 'risk.score.changed'
  | 'analytics.invalidated'
  | 'digest.updated';

export interface BaseDomainEvent {
  eventName: DomainEventName;
  eventId: string;
  occurredAt: string;
  userId: string;
  correlationId?: string;
}

export interface SubscriptionCreatedEvent extends BaseDomainEvent {
  eventName: 'subscription.created';
  subscriptionId: string;
  subscription: {
    id: string;
    name: string;
    provider: string;
    price: number;
    currency: string;
    billingCycle: string;
    category: string;
    status: string;
    nextBillingDate: string | null;
    stealthIndex: number;
    stealthAddress: string | null;
  };
}

export interface SubscriptionUpdatedEvent extends BaseDomainEvent {
  eventName: 'subscription.updated';
  subscriptionId: string;
  previousStatus: string;
  updatedFields: string[];
  subscription: {
    id: string;
    name: string;
    provider: string;
    price: number;
    currency: string;
    billingCycle: string;
    category: string;
    status: string;
    nextBillingDate: string | null;
  };
}

export interface SubscriptionDeletedEvent extends BaseDomainEvent {
  eventName: 'subscription.deleted';
  subscriptionId: string;
  previousStatus: string;
}

export interface SubscriptionCancelledEvent extends BaseDomainEvent {
  eventName: 'subscription.cancelled';
  subscriptionId: string;
  previousStatus: string;
}

export interface SubscriptionRestoredEvent extends BaseDomainEvent {
  eventName: 'subscription.restored';
  subscriptionId: string;
}

export interface SubscriptionPausedEvent extends BaseDomainEvent {
  eventName: 'subscription.paused';
  subscriptionId: string;
  reason?: string;
  resumeAt?: string;
}

export interface SubscriptionResumedEvent extends BaseDomainEvent {
  eventName: 'subscription.resumed';
  subscriptionId: string;
}

export interface RenewalSucceededEvent extends BaseDomainEvent {
  eventName: 'renewal.succeeded';
  subscriptionId: string;
  cycleId: number;
  transactionHash?: string;
  amount: number;
  currency: string;
}

export interface RenewalFailedEvent extends BaseDomainEvent {
  eventName: 'renewal.failed';
  subscriptionId: string;
  cycleId: number;
  failureReason: string;
  errorMessage?: string;
  retryable: boolean;
}

export interface PaymentSucceededEvent extends BaseDomainEvent {
  eventName: 'payment.succeeded';
  subscriptionId: string;
  paymentId: string;
  amount: number;
  currency: string;
  provider: string;
}

export interface PaymentFailedEvent extends BaseDomainEvent {
  eventName: 'payment.failed';
  subscriptionId: string;
  paymentId: string;
  amount: number;
  currency: string;
  provider: string;
  reason: string;
  retryable: boolean;
}

export interface RiskScoreChangedEvent extends BaseDomainEvent {
  eventName: 'risk.score.changed';
  subscriptionId: string;
  oldRiskLevel: string;
  newRiskLevel: string;
  riskFactors: Array<{
    factorType: string;
    weight: number;
    details: Record<string, unknown>;
  }>;
}

export interface AnalyticsInvalidatedEvent extends BaseDomainEvent {
  eventName: 'analytics.invalidated';
  userId: string;
  invalidatedNamespaces: string[];
  trigger: 'subscription.created' | 'subscription.updated' | 'subscription.deleted' | 'subscription.cancelled';
}

export interface DigestUpdatedEvent extends BaseDomainEvent {
  eventName: 'digest.updated';
  userId: string;
  digestType: 'monthly' | 'weekly';
  periodStart: string;
  periodEnd: string;
}

export type DomainEvent =
  | SubscriptionCreatedEvent
  | SubscriptionUpdatedEvent
  | SubscriptionDeletedEvent
  | SubscriptionCancelledEvent
  | SubscriptionRestoredEvent
  | SubscriptionPausedEvent
  | SubscriptionResumedEvent
  | RenewalSucceededEvent
  | RenewalFailedEvent
  | PaymentSucceededEvent
  | PaymentFailedEvent
  | RiskScoreChangedEvent
  | AnalyticsInvalidatedEvent
  | DigestUpdatedEvent;
