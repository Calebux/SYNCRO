import { auditService } from '../audit-service';
import type { DomainEvent, SubscriptionCreatedEvent, SubscriptionUpdatedEvent, SubscriptionDeletedEvent, SubscriptionCancelledEvent } from '@syncro/shared/domain-events';

export class AuditLogSubscriber {
  async handle(event: DomainEvent): Promise<void> {
    switch (event.eventName) {
      case 'subscription.created':
        await this.handleSubscriptionCreated(event as SubscriptionCreatedEvent);
        break;
      case 'subscription.updated':
        await this.handleSubscriptionUpdated(event as SubscriptionUpdatedEvent);
        break;
      case 'subscription.deleted':
      case 'subscription.cancelled':
        await this.handleSubscriptionDeletedOrCancelled(event as SubscriptionDeletedEvent | SubscriptionCancelledEvent);
        break;
    }
  }

  private async handleSubscriptionCreated(event: SubscriptionCreatedEvent): Promise<void> {
    await auditService.insertEntry({
      userId: event.userId,
      action: 'subscription.created',
      resourceType: 'subscription',
      resourceId: event.subscriptionId,
      metadata: {
        eventId: event.eventId,
        correlationId: event.correlationId,
        subscription: event.subscription,
      },
    });
  }

  private async handleSubscriptionUpdated(event: SubscriptionUpdatedEvent): Promise<void> {
    await auditService.insertEntry({
      userId: event.userId,
      action: 'subscription.updated',
      resourceType: 'subscription',
      resourceId: event.subscriptionId,
      metadata: {
        eventId: event.eventId,
        correlationId: event.correlationId,
        previousStatus: event.previousStatus,
        updatedFields: event.updatedFields,
        subscription: event.subscription,
      },
    });
  }

  private async handleSubscriptionDeletedOrCancelled(event: SubscriptionDeletedEvent | SubscriptionCancelledEvent): Promise<void> {
    await auditService.insertEntry({
      userId: event.userId,
      action: event.eventName,
      resourceType: 'subscription',
      resourceId: event.subscriptionId,
      metadata: {
        eventId: event.eventId,
        correlationId: event.correlationId,
        previousStatus: event.previousStatus,
      },
    });
  }
}

export const auditLogSubscriber = new AuditLogSubscriber();
