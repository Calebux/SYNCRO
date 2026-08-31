import { queryCacheService } from '../query-cache-service';
import type { DomainEvent, SubscriptionCreatedEvent, SubscriptionUpdatedEvent, SubscriptionDeletedEvent, SubscriptionCancelledEvent } from '@syncro/shared/domain-events';

export class AnalyticsInvalidationSubscriber {
  async handle(event: DomainEvent): Promise<void> {
    switch (event.eventName) {
      case 'subscription.created':
        await this.handleSubscriptionMutated(event as SubscriptionCreatedEvent);
        break;
      case 'subscription.updated':
        await this.handleSubscriptionMutated(event as SubscriptionUpdatedEvent);
        break;
      case 'subscription.deleted':
      case 'subscription.cancelled':
        await this.handleSubscriptionMutated(event as SubscriptionDeletedEvent | SubscriptionCancelledEvent);
        break;
    }
  }

  private async handleSubscriptionMutated(event: SubscriptionCreatedEvent | SubscriptionUpdatedEvent | SubscriptionDeletedEvent | SubscriptionCancelledEvent): Promise<void> {
    try {
      await Promise.all([
        queryCacheService.invalidateUserNamespace(event.userId, 'subscription_list'),
        queryCacheService.invalidateUserNamespace(event.userId, 'subscription_detail'),
        queryCacheService.invalidateUserNamespace(event.userId, 'analytics_summary'),
      ]);
    } catch (err) {
      throw new Error(`Analytics cache invalidation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const analyticsInvalidationSubscriber = new AnalyticsInvalidationSubscriber();
