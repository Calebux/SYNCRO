import { digestService } from '../digest-service';
import type { DomainEvent, SubscriptionCreatedEvent, SubscriptionUpdatedEvent, SubscriptionDeletedEvent, SubscriptionCancelledEvent } from '@syncro/shared/domain-events';

export class DigestUpdateSubscriber {
  async handle(event: DomainEvent): Promise<void> {
    switch (event.eventName) {
      case 'subscription.created':
      case 'subscription.updated':
      case 'subscription.deleted':
      case 'subscription.cancelled':
        await this.handleSubscriptionMutated(event as SubscriptionCreatedEvent | SubscriptionUpdatedEvent | SubscriptionDeletedEvent | SubscriptionCancelledEvent);
        break;
    }
  }

  private async handleSubscriptionMutated(event: SubscriptionCreatedEvent | SubscriptionUpdatedEvent | SubscriptionDeletedEvent | SubscriptionCancelledEvent): Promise<void> {
    try {
      const prefs = await digestService.getDigestPreferences(event.userId);
      if (!prefs.digestEnabled) return;
      await digestService.sendDigestForUser(event.userId, 'monthly');
    } catch (err) {
      throw new Error(`Digest update failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const digestUpdateSubscriber = new DigestUpdateSubscriber();
